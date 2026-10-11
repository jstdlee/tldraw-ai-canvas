/**
 * sql.js (WASM) in the browser: open a SQLite file, list its tables, and run
 * SQL against it. Used by the Database node. The WASM is bundled by Vite
 * (?url), so it works offline after the first app load.
 */
import initSqlJs, { Database, SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { toCsv } from '../../shared/tableText'

let loading: Promise<SqlJsStatic> | null = null

export function loadSqlJs(): Promise<SqlJsStatic> {
	loading ??= initSqlJs({ locateFile: () => wasmUrl })
	return loading
}

export interface SqlTableInfo {
	name: string
	columns: string[]
	rows: number
}

export async function openDatabase(bytes: Uint8Array): Promise<Database> {
	const SQL = await loadSqlJs()
	return new SQL.Database(bytes)
}

/** Table names, column names, and row counts — for the tables panel. */
export function describeTables(db: Database): SqlTableInfo[] {
	const names = (db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0]?.values ?? []).map(
		(row) => String((row as unknown[])[0])
	)
	return names.map((name) => {
		const info = db.exec(`PRAGMA table_info(${JSON.stringify(name)})`)
		const columns = ((info[0]?.values ?? []) as unknown[][]).map((row) => String((row as unknown[])[1]))
		const countRows = db.exec(`SELECT COUNT(*) FROM ${JSON.stringify(name)}`)
		const rows = Number((countRows[0]?.values?.[0]?.[0] as number) ?? 0)
		return { name, columns, rows }
	})
}

/** All CREATE TABLE statements, for AI/SQL helpers. */
export function schemaText(db: Database): string {
	const rows = (db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL ORDER BY name")[0]?.values ?? []) as unknown[][]
	return rows.map((row) => String(row[0])).join(';\n') + (rows.length ? ';' : '')
}

/** A BLOB column comes back as a Uint8Array; write it the way sqlite's own CLI would, not
 * `[object Uint8Array]` (toCsv's own stringification for anything that isn't a number/boolean/
 * Date). Everything else passes through unchanged for `toCsv` (WP26's RFC 4180 CSV writer). */
function cellValue(value: unknown): unknown {
	return value instanceof Uint8Array ? `\\x${[...value].map((b) => b.toString(16).padStart(2, '0')).join('')}` : value
}

/** Run SQL (one or more statements); the last result set becomes CSV (header + rows). */
export function runSqlCsv(db: Database, sql: string): string {
	const trimmed = sql.trim()
	if (!trimmed) throw new Error('Type a SQL statement')
	const results = db.exec(trimmed)
	const last = results[results.length - 1]
	if (!last) return ''
	return toCsv(last.columns, last.values.map((row) => row.map(cellValue)))
}
