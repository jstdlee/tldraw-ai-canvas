/**
 * sql.js (WASM) in the browser: open a SQLite file, list its tables, and run
 * SQL against it. Used by the Database node. The WASM is bundled by Vite
 * (?url), so it works offline after the first app load.
 */
import initSqlJs, { Database, SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

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

function escapeCsv(value: unknown): string {
	if (value == null) return ''
	const s = value instanceof Uint8Array ? `\\x${[...value].map((b) => b.toString(16).padStart(2, '0')).join('')}` : String(value)
	if (s.includes('"') || s.includes('\n') || s.includes(',')) return `"${s.replace(/"/g, '""')}"`
	return s
}

/** Run SQL (one or more statements); the last result set becomes CSV (header + rows). */
export function runSqlCsv(db: Database, sql: string): string {
	const trimmed = sql.trim()
	if (!trimmed) throw new Error('Type a SQL statement')
	const results = db.exec(trimmed)
	const last = results[results.length - 1]
	if (!last) return ''
	const header = last.columns.join(',')
	const rows = last.values.map((row) => row.map(escapeCsv).join(','))
	return [header, ...rows].join('\n')
}
