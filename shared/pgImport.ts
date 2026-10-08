/**
 * CSV into Postgres. An import is a small recipe: is there a header row, how
 * many rows to skip, and a name and type per column. The recipe is saved on the
 * node so the same dataset can be loaded again with the same steps.
 */

export type PgType = 'text' | 'integer' | 'double precision' | 'boolean'
export const PG_TYPES: PgType[] = ['text', 'integer', 'double precision', 'boolean']

export interface PgColumn {
	name: string
	type: PgType
}

export interface PgImportRecipe {
	table: string
	header: boolean
	/** Data rows to ignore after the header. */
	skip: number
	columns: PgColumn[]
	/** Readable log of what was chosen, in order. */
	steps: string[]
}

export const MAX_IMPORT_ROWS = 5000

/** Split CSV text into rows. Handles quoted cells, doubled quotes, and quoted newlines. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = []
	let row: string[] = []
	let cell = ''
	let quoted = false
	const src = text.replace(/^\uFEFF/, '')
	for (let i = 0; i < src.length; i++) {
		const ch = src[i]
		if (quoted) {
			if (ch === '"' && src[i + 1] === '"') {
				cell += '"'
				i++
			} else if (ch === '"') quoted = false
			else cell += ch
		} else if (ch === '"') quoted = true
		else if (ch === ',') {
			row.push(cell)
			cell = ''
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && src[i + 1] === '\n') i++
			row.push(cell)
			rows.push(row)
			row = []
			cell = ''
		} else cell += ch
	}
	if (cell !== '' || row.length) {
		row.push(cell)
		rows.push(row)
	}
	return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

export function safeIdent(name: string, index: number): string {
	let id = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '')
	if (!id) id = `col${index + 1}`
	if (/^\d/.test(id)) id = `_${id}`
	return id.slice(0, 60)
}

export function guessType(values: string[]): PgType {
	const filled = values.map((v) => v.trim()).filter((v) => v !== '')
	if (!filled.length) return 'text'
	if (filled.every((v) => /^(true|false)$/i.test(v))) return 'boolean'
	if (filled.every((v) => /^[-+]?\d{1,15}$/.test(v))) return 'integer'
	if (filled.every((v) => /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v))) return 'double precision'
	return 'text'
}

/** Column names and guessed types for the rows after the header and the skipped rows. */
export function suggestColumns(rows: string[][], header: boolean, skip: number): PgColumn[] {
	const width = rows.reduce((max, r) => Math.max(max, r.length), 0)
	const data = rows.slice((header ? 1 : 0) + Math.max(0, skip)).slice(0, 200)
	const used = new Set<string>()
	return Array.from({ length: width }, (_, i) => {
		let name = safeIdent(header ? (rows[0]?.[i] ?? '') : '', i)
		while (used.has(name)) name = `${name}_${i + 1}`
		used.add(name)
		return { name, type: guessType(data.map((r) => r[i] ?? '')) }
	})
}

function quoteIdent(name: string): string {
	return `"${name.replace(/"/g, '""')}"`
}

export function sqlLiteral(value: string | undefined, type: PgType): string {
	const v = (value ?? '').trim()
	if (v === '') return 'NULL'
	if (type === 'integer') return /^[-+]?\d{1,15}$/.test(v) ? String(Number(v)) : 'NULL'
	if (type === 'double precision') return Number.isFinite(Number(v)) ? String(Number(v)) : 'NULL'
	if (type === 'boolean') return /^true$/i.test(v) ? 'TRUE' : /^false$/i.test(v) ? 'FALSE' : 'NULL'
	return `'${(value ?? '').replace(/'/g, "''")}'`
}

export function describeSteps(recipe: Omit<PgImportRecipe, 'steps'>): string[] {
	const steps = [recipe.header ? 'First row is the header' : 'No header row. Columns are named col1, col2, …']
	if (recipe.skip > 0) steps.push(`Ignore ${recipe.skip} data row${recipe.skip === 1 ? '' : 's'}`)
	for (const c of recipe.columns) steps.push(`${c.name}: ${c.type}`)
	return steps
}

/** A new recipe from CSV text, with the guessed columns. */
export function makeRecipe(text: string, table: string, header = true, skip = 0): PgImportRecipe {
	const rows = parseCsv(text)
	const base = { table: safeIdent(table, 0) || 'imported', header, skip, columns: suggestColumns(rows, header, skip) }
	return { ...base, steps: describeSteps(base) }
}

/** SQL that creates the table and loads the rows by following the recipe. */
export function importSql(text: string, recipe: PgImportRecipe): { sql: string; rows: number; truncated: boolean } {
	const all = parseCsv(text)
	const data = all.slice((recipe.header ? 1 : 0) + Math.max(0, recipe.skip))
	const rows = data.slice(0, MAX_IMPORT_ROWS)
	const cols = recipe.columns
	if (!cols.length) throw new Error('The recipe has no columns')
	const table = quoteIdent(recipe.table || 'imported')
	const create = `CREATE TABLE IF NOT EXISTS ${table} (${cols.map((c) => `${quoteIdent(c.name)} ${c.type}`).join(', ')});`
	if (!rows.length) return { sql: create, rows: 0, truncated: false }
	const names = cols.map((c) => quoteIdent(c.name)).join(', ')
	const values = rows
		.map((r) => `(${cols.map((c, i) => sqlLiteral(r[i], c.type)).join(', ')})`)
		.join(',\n')
	return {
		sql: `${create}\nINSERT INTO ${table} (${names}) VALUES\n${values};`,
		rows: rows.length,
		truncated: data.length > rows.length,
	}
}
