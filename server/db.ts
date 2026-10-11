/**
 * External database access for the Database card (WP13): Postgres (`pg`) and DuckDB
 * (`@duckdb/node-api`), reached only from the server. Embedded engines (SQLite via sql.js,
 * built-in Postgres via PGlite) stay in the client; this module is for the "Postgres" and
 * "DuckDB" sources, which read and write a real external database with full SQL.
 */
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api'
import { homedir } from 'node:os'
import { Pool, PoolClient } from 'pg'
import {
	DbConn,
	DuckDbConn,
	normalizePostgresConn,
	PostgresConn,
	postgresPoolKey,
	validateDuckDbPath,
} from '../shared/dbConn'
import { convertDuckDbValue, convertPostgresValue } from '../shared/dbValues'
import { isRiskyStatement, isWriteCommand, splitSqlStatements, statementCommand } from '../shared/sqlStatements'
import { resolveSecret } from '../shared/secrets'
import { createSecret, getSecretValue } from './secretsStore'

export class DbError extends Error {}

const STATEMENT_TIMEOUT_MS = 60_000
const DEFAULT_ROW_LIMIT = 10_000
const HARD_ROW_LIMIT = 200_000

// --- Postgres pools ----------------------------------------------------------------------

interface PoolEntry {
	pool: Pool
	lastUsed: number
}

const pgPools = new Map<string, PoolEntry>()

function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new DbError(message)), ms)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error) => {
				clearTimeout(timer)
				reject(error)
			}
		)
	})
}

function pgPassword(conn: PostgresConn): string | undefined {
	if (!conn.passwordRef) return undefined
	return resolveSecret(conn.passwordRef, process.env, getSecretValue)
}

function getPgPool(conn: PostgresConn): Pool {
	const key = postgresPoolKey(conn)
	const existing = pgPools.get(key)
	if (existing) {
		existing.lastUsed = Date.now()
		return existing.pool
	}
	const pool = new Pool({
		host: conn.host || 'localhost',
		port: conn.port || 5432,
		database: conn.database || undefined,
		user: conn.user || undefined,
		password: pgPassword(conn),
		ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
		max: 3,
		idleTimeoutMillis: 60_000,
	})
	pool.on('error', () => {
		// A dropped idle connection shouldn't crash the server; the next query surfaces the error.
	})
	pgPools.set(key, { pool, lastUsed: Date.now() })
	return pool
}

function pgErrorMessage(error: unknown): string {
	const err = error as { message?: string; code?: string }
	const message = err?.message ?? String(error)
	if (err?.code === '28P01' || /password authentication failed/i.test(message)) {
		const userMatch = /user "([^"]+)"/.exec(message)
		return `${message} — check the password${userMatch ? ` for user "${userMatch[1]}"` : ''}.`
	}
	if (err?.code === '3D000' || /database .* does not exist/i.test(message)) {
		return `${message} — check the database name.`
	}
	if (/ECONNREFUSED/.test(message)) {
		return `${message} — is Postgres running and reachable at that host/port?`
	}
	return message
}

// --- DuckDB instances ----------------------------------------------------------------------

const duckInstances = new Map<string, Promise<DuckDBInstance>>()

function getDuckInstance(conn: DuckDbConn): Promise<DuckDBInstance> {
	validateDuckDbPath(conn.path, homedir())
	const key = `${conn.path}|${conn.readOnly ? 'ro' : 'rw'}`
	let instance = duckInstances.get(key)
	if (!instance) {
		instance = DuckDBInstance.create(conn.path, conn.readOnly ? { access_mode: 'READ_ONLY' } : undefined)
		duckInstances.set(key, instance)
	}
	return instance
}

async function duckConnect(conn: DuckDbConn): Promise<DuckDBConnection> {
	const instance = await getDuckInstance(conn)
	return instance.connect()
}

// --- Normalizing a conn (splitting a pasted Postgres URL) -----------------------------------

/** Split a pasted `postgres://` URL into fields + a stored secret. No-op for every other conn. */
export function normalizeConn(conn: DbConn): DbConn {
	if (conn.kind !== 'postgres') return conn
	return normalizePostgresConn(conn, createSecret)
}

// --- Test connection ------------------------------------------------------------------------

export interface TestConnectionResult {
	ok: true
	version: string
}

export async function testConnection(connIn: DbConn): Promise<TestConnectionResult> {
	const conn = normalizeConn(connIn)
	if (conn.kind === 'postgres') {
		const pool = getPgPool(conn)
		let client: PoolClient
		try {
			client = await timeout(pool.connect(), STATEMENT_TIMEOUT_MS, 'Connection timed out')
		} catch (error) {
			throw new DbError(pgErrorMessage(error))
		}
		try {
			const result = await client.query('SHOW server_version')
			return { ok: true, version: `PostgreSQL ${result.rows[0]?.server_version ?? ''}`.trim() }
		} catch (error) {
			throw new DbError(pgErrorMessage(error))
		} finally {
			client.release()
		}
	}
	const connection = await duckConnect(conn)
	try {
		const reader = await connection.runAndReadAll('select version() as v')
		const v = reader.getRowObjectsJson()[0]?.v
		return { ok: true, version: `DuckDB ${v ?? ''}`.trim() }
	} catch (error) {
		throw new DbError((error as Error).message)
	} finally {
		connection.closeSync?.()
	}
}

// --- Schema ----------------------------------------------------------------------------------

export interface SchemaColumn {
	name: string
	type: string
}

export interface SchemaTable {
	schema: string
	name: string
	columns: SchemaColumn[]
	rows?: number
}

export async function getSchema(connIn: DbConn): Promise<{ tables: SchemaTable[] }> {
	const conn = normalizeConn(connIn)
	if (conn.kind === 'postgres') {
		const pool = getPgPool(conn)
		const client = await timeout(pool.connect(), STATEMENT_TIMEOUT_MS, 'Connection timed out').catch((error) => {
			throw new DbError(pgErrorMessage(error))
		})
		try {
			const columns = await client.query(
				`select table_schema, table_name, column_name, data_type
				 from information_schema.columns
				 where table_schema not in ('pg_catalog', 'information_schema')
				 order by table_schema, table_name, ordinal_position`
			)
			const counts = await client.query(
				`select schemaname as table_schema, relname as table_name, n_live_tup::bigint as estimate
				 from pg_stat_user_tables`
			)
			const countByKey = new Map<string, number>()
			for (const row of counts.rows) countByKey.set(`${row.table_schema}.${row.table_name}`, Number(row.estimate))
			const byKey = new Map<string, SchemaTable>()
			for (const row of columns.rows) {
				const key = `${row.table_schema}.${row.table_name}`
				let table = byKey.get(key)
				if (!table) {
					table = { schema: row.table_schema, name: row.table_name, columns: [], rows: countByKey.get(key) }
					byKey.set(key, table)
				}
				table.columns.push({ name: row.column_name, type: row.data_type })
			}
			return { tables: [...byKey.values()] }
		} catch (error) {
			throw new DbError(pgErrorMessage(error))
		} finally {
			client.release()
		}
	}
	const connection = await duckConnect(conn)
	try {
		const columnsReader = await connection.runAndReadAll(
			`select table_schema, table_name, column_name, data_type
			 from information_schema.columns
			 where table_schema = 'main'
			 order by table_schema, table_name, ordinal_position`
		)
		const sizesReader = await connection.runAndReadAll('select table_name, estimated_size from duckdb_tables()')
		const sizeByName = new Map<string, number>()
		for (const row of sizesReader.getRowObjectsJson() as { table_name: string; estimated_size: string }[]) {
			sizeByName.set(row.table_name, Number(row.estimated_size))
		}
		const byKey = new Map<string, SchemaTable>()
		for (const row of columnsReader.getRowObjectsJson() as {
			table_schema: string
			table_name: string
			column_name: string
			data_type: string
		}[]) {
			const key = `${row.table_schema}.${row.table_name}`
			let table = byKey.get(key)
			if (!table) {
				table = { schema: row.table_schema, name: row.table_name, columns: [], rows: sizeByName.get(row.table_name) }
				byKey.set(key, table)
			}
			table.columns.push({ name: row.column_name, type: row.data_type })
		}
		return { tables: [...byKey.values()] }
	} catch (error) {
		throw new DbError((error as Error).message)
	} finally {
		connection.closeSync?.()
	}
}

// --- Query -------------------------------------------------------------------------------------

export interface QueryResultRow {
	columns: string[]
	rows: unknown[][]
	rowCount: number
	truncated: boolean
	command: string
	affected?: number
}

export interface RunQueryOptions {
	limit?: number
	params?: unknown[]
	/** Defaults to true when the script has any write statement. */
	transaction?: boolean
}

export interface RunQueryResult {
	results: QueryResultRow[]
	ms: number
}

function applyLimit(rows: unknown[][], limit: number): { rows: unknown[][]; truncated: boolean } {
	if (rows.length <= limit) return { rows, truncated: false }
	return { rows: rows.slice(0, limit), truncated: true }
}

async function runPostgres(conn: PostgresConn, sql: string, opts: RunQueryOptions): Promise<RunQueryResult> {
	const pool = getPgPool(conn)
	let client: PoolClient
	try {
		client = await timeout(pool.connect(), STATEMENT_TIMEOUT_MS, 'Connection timed out')
	} catch (error) {
		throw new DbError(pgErrorMessage(error))
	}
	const started = Date.now()
	try {
		await client.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`)
		const statements = splitSqlStatements(sql)
		if (!statements.length) throw new DbError('No SQL statement to run')
		const limit = Math.min(opts.limit ?? DEFAULT_ROW_LIMIT, HARD_ROW_LIMIT)
		const useTransaction = opts.transaction ?? statements.some((s) => isWriteCommand(statementCommand(s)))
		const results: QueryResultRow[] = []
		if (useTransaction) await client.query('BEGIN')
		try {
			for (let i = 0; i < statements.length; i++) {
				const statement = statements[i]
				try {
					const params = i === statements.length - 1 ? opts.params : undefined
					const result = await timeout(
						client.query(statement, params as unknown[] | undefined),
						STATEMENT_TIMEOUT_MS,
						`Statement ${i + 1} timed out`
					)
					const command = result.command || statementCommand(statement)
					const rawRows = (result.rows ?? []).map((row: Record<string, unknown>) =>
						(result.fields ?? Object.keys(row).map((name) => ({ name }))).map((field: { name: string }) =>
							convertPostgresValue(row[field.name])
						)
					)
					const { rows, truncated } = applyLimit(rawRows, limit)
					results.push({
						columns: (result.fields ?? []).map((f: { name: string }) => f.name),
						rows,
						rowCount: rawRows.length,
						truncated,
						command,
						affected: isWriteCommand(command) ? result.rowCount ?? 0 : undefined,
					})
				} catch (error) {
					if (useTransaction) await client.query('ROLLBACK')
					throw new DbError(`Statement ${i + 1} failed: ${pgErrorMessage(error)}`)
				}
			}
			if (useTransaction) await client.query('COMMIT')
		} catch (error) {
			throw error
		}
		return { results, ms: Date.now() - started }
	} finally {
		client.release()
	}
}

async function runDuckDb(conn: DuckDbConn, sql: string, opts: RunQueryOptions): Promise<RunQueryResult> {
	const connection = await duckConnect(conn)
	const started = Date.now()
	try {
		const statements = splitSqlStatements(sql)
		if (!statements.length) throw new DbError('No SQL statement to run')
		const limit = Math.min(opts.limit ?? DEFAULT_ROW_LIMIT, HARD_ROW_LIMIT)
		const useTransaction = opts.transaction ?? statements.some((s) => isWriteCommand(statementCommand(s)))
		const results: QueryResultRow[] = []
		if (useTransaction) await connection.run('BEGIN TRANSACTION')
		try {
			for (let i = 0; i < statements.length; i++) {
				const statement = statements[i]
				try {
					const params = i === statements.length - 1 ? opts.params : undefined
					const reader = await timeout(
						params && params.length
							? connection.runAndReadAll(statement, params as import('@duckdb/node-api').DuckDBValue[])
							: connection.runAndReadAll(statement),
						STATEMENT_TIMEOUT_MS,
						`Statement ${i + 1} timed out`
					)
					const command = statementCommand(statement)
					if (isWriteCommand(command)) {
						// DML/DDL results are a single `Count` row (empty for DDL with nothing to count),
						// never a data grid — see shared/sqlStatements.ts's write/read split.
						const countRow = reader.getRowObjectsJson()[0] as { Count?: string } | undefined
						results.push({
							columns: [],
							rows: [],
							rowCount: 0,
							truncated: false,
							command,
							affected: countRow?.Count != null ? Number(countRow.Count) : 0,
						})
						continue
					}
					const columnNames = reader.columnNames()
					const columnTypes = reader.columnTypes().map((t) => String(t))
					const rawRows = reader.getRows().map((row) => row.map((value, idx) => convertDuckDbValue(value, columnTypes[idx] ?? '')))
					const { rows, truncated } = applyLimit(rawRows, limit)
					results.push({
						columns: columnNames,
						rows,
						rowCount: rawRows.length,
						truncated,
						command,
					})
				} catch (error) {
					if (useTransaction) await connection.run('ROLLBACK')
					throw new DbError(`Statement ${i + 1} failed: ${(error as Error).message}`)
				}
			}
			if (useTransaction) await connection.run('COMMIT')
		} catch (error) {
			throw error
		}
		return { results, ms: Date.now() - started }
	} finally {
		connection.closeSync?.()
	}
}

export async function runQuery(connIn: DbConn, sql: string, opts: RunQueryOptions = {}): Promise<RunQueryResult> {
	const conn = normalizeConn(connIn)
	if (!sql || !sql.trim()) throw new DbError('SQL is required')
	return conn.kind === 'postgres' ? runPostgres(conn, sql, opts) : runDuckDb(conn, sql, opts)
}

export { isRiskyStatement, splitSqlStatements, statementCommand, isWriteCommand }
