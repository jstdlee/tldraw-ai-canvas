/**
 * Read a SQLite file fully in the browser with sql.js (WASM), then hand schema
 * and rows to sqliteToPg so they can be loaded into PGlite. The WASM is bundled
 * by Vite (?url), so the import works offline after the first app load.
 */
import initSqlJs, { Database, SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { sqliteToPg, SqliteColumn, SqliteTable } from '../../shared/sqliteToPg'

let loading: Promise<SqlJsStatic> | null = null

function loadSqlJs(): Promise<SqlJsStatic> {
	loading ??= initSqlJs({ locateFile: () => wasmUrl })
	return loading
}

interface PragmaRow {
	name: string
	type: string
	notnull: number
	pk: number
}

function tableColumns(db: Database, name: string): SqliteColumn[] {
	const result = db.exec(`PRAGMA table_info(${JSON.stringify(name)})`)
	const rows = (result[0]?.values ?? []) as unknown[][]
	return rows.map((row) => {
		const r = row as [number, string, string, number, unknown, number]
		return { name: r[1], type: r[2] ?? '', nullable: !r[3], pk: !!r[5] } as SqliteColumn
	})
}

function tableRows(db: Database, name: string): unknown[][] {
	const result = db.exec(`SELECT * FROM ${JSON.stringify(name)}`)
	return (result[0]?.values ?? []) as unknown[][]
}

/** Read one SQLite file into table descriptions (schema + rows). */
export async function readSqliteFile(bytes: Uint8Array): Promise<SqliteTable[]> {
	const SQL = await loadSqlJs()
	const db = new SQL.Database(bytes)
	try {
		const names = (db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0]?.values ?? [])
			.map((row) => String((row as unknown[])[0]))
		return names.map((name) => ({ name, columns: tableColumns(db, name), rows: tableRows(db, name) }))
	} finally {
		db.close()
	}
}

/** The Postgres statements that load a SQLite file's contents into PGlite. */
export async function sqliteFileToPgStatements(bytes: Uint8Array): Promise<{ tables: number; rows: number; statements: string[] }> {
	const tables = await readSqliteFile(bytes)
	const rows = tables.reduce((sum, t) => sum + t.rows.length, 0)
	return { tables: tables.length, rows, statements: sqliteToPg(tables) }
}
