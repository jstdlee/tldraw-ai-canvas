/**
 * Database card (WP13 Part B): load CSV rows (from a wired `rows` input) into a table in
 * an external database, in one transaction. Builds the SQL — the card sends it to
 * `/api/db/query` with `transaction: true`. Pure, so it is testable without a real driver.
 */
import { ColumnType, detectType } from './profile'

export type SqlColumnType = 'text' | 'bigint' | 'double' | 'date' | 'boolean'
export type LoadMode = 'insert' | 'upsert' | 'replace'

const TYPE_MAP: Record<ColumnType, SqlColumnType> = {
	integer: 'bigint',
	number: 'double',
	date: 'date',
	boolean: 'boolean',
	text: 'text',
}

export interface LoadColumn {
	name: string
	type: SqlColumnType
}

export interface LoadPlan {
	table: string
	columns: LoadColumn[]
	/** CREATE (when needed) followed by batched INSERTs, in the order to run them. */
	statements: string[]
	rowCount: number
}

function ident(name: string): string {
	return `"${name.replace(/"/g, '""')}"`
}

function sqlLiteral(value: string, type: SqlColumnType): string {
	if (value.trim() === '') return 'NULL'
	if (type === 'boolean') return /^true$/i.test(value.trim()) ? 'TRUE' : 'FALSE'
	if (type === 'bigint' || type === 'double') return value.trim().replace(/,/g, '')
	return `'${value.replace(/'/g, "''")}'`
}

const BATCH_SIZE = 1000

/**
 * `csvRows` includes the header row first (as `shared/pgImport.ts`'s `parseCsv` returns it).
 * `upsertKey` is required and must be a loaded column for `mode: 'upsert'`.
 */
export function buildLoadPlan(csvRows: string[][], table: string, mode: LoadMode, upsertKey?: string): LoadPlan {
	const [header, ...dataRows] = csvRows
	if (!header || !header.length) throw new Error('No columns to load')
	if (!table.trim()) throw new Error('Pick a target table name')
	const columnNames = header.map((name, i) => name.trim() || `col${i + 1}`)
	const columns: LoadColumn[] = columnNames.map((name, i) => ({
		name,
		type: TYPE_MAP[detectType(dataRows.map((row) => row[i] ?? ''))],
	}))
	if (mode === 'upsert') {
		if (!upsertKey) throw new Error('Pick a key column for upsert')
		if (!columnNames.includes(upsertKey)) throw new Error(`"${upsertKey}" is not one of the loaded columns`)
	}
	const statements: string[] = []
	if (mode === 'replace') statements.push(`DROP TABLE IF EXISTS ${ident(table)}`)
	statements.push(`CREATE TABLE IF NOT EXISTS ${ident(table)} (${columns.map((c) => `${ident(c.name)} ${c.type}`).join(', ')})`)
	const columnList = columns.map((c) => ident(c.name)).join(', ')
	for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
		const batch = dataRows.slice(i, i + BATCH_SIZE)
		const values = batch
			.map((row) => `(${columns.map((c, idx) => sqlLiteral(row[idx] ?? '', c.type)).join(', ')})`)
			.join(', ')
		if (mode === 'upsert' && upsertKey) {
			const updates = columns
				.filter((c) => c.name !== upsertKey)
				.map((c) => `${ident(c.name)} = EXCLUDED.${ident(c.name)}`)
				.join(', ')
			statements.push(
				`INSERT INTO ${ident(table)} (${columnList}) VALUES ${values} ON CONFLICT (${ident(upsertKey)}) DO UPDATE SET ${updates}`
			)
		} else {
			statements.push(`INSERT INTO ${ident(table)} (${columnList}) VALUES ${values}`)
		}
	}
	return { table, columns, statements, rowCount: dataRows.length }
}
