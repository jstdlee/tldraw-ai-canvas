/** Postgres in the page, via PGlite. The first call opens (or creates) the database. */

import { PGlite } from '@electric-sql/pglite'
import { toCsv } from '../../shared/tableText'

interface PgResult {
	rows?: Record<string, unknown>[]
	fields?: { name: string }[]
}

interface PgDb {
	exec(sql: string): Promise<PgResult[] | PgResult>
	query(sql: string, params?: unknown[]): Promise<PgResult>
}

let opening: Promise<PgDb> | null = null

// WP19 Part 3: when idb://ai-canvas cannot be opened, the Postgres cards fall back to an
// in-memory database so the card still works — but anything written there is lost on reload.
// This flag lets the cards show that instead of staying silent about it.
let memoryFallbackReason: string | null = null

/** Why the built-in Postgres is running in memory, or null when it opened normally. */
export function pgliteMemoryFallbackReason(): string | null {
	return memoryFallbackReason
}

async function openDb(): Promise<PgDb> {
	try {
		const db = new PGlite('idb://ai-canvas') as unknown as PgDb
		await db.query('SELECT 1')
		memoryFallbackReason = null
		return db
	} catch (error) {
		memoryFallbackReason = (error as Error)?.message || 'could not open its saved database'
		return new PGlite() as unknown as PgDb
	}
}

export function getPg(): Promise<PgDb> {
	opening ??= openDb()
	return opening
}

// A toast for this is shown at most once per session, regardless of how many
// Postgres cards are on the canvas.
let toastShown = false

/** True the first time this is called after the fallback happened; false on every later call. */
export function takePgliteFallbackToast(): boolean {
	if (toastShown || !memoryFallbackReason) return false
	toastShown = true
	return true
}

/** WP26: the card-to-card table contract is RFC 4180 CSV (`shared/tableText.ts`'s `toCsv`), not
 * TSV with JSON-quoted cells — the old format broke on a value with a tab, quote or newline, and
 * turned NULL into the four-letter text "null" instead of an empty cell. When the query returns
 * no rows but PGlite still reports the columns (e.g. a SELECT matching nothing), the header row
 * alone is still a valid table; only a result with no columns at all (DDL, etc.) falls back to
 * the old "(no rows)" plain-text note. */
function table(result: PgResult): string {
	const rows = result.rows ?? []
	const fields = result.fields?.map((field) => field.name) ?? (rows[0] ? Object.keys(rows[0]) : [])
	if (!fields.length) return '(no rows)'
	const body = rows.map((row) => fields.map((field) => row[field] ?? null))
	return toCsv(fields, body)
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
