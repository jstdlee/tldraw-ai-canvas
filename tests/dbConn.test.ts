import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizePostgresConn, postgresPoolKey, splitPostgresUrl, validateDuckDbPath } from '../shared/dbConn'
import { convertDuckDbValue, convertPostgresValue } from '../shared/dbValues'
import { isRiskyStatement, isWriteCommand, splitSqlStatements, statementCommand, sqlHasWrite } from '../shared/sqlStatements'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'ai-canvas-db-'))

// ---------------------------------------------------------------------------
// Conn parsing
// ---------------------------------------------------------------------------

describe('splitPostgresUrl', () => {
	it('splits a full URL into fields', () => {
		const split = splitPostgresUrl('postgres://alice:s3cr3t@db.local:5433/sales?sslmode=require')
		expect(split).toEqual({ host: 'db.local', port: 5433, database: 'sales', user: 'alice', password: 's3cr3t', ssl: true })
	})

	it('accepts postgresql:// too, and defaults missing pieces to undefined', () => {
		const split = splitPostgresUrl('postgresql://localhost/mydb')
		expect(split.host).toBe('localhost')
		expect(split.database).toBe('mydb')
		expect(split.user).toBeUndefined()
		expect(split.password).toBeUndefined()
	})

	it('decodes a URL-encoded password', () => {
		const split = splitPostgresUrl('postgres://bob:p%40ss@host/db')
		expect(split.password).toBe('p@ss')
	})

	it('rejects a non-postgres URL', () => {
		expect(() => splitPostgresUrl('mysql://host/db')).toThrow(/postgres/i)
	})

	it('rejects garbage', () => {
		expect(() => splitPostgresUrl('not a url')).toThrow()
	})
})

describe('normalizePostgresConn', () => {
	it('leaves a conn without a url unchanged', () => {
		const conn = { kind: 'postgres' as const, host: 'localhost', port: 5432 }
		expect(normalizePostgresConn(conn, () => 'id')).toBe(conn)
	})

	it('splits a url into fields and stores the password as a secret, dropping the url', () => {
		let stored = ''
		const conn = { kind: 'postgres' as const, url: 'postgres://me:hunter2@localhost:5432/sales' }
		const normalized = normalizePostgresConn(conn, (value) => {
			stored = value
			return 'new-id'
		})
		expect(stored).toBe('hunter2')
		expect(normalized).toEqual({
			kind: 'postgres',
			host: 'localhost',
			port: 5432,
			database: 'sales',
			user: 'me',
			passwordRef: 'secret:new-id',
			ssl: undefined,
		})
		expect(JSON.stringify(normalized)).not.toContain('hunter2')
	})

	it('keeps an existing passwordRef when the url has no password', () => {
		const conn = { kind: 'postgres' as const, url: 'postgres://localhost/db', passwordRef: 'secret:old' }
		const normalized = normalizePostgresConn(conn, () => 'unused')
		expect(normalized.passwordRef).toBe('secret:old')
	})
})

describe('postgresPoolKey', () => {
	it('is stable for the same host/port/database/user', () => {
		const a = { kind: 'postgres' as const, host: 'h', port: 5432, database: 'd', user: 'u' }
		const b = { kind: 'postgres' as const, host: 'h', port: 5432, database: 'd', user: 'u', passwordRef: 'secret:x' }
		expect(postgresPoolKey(a)).toBe(postgresPoolKey(b))
	})

	it('differs when the database differs', () => {
		const a = { kind: 'postgres' as const, host: 'h', database: 'd1' }
		const b = { kind: 'postgres' as const, host: 'h', database: 'd2' }
		expect(postgresPoolKey(a)).not.toBe(postgresPoolKey(b))
	})
})

describe('validateDuckDbPath', () => {
	const home = '/home/me'
	it('always allows :memory:', () => {
		expect(() => validateDuckDbPath(':memory:', home)).not.toThrow()
	})

	it('allows an absolute path inside home', () => {
		expect(() => validateDuckDbPath('/home/me/data/sales.duckdb', home)).not.toThrow()
	})

	it('allows an absolute path inside /tmp', () => {
		expect(() => validateDuckDbPath('/tmp/sales.duckdb', home)).not.toThrow()
	})

	it('rejects a relative path', () => {
		expect(() => validateDuckDbPath('sales.duckdb', home)).toThrow(/absolute/)
	})

	it('rejects a path outside home and /tmp', () => {
		expect(() => validateDuckDbPath('/etc/passwd.duckdb', home)).toThrow(/home directory or \/tmp/)
	})
})

// ---------------------------------------------------------------------------
// Value conversion
// ---------------------------------------------------------------------------

describe('convertPostgresValue', () => {
	it('converts bigint to a string', () => {
		expect(convertPostgresValue(10n)).toBe('10')
	})
	it('converts a Date to an ISO string', () => {
		expect(convertPostgresValue(new Date('2020-01-01T00:00:00.000Z'))).toBe('2020-01-01T00:00:00.000Z')
	})
	it('converts a Buffer to a byte-count label', () => {
		expect(convertPostgresValue(Buffer.from([1, 2, 3]))).toBe('<3 bytes>')
	})
	it('stringifies a JSON/object value', () => {
		expect(convertPostgresValue({ a: 1 })).toBe('{"a":1}')
	})
	it('passes a plain value through', () => {
		expect(convertPostgresValue('hi')).toBe('hi')
		expect(convertPostgresValue(42)).toBe(42)
		expect(convertPostgresValue(null)).toBeNull()
	})
})

describe('convertDuckDbValue', () => {
	it('converts a bigint to a string regardless of the declared type', () => {
		expect(convertDuckDbValue(10n, 'BIGINT')).toBe('10')
	})
	it('turns a DuckDB timestamp string into an ISO-ish one (space -> T)', () => {
		expect(convertDuckDbValue('2020-01-01 10:30:00', 'TIMESTAMP')).toBe('2020-01-01T10:30:00')
	})
	it('keeps a DATE value as-is (already ISO)', () => {
		expect(convertDuckDbValue('2020-01-01', 'DATE')).toBe('2020-01-01')
	})
	it('turns a blob value into a byte-count label', () => {
		expect(convertDuckDbValue({ bytes: new Uint8Array([1, 2]) }, 'BLOB')).toBe('<2 bytes>')
	})
	it('passes booleans/numbers/strings through for ordinary types', () => {
		expect(convertDuckDbValue(true, 'BOOLEAN')).toBe(true)
		expect(convertDuckDbValue(1.5, 'DOUBLE')).toBe(1.5)
	})
	it('returns null for null/undefined', () => {
		expect(convertDuckDbValue(null, 'INTEGER')).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// Statement splitting / classification
// ---------------------------------------------------------------------------

describe('splitSqlStatements', () => {
	it('splits on semicolons', () => {
		expect(splitSqlStatements('select 1; select 2;')).toEqual(['select 1', 'select 2'])
	})
	it('ignores a semicolon inside a single-quoted string', () => {
		expect(splitSqlStatements(`select 'a;b' as x;`)).toEqual([`select 'a;b' as x`])
	})
	it('handles an escaped quote inside a string', () => {
		expect(splitSqlStatements(`select 'it''s; fine';`)).toEqual([`select 'it''s; fine'`])
	})
	it('ignores a semicolon inside a line comment', () => {
		expect(splitSqlStatements('select 1; -- a; b\nselect 2;')).toEqual(['select 1', '-- a; b\nselect 2'])
	})
	it('ignores a semicolon inside a block comment', () => {
		expect(splitSqlStatements('select 1 /* a; b */; select 2;')).toEqual(['select 1 /* a; b */', 'select 2'])
	})
	it('ignores a semicolon inside a dollar-quoted body', () => {
		expect(splitSqlStatements(`do $$ begin insert into t values (1); end $$; select 1;`)).toEqual([
			'do $$ begin insert into t values (1); end $$',
			'select 1',
		])
	})
	it('drops empty/comment-only statements', () => {
		expect(splitSqlStatements('  ;  ; select 1;')).toEqual(['select 1'])
	})
	it('keeps a trailing statement with no final semicolon', () => {
		expect(splitSqlStatements('select 1; select 2')).toEqual(['select 1', 'select 2'])
	})
})

describe('statementCommand / isWriteCommand', () => {
	it('reads the leading keyword', () => {
		expect(statementCommand('SELECT * FROM t')).toBe('SELECT')
		expect(statementCommand('  insert into t values (1)')).toBe('INSERT')
		expect(statementCommand('DROP TABLE t')).toBe('DROP')
	})
	it('looks past a CTE for the real command', () => {
		expect(statementCommand('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x')).toBe('INSERT')
		expect(statementCommand('WITH x AS (SELECT 1) SELECT * FROM x')).toBe('SELECT')
	})
	it('classifies reads vs writes', () => {
		expect(isWriteCommand('SELECT')).toBe(false)
		expect(isWriteCommand('EXPLAIN')).toBe(false)
		expect(isWriteCommand('INSERT')).toBe(true)
		expect(isWriteCommand('UPDATE')).toBe(true)
		expect(isWriteCommand('DELETE')).toBe(true)
		expect(isWriteCommand('CREATE')).toBe(true)
		expect(isWriteCommand('DROP')).toBe(true)
		expect(isWriteCommand('BEGIN')).toBe(false)
	})
	it('sqlHasWrite finds a write anywhere in a script', () => {
		expect(sqlHasWrite('select 1; select 2;')).toBe(false)
		expect(sqlHasWrite('select 1; update t set a = 1 where id = 1;')).toBe(true)
	})
})

describe('isRiskyStatement', () => {
	it('flags DROP and TRUNCATE', () => {
		expect(isRiskyStatement('DROP TABLE t').risky).toBe(true)
		expect(isRiskyStatement('TRUNCATE t').risky).toBe(true)
	})
	it('flags DELETE/UPDATE with no WHERE', () => {
		expect(isRiskyStatement('DELETE FROM t').risky).toBe(true)
		expect(isRiskyStatement('UPDATE t SET a = 1').risky).toBe(true)
	})
	it('does not flag DELETE/UPDATE with a WHERE', () => {
		expect(isRiskyStatement('DELETE FROM t WHERE id = 1').risky).toBe(false)
		expect(isRiskyStatement('UPDATE t SET a = 1 WHERE id = 1').risky).toBe(false)
	})
	it('does not flag a plain SELECT or INSERT', () => {
		expect(isRiskyStatement('SELECT * FROM t').risky).toBe(false)
		expect(isRiskyStatement('INSERT INTO t VALUES (1)').risky).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// DuckDB integration (in-memory). Skipped if the native module can't load here.
// ---------------------------------------------------------------------------

let duckAvailable = true
try {
	await import('@duckdb/node-api')
} catch {
	duckAvailable = false
}

describe.skipIf(!duckAvailable)('DuckDB integration (:memory:)', () => {
	it('creates a table, inserts, queries, and reports the schema', async () => {
		const { runQuery, getSchema } = await import('../server/db')
		const conn = { kind: 'duckdb' as const, path: ':memory:' }

		const create = await runQuery(conn, 'create table people (id integer, name text)')
		expect(create.results[0].command).toBe('CREATE')

		const insert = await runQuery(conn, "insert into people values (1, 'Ada'), (2, 'Grace')")
		expect(insert.results[0].affected).toBe(2)

		const select = await runQuery(conn, 'select * from people order by id')
		expect(select.results[0].columns).toEqual(['id', 'name'])
		expect(select.results[0].rows).toEqual([[1, 'Ada'], [2, 'Grace']])

		const schema = await getSchema(conn)
		const table = schema.tables.find((t) => t.name === 'people')
		expect(table?.columns.map((c) => c.name)).toEqual(['id', 'name'])
	})

	it('runs a multi-statement write script in one transaction and rolls back on error', async () => {
		const { runQuery } = await import('../server/db')
		const conn = { kind: 'duckdb' as const, path: ':memory:' }
		await runQuery(conn, 'create table t2 (id integer primary key)')

		await expect(
			runQuery(conn, 'insert into t2 values (1); insert into t2 values (1);')
		).rejects.toThrow(/Statement 2 failed/)

		// The whole script rolled back: the first insert did not stick either.
		// (count(*) is a bigint, converted to a string per shared/dbValues.ts.)
		const after = await runQuery(conn, 'select count(*) as n from t2')
		expect(after.results[0].rows).toEqual([['0']])
	})

	it('rejects a relative or disallowed DuckDB file path', async () => {
		const { runQuery } = await import('../server/db')
		await expect(runQuery({ kind: 'duckdb', path: 'relative.duckdb' }, 'select 1')).rejects.toThrow(/absolute/)
	})
})
