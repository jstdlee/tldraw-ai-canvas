/** WP26: the one table-text contract shared by every card that produces or reads a table
 * between cards. Table text on the wire is RFC 4180 CSV with a header row. `parseTableText`
 * accepts that, plus TSV, semicolon CSV, a JSON array of objects or of arrays, a JSON
 * `{ columns, rows }` object, and a Markdown table — auto-detected, never guessed by a per-card
 * setting. Pure, no network, no tldraw import; tested in tests/tableText.test.ts.
 *
 * `Table` is the same shape `shared/tableOps.ts` has used since WP5 (`{ headers, rows }`, rows as
 * string[][]) — imported as a type only here, so this module has no runtime dependency on
 * tableOps.ts (tableOps.ts is the one that imports `toCsv`/`parseTableText` from here). */
import type { Table } from './tableOps'
export type { Table }

function cellToString(value: unknown): string {
	if (value == null) return ''
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
	if (value instanceof Date) return value.toISOString()
	return String(value)
}

/** The one number parser shared across the table-text layer (DATA-05): strips thousands
 * separators before parsing, so "1,000" compares/converts the same way everywhere a cell is
 * read as a number — DataPipe's Convert/Sort ops (`shared/tableOps.ts`), Table view's
 * click-to-sort (`compareCells` below), and the full-size zoom viewer that reuses it. */
export function toNumber(value: string): number {
	return Number((value ?? '').replace(/,/g, ''))
}

function needsQuote(value: string): boolean {
	return value.includes('"') || value.includes('\n') || value.includes('\r') || value.includes(',')
}

function csvCell(value: unknown): string {
	if (value == null) return ''
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
	if (value instanceof Date) return value.toISOString()
	const s = String(value)
	return needsQuote(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * The one writer: RFC 4180 CSV, header row first, comma separator, `"` quoting only when a cell
 * needs it, `""` for a literal quote. `null`/`undefined` become an empty cell; numbers and
 * booleans are written unquoted; a `Date` is written as its ISO 8601 string; everything else is
 * stringified.
 */
export function toCsv(columns: string[], rows: unknown[][]): string {
	const lines = [columns, ...rows].map((line) => line.map(csvCell).join(','))
	return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/** A quote-aware delimited-text splitter (CSV/TSV/semicolon alike): `"` quotes a cell, `""`
 * inside a quoted cell is a literal quote, and a quoted cell may contain the separator or a
 * newline. Blank lines are dropped. */
function splitDelimited(text: string, sep: string): string[][] {
	const rows: string[][] = []
	let row: string[] = []
	let cell = ''
	let quoted = false
	const source = text.replace(/^﻿/, '')
	for (let i = 0; i < source.length; i++) {
		const char = source[i]
		if (quoted) {
			if (char === '"') {
				if (source[i + 1] === '"') {
					cell += '"'
					i++
				} else quoted = false
			} else cell += char
			continue
		}
		if (char === '"') quoted = true
		else if (char === sep) {
			row.push(cell)
			cell = ''
		} else if (char === '\n') {
			row.push(cell)
			rows.push(row)
			row = []
			cell = ''
		} else if (char !== '\r') cell += char
	}
	if (cell.length || row.length) {
		row.push(cell)
		rows.push(row)
	}
	return trimBlankEdgeRows(rows)
}

/** DATA-06: a wholly-empty row (every cell blank) is only dropped at the very start or end of
 * the input — the usual "trailing blank line(s) in a pasted CSV" case — never in the middle, so
 * a genuinely blank data row (e.g. `a,b\n1,x\n,\n3,z`) survives as an empty row instead of
 * silently vanishing with no trace. */
function trimBlankEdgeRows(rows: string[][]): string[][] {
	const isBlank = (line: string[]) => line.every((part) => part.length === 0)
	let start = 0
	while (start < rows.length && isBlank(rows[start])) start++
	let end = rows.length
	while (end > start && isBlank(rows[end - 1])) end--
	return rows.slice(start, end)
}

function fromGrid(grid: string[][]): Table {
	const width = Math.max(...grid.map((line) => line.length))
	const headers = grid[0].map((name, index) => name.trim() || `col${index + 1}`)
	while (headers.length < width) headers.push(`col${headers.length + 1}`)
	const rows = grid.slice(1).map((line) => {
		const next = line.slice()
		while (next.length < headers.length) next.push('')
		return next.slice(0, headers.length)
	})
	return { headers, rows }
}

/** Picks the separator with the most occurrences in the first line: tab, then semicolon, then
 * comma (the common order of preference among the three delimited forms we accept). Falls back
 * to comma when none appear at all (a one-column table, or a single value). */
function detectDelimiter(firstLine: string): string {
	const counts: [string, number][] = [
		['\t', (firstLine.match(/\t/g) ?? []).length],
		[';', (firstLine.match(/;/g) ?? []).length],
		[',', (firstLine.match(/,/g) ?? []).length],
	]
	const best = counts.sort((a, b) => b[1] - a[1])[0]
	return best[1] > 0 ? best[0] : ','
}

/** Prefers a separator that appears the same number of times on every line (a real table has
 * one fewer delimiter occurrence than columns, consistently) over `detectDelimiter`'s first-line
 * guess — a stray comma inside a sentence on just one line should not be mistaken for a column
 * break. A naive split on '\n' is good enough here: it only picks the separator, the real parse
 * below (`splitDelimited`) is quote-aware. */
function pickDelimiter(lines: string[]): string {
	for (const sep of ['\t', ';', ',']) {
		const counts = lines.map((line) => line.split(sep).length - 1)
		if (counts[0] > 0 && counts.every((count) => count === counts[0])) return sep
	}
	return detectDelimiter(lines[0] ?? '')
}

/** GAPS-07: flattens one object's own nested shape to dotted column names (`customer.country`),
 * recursing through plain nested objects. An array of scalars becomes one cell, its values
 * joined with `; `; a deeper array (of objects or arrays) is kept as JSON text — flattening it
 * too would need a column per index, which rarely matches across rows. */
function flattenRecord(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
	const out: Record<string, string> = {}
	for (const [key, value] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${key}` : key
		if (Array.isArray(value)) {
			out[path] = value.every((v) => v === null || typeof v !== 'object') ? value.map((v) => cellToString(v)).join('; ') : JSON.stringify(value)
		} else if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
			Object.assign(out, flattenRecord(value as Record<string, unknown>, path))
		} else {
			out[path] = cellToString(value)
		}
	}
	return out
}

function fromJsonValue(parsed: unknown): Table | null {
	if (Array.isArray(parsed)) {
		if (!parsed.length) return { headers: [], rows: [] }
		if (Array.isArray(parsed[0])) {
			// A JSON array of arrays: the first row is the header, same as CSV.
			const grid = (parsed as unknown[][]).map((line) => line.map(cellToString))
			return fromGrid(grid)
		}
		if (typeof parsed[0] === 'object' && parsed[0] !== null) {
			// A JSON array of objects (e.g. an HTTP or Web search result): the column order is
			// every key's first appearance, across every (flattened) object — rows may not share
			// every key, and a nested object's own keys appear dotted (GAPS-07).
			const objects = parsed as Record<string, unknown>[]
			const flat = objects.map((obj) => (obj && typeof obj === 'object' ? flattenRecord(obj) : {}))
			const headers: string[] = []
			for (const obj of flat) for (const key of Object.keys(obj)) if (!headers.includes(key)) headers.push(key)
			const rows = flat.map((obj) => headers.map((h) => obj[h] ?? ''))
			return { headers, rows }
		}
		// GAPS-10: a JSON array of scalars (strings, numbers, booleans, null) — e.g. a For each
		// loop's collected lines, or Generate image's `images` — becomes one column, "value".
		return { headers: ['value'], rows: parsed.map((v) => [cellToString(v)]) }
	}
	if (parsed && typeof parsed === 'object') {
		const obj = parsed as Record<string, unknown>
		if (Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
			const headers = obj.columns.map(cellToString)
			const rows = (obj.rows as unknown[][]).map((row) => headers.map((_, i) => cellToString(row[i])))
			return { headers, rows }
		}
		// GAPS-07/10: a `{ data: [...] }` / `{ items: [...] }` wrapper around the real rows (a
		// common REST API shape) — accept the one array property, whichever of these it's named.
		for (const key of ['data', 'items', 'rows', 'results']) {
			if (Array.isArray(obj[key])) {
				const inner = fromJsonValue(obj[key])
				if (inner) return inner
			}
		}
	}
	return null
}

function splitMarkdownRow(line: string): string[] {
	// A leading/trailing pipe is optional in the spec; strip one of each if present, then split.
	const body = line.replace(/^\|/, '').replace(/\|$/, '')
	return body.split('|').map((cell) => cell.trim())
}

function fromMarkdownTable(text: string): Table | null {
	const lines = text
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.startsWith('|') && l.endsWith('|') && l.length > 1)
	if (lines.length < 2) return null
	const separator = splitMarkdownRow(lines[1])
	if (!separator.every((cell) => /^:?-{1,}:?$/.test(cell))) return null
	const headers = splitMarkdownRow(lines[0])
	const rows = lines.slice(2).map((line) => {
		const cells = splitMarkdownRow(line)
		while (cells.length < headers.length) cells.push('')
		return cells.slice(0, headers.length)
	})
	return { headers, rows }
}

/**
 * `hadQuotes` (the raw text contained a `"`) is a strong signal that the author meant CSV
 * quoting on purpose, so a quoted table is never flagged as garbage here, however short.
 * DATA-04: a one-column table (every line split to exactly one cell) with more than one row is
 * always accepted now — full names, titles, free-text notes are all legitimate one-column data,
 * and having a space in a cell says nothing about whether it's a real column. Only a single
 * bare line (no row structure at all — just one sentence) or a ragged split (lines split to
 * different widths, as a sentence's stray comma does) still look like a mistake, and only when
 * most of their cells have their own internal whitespace (a real one-column table of plain
 * words or ids has none). */
function garbageError(grid: string[][], hadQuotes: boolean): Error | null {
	if (hadQuotes) return null
	const widths = grid.map((line) => line.length)
	const uniform = widths.every((w) => w === widths[0])
	if (uniform && widths[0] === 1 && grid.length > 1) return null
	const cells = grid.flat()
	const spaced = cells.filter((cell) => /\s/.test(cell.trim())).length
	const mostlySpaced = cells.length > 0 && spaced / cells.length >= 0.5
	if (!mostlySpaced) return null
	if (uniform && widths[0] !== 1) return null
	const sample = grid
		.map((line) => line.join(' '))
		.join(' ')
		.trim()
	const shown = sample.length > 60 ? sample.slice(0, 60) + '…' : sample
	return new Error(`Looks like plain text, not a table: "${shown}"`)
}

/**
 * The one reader. Auto-detects, in order: a JSON array of objects or of arrays, a JSON
 * `{ columns, rows }` object, a Markdown table, then delimited text (tab, semicolon, or comma —
 * whichever appears most in the first line). Never throws on a well-formed one of these; on
 * anything else it throws a clear error naming what it saw.
 */
export function parseTableText(text: string): Table {
	const trimmed = text.trim()
	if (!trimmed) throw new Error('The table is empty')

	if (trimmed[0] === '[' || trimmed[0] === '{') {
		let parsed: unknown
		let isJson = true
		try {
			parsed = JSON.parse(trimmed)
		} catch {
			isJson = false
		}
		if (isJson) {
			const table = fromJsonValue(parsed)
			if (table) return table
			throw new Error('Looks like JSON, but not a table: expected an array of objects, an array of arrays, or {columns, rows}')
		}
	}

	if (trimmed.startsWith('|')) {
		const table = fromMarkdownTable(trimmed)
		if (table) return table
	}

	const hadQuotes = trimmed.includes('"')
	const sep = pickDelimiter(trimmed.split('\n'))
	const grid = splitDelimited(trimmed, sep)
	if (!grid.length) throw new Error('The table is empty')
	const garbage = garbageError(grid, hadQuotes)
	if (garbage) throw garbage
	return fromGrid(grid)
}

// ---------------------------------------------------------------------------
// WP26: shared row filter/sort, used by the Table view card's `execute` (pure, no DOM) and by
// the `SortFilterTable` grid component (`client/pipeline/editors/LargeEditor.tsx`) that shows
// the same result live — so the card's `output`/`json` ports always agree with what's on screen.
// ---------------------------------------------------------------------------

/** Keeps rows where any cell contains `filter`, case-insensitively. Empty filter keeps every row. */
export function filterTableRows(rows: string[][], filter: string): string[][] {
	const needle = filter.trim().toLowerCase()
	if (!needle) return rows
	return rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(needle)))
}

function compareCells(a: string, b: string): number {
	const an = toNumber(a)
	const bn = toNumber(b)
	const bothNumeric = a.trim() !== '' && b.trim() !== '' && Number.isFinite(an) && Number.isFinite(bn)
	return bothNumeric ? an - bn : a.localeCompare(b)
}

/** Sorts by one column (numeric when every non-empty cell in it is a number, else text).
 * `columnIndex: null` returns `rows` unchanged. */
export function sortTableRows(rows: string[][], columnIndex: number | null, dir: 'asc' | 'desc'): string[][] {
	if (columnIndex == null) return rows
	const sorted = rows.slice().sort((a, b) => compareCells(a[columnIndex] ?? '', b[columnIndex] ?? ''))
	if (dir === 'desc') sorted.reverse()
	return sorted
}
