/**
 * Turn a SQLite database (read client-side with sql.js) into Postgres
 * statements for PGlite: CREATE TABLE + batched INSERTs. Pure and testable;
 * the caller supplies schema and rows, never touches a database here.
 */

export interface SqliteColumn {
	name: string
	/** Declared SQLite type, e.g. INTEGER, TEXT, REAL, BLOB, NUMERIC, or ''. */
	type: string
	/** True when the column may hold NULL. */
	nullable: boolean
	/** True when part of the primary key. */
	pk: boolean
}

export interface SqliteTable {
	name: string
	columns: SqliteColumn[]
	/** Rows as arrays of values in column order. Values: string | number | null | Uint8Array. */
	rows: unknown[][]
}

/** Quote a Postgres identifier (double quotes, embedded quotes doubled). */
export function quoteIdent(name: string): string {
	return `"${name.replace(/"/g, '""')}"`
}

/** Map a declared SQLite type onto a Postgres type. */
export function pgType(sqliteType: string): string {
	const t = sqliteType.trim().toUpperCase()
	if (!t) return 'text'
	if (/INT/.test(t)) return 'bigint'
	if (/REAL|FLOA|DOUB/.test(t)) return 'double precision'
	if (/NUMERIC|DECIMAL/.test(t)) return 'numeric'
	if (/BOOL/.test(t)) return 'boolean'
	if (/BLOB/.test(t)) return 'bytea'
	// TEXT, CHAR, CLOB, VARCHAR, DATE, DATETIME, and anything unknown.
	return 'text'
}

/** Escape a single SQL string literal. */
function quoteText(value: string): string {
	return `'${value.replace(/'/g, "''")}'`
}

/** Render one row value as a Postgres literal. */
function literal(value: unknown): string {
	if (value === null || value === undefined) return 'NULL'
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) return 'NULL'
		return String(value)
	}
	if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
	if (value instanceof Uint8Array) {
		// bytea as a hex literal.
		let hex = ''
		for (const byte of value) hex += byte.toString(16).padStart(2, '0')
		return `'\\x${hex}'::bytea`
	}
	if (typeof value === 'object') return quoteText(JSON.stringify(value))
	return quoteText(String(value))
}

const BATCH = 200

/** The CREATE TABLE statement for one table (drops any existing table of the name). */
export function createTableSql(table: SqliteTable): string {
	const cols = table.columns.map((c) => {
		const parts = [quoteIdent(c.name), pgType(c.type)]
		if (!c.nullable) parts.push('NOT NULL')
		return parts.join(' ')
	})
	const pk = table.columns.filter((c) => c.pk).map((c) => quoteIdent(c.name))
	if (pk.length) cols.push(`PRIMARY KEY (${pk.join(', ')})`)
	return `DROP TABLE IF EXISTS ${quoteIdent(table.name)};\nCREATE TABLE ${quoteIdent(table.name)} (\n  ${cols.join(',\n  ')}\n);`
}

/** The batched INSERT statements for one table's rows. */
export function insertRowsSql(table: SqliteTable): string[] {
	if (!table.rows.length || !table.columns.length) return []
	const head = `INSERT INTO ${quoteIdent(table.name)} (${table.columns.map((c) => quoteIdent(c.name)).join(', ')}) VALUES\n`
	const statements: string[] = []
	for (let i = 0; i < table.rows.length; i += BATCH) {
		const rows = table.rows.slice(i, i + BATCH).map((row) => `  (${table.columns.map((_, j) => literal(row[j])).join(', ')})`)
		statements.push(head + rows.join(',\n') + ';')
	}
	return statements
}

/** Every statement needed to load the database, tables in order. */
export function sqliteToPg(tables: SqliteTable[]): string[] {
	const statements: string[] = []
	for (const table of tables) {
		if (!table.columns.length) continue
		statements.push(createTableSql(table))
		statements.push(...insertRowsSql(table))
	}
	return statements
}
