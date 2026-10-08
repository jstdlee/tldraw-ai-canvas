/** Postgres in the page, via PGlite. The first call opens (or creates) the database. */

import { PGlite } from '@electric-sql/pglite'

interface PgResult {
	rows?: Record<string, unknown>[]
	fields?: { name: string }[]
}

interface PgDb {
	exec(sql: string): Promise<PgResult[] | PgResult>
	query(sql: string, params?: unknown[]): Promise<PgResult>
}

let opening: Promise<PgDb> | null = null

async function openDb(): Promise<PgDb> {
	try {
		const db = new PGlite('idb://ai-canvas') as unknown as PgDb
		await db.query('SELECT 1')
		return db
	} catch {
		return new PGlite() as unknown as PgDb
	}
}

export function getPg(): Promise<PgDb> {
	opening ??= openDb()
	return opening
}

function table(result: PgResult): string {
	const rows = result.rows ?? []
	if (!rows.length) return '(no rows)'
	const fields = result.fields?.map((field) => field.name) ?? Object.keys(rows[0])
	const body = rows.map((row) => fields.map((field) => JSON.stringify(row[field] ?? null)).join('\t'))
	return [fields.join('\t'), ...body].join('\n')
}

/** Run one or more SQL statements. Returns a text table. */
export async function runSql(sql: string, input?: string | null): Promise<string> {
	const db = await getPg()
	const trimmed = sql.trim()
	if (!trimmed) throw new Error('SQL is required')
	const statements = trimmed.split(/;\s*(?:\n|$)/).map((part) => part.trim()).filter(Boolean)
	const chunks: string[] = []
	for (const statement of statements) {
		const withInput = input != null && input !== '' && /\$1\b/.test(statement)
		const result = withInput ? await db.query(statement, [input]) : await db.query(statement)
		chunks.push(table(result))
	}
	return chunks.join('\n\n')
}
