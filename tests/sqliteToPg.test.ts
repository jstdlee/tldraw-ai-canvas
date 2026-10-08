import { describe, expect, it } from 'vitest'
import { createTableSql, insertRowsSql, pgType, quoteIdent, sqliteToPg, type SqliteTable } from '../shared/sqliteToPg'

function table(patch: Partial<SqliteTable>): SqliteTable {
	return { name: 't', columns: [], rows: [], ...patch }
}

describe('quoteIdent', () => {
	it('wraps in double quotes and escapes embedded quotes', () => {
		expect(quoteIdent('users')).toBe('"users"')
		expect(quoteIdent('we"ird')).toBe('"we""ird"')
	})
})

describe('pgType', () => {
	it('maps SQLite affinities to Postgres types', () => {
		expect(pgType('INTEGER')).toBe('bigint')
		expect(pgType('int')).toBe('bigint')
		expect(pgType('REAL')).toBe('double precision')
		expect(pgType('DOUBLE PRECISION')).toBe('double precision')
		expect(pgType('FLOAT')).toBe('double precision')
		expect(pgType('NUMERIC')).toBe('numeric')
		expect(pgType('DECIMAL(10,2)')).toBe('numeric')
		expect(pgType('BOOLEAN')).toBe('boolean')
		expect(pgType('BLOB')).toBe('bytea')
		expect(pgType('TEXT')).toBe('text')
		expect(pgType('VARCHAR(40)')).toBe('text')
		expect(pgType('DATETIME')).toBe('text')
		expect(pgType('')).toBe('text')
		expect(pgType('WEIRD')).toBe('text')
	})
})

describe('createTableSql', () => {
	it('drops, creates, and declares a primary key', () => {
		const sql = createTableSql(
			table({
				name: 'people',
				columns: [
					{ name: 'id', type: 'INTEGER', nullable: false, pk: true },
					{ name: 'name', type: 'TEXT', nullable: true, pk: false },
				],
			})
		)
		expect(sql).toContain('DROP TABLE IF EXISTS "people"')
		expect(sql).toContain('CREATE TABLE "people"')
		expect(sql).toContain('"id" bigint NOT NULL')
		expect(sql).toContain('"name" text')
		expect(sql).toContain('PRIMARY KEY ("id")')
	})
})

describe('insertRowsSql', () => {
	const cols = [
		{ name: 'a', type: 'TEXT', nullable: true, pk: false },
		{ name: 'b', type: 'INTEGER', nullable: true, pk: false },
		{ name: 'c', type: 'BLOB', nullable: true, pk: false },
	]
	it('escapes strings, nulls, numbers, and blobs', () => {
		const [sql] = insertRowsSql(table({ name: 't', columns: cols, rows: [["o'clock", 7, new Uint8Array([0, 255])]] }))
		expect(sql).toContain(`('o''clock', 7, '\\x00ff'::bytea)`)
	})
	it('renders NULL for null and undefined, and skips non-finite numbers', () => {
		const [sql] = insertRowsSql(table({ name: 't', columns: cols, rows: [[null, NaN, undefined]] }))
		expect(sql).toContain('(NULL, NULL, NULL)')
	})
	it('batches rows in groups of 200', () => {
		const rows = Array.from({ length: 450 }, (_, i) => [`n${i}`, i, null])
		const statements = insertRowsSql(table({ name: 't', columns: cols, rows }))
		expect(statements).toHaveLength(3) // 200 + 200 + 50
		expect(statements.every((s) => s.startsWith('INSERT INTO "t"'))).toBe(true)
	})
	it('returns nothing for an empty table', () => {
		expect(insertRowsSql(table({ name: 't', columns: cols, rows: [] }))).toEqual([])
	})
})

describe('sqliteToPg', () => {
	it('emits create + inserts per table, skipping column-less tables', () => {
		const statements = sqliteToPg([
			table({
				name: 'a',
				columns: [{ name: 'x', type: 'INTEGER', nullable: true, pk: false }],
				rows: [[1], [2]],
			}),
			table({ name: 'empty', columns: [], rows: [] }),
			table({
				name: 'b',
				columns: [{ name: 'y', type: 'TEXT', nullable: true, pk: false }],
				rows: [['hi']],
			}),
		])
		const joined = statements.join('\n')
		expect(joined).toContain('CREATE TABLE "a"')
		expect(joined).toContain('CREATE TABLE "b"')
		expect(joined).not.toContain('CREATE TABLE "empty"')
		expect(joined).toContain('(1)')
		expect(joined).toContain(`('hi')`)
	})
})
