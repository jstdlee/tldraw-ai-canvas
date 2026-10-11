/** CSV and TSV column tools. No network. Used by the DataPipe node and by tests. */

import { evaluateFormula } from './formula'

export interface Table {
	headers: string[]
	rows: string[][]
}

export interface TableJob {
	format: string
	op: string
	columns: string
	column: string
	as: string
	expr: string
	sep: string
	pattern: string
	with: string
	name: string
	extra: string
	// New, optional (WP11): pivot totals, and a second multi-column field (unpivot's value columns).
	totals?: boolean
	columns2?: string
}

const SEP: Record<string, string> = { tsv: '\t', csv: ',' }

export function splitList(value: string): string[] {
	return value
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)
}

export function parseDelimited(text: string, sep: string): string[][] {
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
	return rows.filter((line) => line.some((part) => part.length > 0))
}

/** 'auto' detects TSV when the first line has a tab, else CSV. 'csv'/'tsv' force it. */
export function detectFormat(text: string, format: string): string {
	if (format !== 'auto') return format
	const firstLine = text.split('\n', 1)[0] ?? ''
	return firstLine.includes('\t') ? 'tsv' : 'csv'
}

export function parseTable(text: string, format: string): Table {
	const sep = SEP[detectFormat(text, format)] ?? ','
	const grid = parseDelimited(text.trim(), sep)
	if (!grid.length) throw new Error('The table is empty')
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

function escapeCell(value: string, sep: string): string {
	if (value.includes('"') || value.includes('\n') || value.includes(sep)) return `"${value.replace(/"/g, '""')}"`
	return value
}

export function formatTable(table: Table, format: string): string {
	const sep = SEP[format] ?? ','
	const lines = [table.headers, ...table.rows].map((line) => line.map((cell) => escapeCell(cell, sep)).join(sep))
	return lines.join('\n')
}

function indexOf(table: Table, name: string): number {
	const index = table.headers.findIndex((header) => header === name)
	if (index < 0) throw new Error(`No column named ${name}. Columns: ${table.headers.join(', ')}`)
	return index
}

function record(table: Table, row: string[]): Record<string, string> {
	return Object.fromEntries(table.headers.map((header, index) => [header, row[index] ?? '']))
}

function isNumber(value: string): boolean {
	return value.trim() !== '' && Number.isFinite(Number(value))
}

function toNumber(value: string): number {
	return Number((value ?? '').replace(/,/g, ''))
}

/** The DataPipe formula column. Delegates to the real engine in shared/formula.ts (tokenizer +
 * parser + evaluator); kept as a thin wrapper so old canvases' stored formulas keep working
 * unchanged (same entry point, same two-argument shape). */
export function evalFormula(expr: string, row: Record<string, string>): string {
	return evaluateFormula(expr, row)
}

function median(nums: number[]): number {
	const sorted = [...nums].sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** One summary spec for Group and summarise: "col:fn" or "col:fn:alias" (old canvases wrote
 * only "col:fn"; the parser in runTable accepts both). "*" as the column needs no real column
 * (used by count). */
export interface AggSpec {
	column: string
	fn: string
	as?: string
}

/** Aggregate rows by one or more group columns + agg specs like "score:sum" or "score:sum:total".
 * Returns the group columns followed by one output column per agg. */
export function aggregateTable(table: Table, groupBy: string[], aggs: AggSpec[]): Table {
	if (!groupBy.length) throw new Error('Group and summarise: choose at least one group column')
	const groupIndexes = groupBy.map((name) => indexOf(table, name))
	// "*:count" counts members without needing a real column.
	const parsed = aggs.map((a) => ({ ...a, index: a.column === '*' ? -1 : indexOf(table, a.column) }))
	const groups = new Map<string, string[][]>()
	const groupKeys = new Map<string, string[]>()
	for (const row of table.rows) {
		const keyParts = groupIndexes.map((index) => row[index] ?? '')
		const key = keyParts.join('\u0001')
		if (!groups.has(key)) {
			groups.set(key, [])
			groupKeys.set(key, keyParts)
		}
		groups.get(key)!.push(row)
	}
	const headers = [...groupBy, ...parsed.map((a) => a.as || `${a.fn}_${a.column}`)]
	const rows = [...groups.entries()].map(([key, members]) => {
		const cells = parsed.map((a) => {
			const values = members.map((m) => m[a.index] ?? '')
			const nums = values.map(toNumber).filter((n) => Number.isFinite(n))
			switch (a.fn) {
				case 'count':
					return String(members.length)
				case 'count_distinct':
					return String(new Set(values).size)
				case 'sum':
					return String(nums.reduce((s, n) => s + n, 0))
				case 'avg':
					return nums.length ? String(nums.reduce((s, n) => s + n, 0) / nums.length) : ''
				case 'median':
					return nums.length ? String(median(nums)) : ''
				case 'min':
					return nums.length ? String(Math.min(...nums)) : ''
				case 'max':
					return nums.length ? String(Math.max(...nums)) : ''
				case 'first':
					return values[0] ?? ''
				case 'last':
					return values[values.length - 1] ?? ''
				case 'list':
					return values.filter(Boolean).join(' | ')
				default:
					throw new Error(`Group and summarise: unknown summary function "${a.fn}"`)
			}
		})
		return [...groupKeys.get(key)!, ...cells]
	})
	return { headers, rows }
}

function pivotAggregate(fn: string, nums: number[]): string {
	if (fn === 'count') return String(nums.length)
	if (!nums.length) return ''
	if (fn === 'sum') return String(nums.reduce((s, n) => s + n, 0))
	if (fn === 'avg') return String(nums.reduce((s, n) => s + n, 0) / nums.length)
	if (fn === 'count_distinct') return String(new Set(nums).size)
	if (fn === 'min') return String(Math.min(...nums))
	if (fn === 'max') return String(Math.max(...nums))
	throw new Error(`Pivot: unknown summary function "${fn}"`)
}

/** Pivot: one or more row-key columns become distinct index rows, one column becomes new
 * headers, and a value column is aggregated into each cell. `fill` replaces empty cells (default
 * ''); `totals` adds a totals row and column (sum for sum/count/count_distinct, otherwise blank). */
export function pivotTable(
	table: Table,
	indexCols: string[],
	column: string,
	value: string,
	fn: string,
	fill = '',
	totals = false
): Table {
	if (!indexCols.length) throw new Error('Pivot: choose at least one row column')
	const indexIndexes = indexCols.map((name) => indexOf(table, name))
	const columnIndex = indexOf(table, column)
	const valueIndex = indexOf(table, value)
	const columns = [...new Set(table.rows.map((row) => row[columnIndex] ?? ''))]
	const buckets = new Map<string, Map<string, number[]>>()
	const rowKeys = new Map<string, string[]>()
	for (const row of table.rows) {
		const keyParts = indexIndexes.map((index) => row[index] ?? '')
		const key = keyParts.join('\u0001')
		const c = row[columnIndex] ?? ''
		const n = toNumber(row[valueIndex] ?? '')
		if (!buckets.has(key)) {
			buckets.set(key, new Map())
			rowKeys.set(key, keyParts)
		}
		const cell = buckets.get(key)!
		if (!cell.has(c)) cell.set(c, [])
		if (Number.isFinite(n)) cell.get(c)!.push(n)
	}
	const cellText = (nums: number[] | undefined): string => {
		const text = pivotAggregate(fn, nums ?? [])
		return text === '' ? fill : text
	}
	const rows = [...buckets.entries()].map(([key, cell]) => {
		const cells = columns.map((c) => cellText(cell.get(c)))
		if (totals) {
			const all = columns.flatMap((c) => cell.get(c) ?? [])
			cells.push(cellText(all))
		}
		return [...rowKeys.get(key)!, ...cells]
	})
	const headers = [...indexCols, ...columns, ...(totals ? ['Total'] : [])]
	if (totals) {
		const totalsRow = columns.map((c) => {
			const all = [...buckets.values()].flatMap((cell) => cell.get(c) ?? [])
			return cellText(all)
		})
		const grandAll = [...buckets.values()].flatMap((cell) => columns.flatMap((c) => cell.get(c) ?? []))
		rows.push([...indexCols.map(() => 'Total'), ...totalsRow, cellText(grandAll)])
	}
	return { headers, rows }
}

/** Columns to rows: the opposite of pivot. `idCols` stay as-is on every output row; each of
 * `valueCols` becomes one row, with its column name in `keyName` and its value in `valueName`. */
export function unpivotTable(table: Table, idCols: string[], valueCols: string[], keyName: string, valueName: string): Table {
	if (!idCols.length) throw new Error('Columns to rows: choose at least one id column')
	if (!valueCols.length) throw new Error('Columns to rows: choose at least one value column')
	const idIndexes = idCols.map((name) => indexOf(table, name))
	const valueIndexes = valueCols.map((name) => indexOf(table, name))
	const headers = [...idCols, keyName || 'key', valueName || 'value']
	const rows: string[][] = []
	for (const row of table.rows) {
		const idCells = idIndexes.map((index) => row[index] ?? '')
		for (let i = 0; i < valueCols.length; i++) {
			rows.push([...idCells, valueCols[i], row[valueIndexes[i]] ?? ''])
		}
	}
	return { headers, rows }
}

function mapColumn(table: Table, name: string, fn: (value: string, row: string[], index: number) => string): Table {
	const index = indexOf(table, name)
	return {
		headers: table.headers,
		rows: table.rows.map((row, rowIndex) => {
			const next = row.slice()
			next[index] = fn(row[index] ?? '', row, rowIndex)
			return next
		}),
	}
}

/** Appends one new column, computed per row (used by the New column ops). */
function addColumn(table: Table, name: string, compute: (row: string[], rowIndex: number) => string): Table {
	return {
		headers: [...table.headers, name],
		rows: table.rows.map((row, rowIndex) => [...row, compute(row, rowIndex)]),
	}
}

// ---------------------------------------------------------------------------
// Operation registry: read by the DataPipe UI (only the chosen op's params
// show) and by the AI (WP7).
// ---------------------------------------------------------------------------

export type ParamKind =
	| 'column'
	| 'columns'
	| 'text'
	| 'number'
	| 'enum'
	| 'formula'
	| 'regex'
	| 'boolean'
	/** Group and summarise's "+ Add summary" rows editor (stored in `columns` as "col:fn[:alias], …"). */
	| 'summaries'
	/** New column "Map values"' from/to rows editor (stored in `pattern` as a JSON array of pairs). */
	| 'mapping'

export interface OpParam {
	field: 'columns' | 'columns2' | 'column' | 'as' | 'expr' | 'sep' | 'pattern' | 'with' | 'name' | 'totals'
	label: string
	kind: ParamKind
	options?: { value: string; label: string }[]
	placeholder?: string
	hint?: string
	required?: boolean
}

export interface OpSpec {
	id: string
	label: string
	group: 'Columns' | 'Rows' | 'Values' | 'New column' | 'Combine' | 'Summarise'
	description: string
	params: OpParam[]
	second?: { label: string; hint: string }
	hidden?: boolean
}

const FILTER_CONDS = [
	{ value: '=', label: '=' },
	{ value: '!=', label: '≠' },
	{ value: '>', label: '>' },
	{ value: '>=', label: '≥' },
	{ value: '<', label: '<' },
	{ value: '<=', label: '≤' },
	{ value: 'contains', label: 'contains' },
	{ value: 'starts', label: 'starts with' },
	{ value: 'ends', label: 'ends with' },
	{ value: 'empty', label: 'is empty' },
	{ value: 'notempty', label: 'is not empty' },
	{ value: 'regex', label: 'matches regexp' },
]

export const TABLE_OPS: OpSpec[] = [
	{
		id: 'select',
		label: 'Keep columns',
		group: 'Columns',
		description: 'Keeps only the chosen columns, in the order picked.',
		params: [{ field: 'columns', label: 'Columns', kind: 'columns', required: true }],
	},
	{
		id: 'drop',
		label: 'Remove columns',
		group: 'Columns',
		description: 'Removes the chosen columns and keeps the rest.',
		params: [{ field: 'columns', label: 'Columns', kind: 'columns', required: true }],
	},
	{
		id: 'rename',
		label: 'Rename column',
		group: 'Columns',
		description: 'Renames one column.',
		params: [
			{ field: 'column', label: 'Column', kind: 'column', required: true },
			{ field: 'name', label: 'New name', kind: 'text', required: true },
		],
	},
	{
		id: 'filter',
		label: 'Filter rows',
		group: 'Rows',
		description: 'Keeps rows where a column matches a condition.',
		params: [
			{ field: 'column', label: 'Column', kind: 'column', required: true },
			{ field: 'as', label: 'Condition', kind: 'enum', options: FILTER_CONDS },
			{ field: 'with', label: 'Value', kind: 'text', placeholder: 'value to compare' },
		],
	},
	{
		id: 'regexp',
		label: 'Keep rows matching pattern',
		group: 'Rows',
		description: 'Keeps rows where a column matches a regular expression.',
		params: [
			{ field: 'column', label: 'Column', kind: 'column' },
			{ field: 'pattern', label: 'Pattern', kind: 'regex' },
		],
	},
	{
		id: 'sort',
		label: 'Sort',
		group: 'Rows',
		description: 'Sorts rows by one or more columns.',
		params: [
			{ field: 'columns', label: 'Columns', kind: 'columns', required: true },
			{
				field: 'as',
				label: 'Order',
				kind: 'enum',
				options: [
					{ value: 'asc', label: 'Ascending' },
					{ value: 'desc', label: 'Descending' },
				],
			},
		],
	},
	{
		id: 'dedupe',
		label: 'Remove duplicate rows',
		group: 'Rows',
		description: 'Keeps the first row of each duplicate group (empty = all columns).',
		params: [{ field: 'columns', label: 'Columns', kind: 'columns', hint: 'empty = all columns' }],
	},
	{
		id: 'head',
		label: 'First N rows',
		group: 'Rows',
		description: 'Keeps the first N rows (negative N keeps the last N).',
		params: [{ field: 'with', label: 'Count', kind: 'number', required: true }],
	},
	{
		id: 'replicate',
		label: 'Repeat rows',
		group: 'Rows',
		description: 'Repeats each row, or the whole table, N times.',
		params: [
			{ field: 'with', label: 'Times', kind: 'number', required: true },
			{
				field: 'as',
				label: 'How',
				kind: 'enum',
				options: [
					{ value: 'each', label: 'Each row N times, in place' },
					{ value: 'table', label: 'Whole table N times' },
				],
			},
		],
	},
	{
		id: 'convert',
		label: 'Convert values',
		group: 'Values',
		description: 'Converts a column’s values: number, date, case, or trim.',
		params: [
			{ field: 'column', label: 'Column', kind: 'column', required: true },
			{
				field: 'as',
				label: 'Convert to',
				kind: 'enum',
				options: [
					{ value: 'number', label: 'Number' },
					{ value: 'date', label: 'Date' },
					{ value: 'upper', label: 'UPPER CASE' },
					{ value: 'lower', label: 'lower case' },
					{ value: 'trim', label: 'Trim' },
				],
			},
		],
	},
	{
		id: 'replace',
		label: 'Find and replace',
		group: 'Values',
		description: 'Replaces every match of a pattern in a column.',
		params: [
			{ field: 'column', label: 'Column', kind: 'column', required: true },
			{ field: 'pattern', label: 'Pattern', kind: 'regex' },
			{ field: 'with', label: 'Replace with', kind: 'text' },
		],
	},
	{
		id: 'fill',
		label: 'Fill empty cells',
		group: 'Values',
		description: 'Fills empty cells with a fixed value, or copies from the cell above or below.',
		params: [
			{ field: 'columns', label: 'Columns', kind: 'columns', hint: 'empty = all columns' },
			{
				field: 'as',
				label: 'Fill with',
				kind: 'enum',
				options: [
					{ value: 'value', label: 'A fixed value' },
					{ value: 'down', label: 'Copy from above' },
					{ value: 'up', label: 'Copy from below' },
				],
			},
			{ field: 'with', label: 'Value', kind: 'text' },
		],
	},
	{
		id: 'split',
		label: 'Split column',
		group: 'Values',
		description: 'Splits a column into several columns at a separator.',
		params: [
			{ field: 'column', label: 'Column', kind: 'column', required: true },
			{ field: 'sep', label: 'Separator', kind: 'text', required: true, placeholder: ',' },
			{ field: 'name', label: 'New column prefix', kind: 'text', placeholder: 'part' },
		],
	},
	{
		id: 'formula',
		label: 'Formula column',
		group: 'New column',
		description: 'Adds a column computed from a small formula, e.g. upper(name).',
		params: [
			{ field: 'name', label: 'New name', kind: 'text', required: true },
			{ field: 'expr', label: 'Formula', kind: 'formula', placeholder: 'e.g. upper(name), score * 2' },
		],
	},
	{
		id: 'concat',
		label: 'Combine columns',
		group: 'New column',
		description: 'Joins several columns into one new text column.',
		params: [
			{ field: 'columns', label: 'Columns', kind: 'columns', hint: 'empty = all columns' },
			{ field: 'sep', label: 'Separator', kind: 'text' },
			{ field: 'name', label: 'New name', kind: 'text' },
		],
	},
	{ id: 'join', label: 'Combine columns (old)', group: 'New column', description: 'Old alias of Combine columns.', params: [], hidden: true },
	{
		id: 'newcol',
		label: 'Column from lines',
		group: 'New column',
		description: 'Adds a column from a formula, or one line per row from the second input.',
		params: [
			{ field: 'name', label: 'New name', kind: 'text' },
			{ field: 'expr', label: 'Formula', kind: 'formula', hint: 'empty = use the values below' },
		],
		second: { label: 'Values, one per line', hint: 'one line per row' },
	},
	{
		id: 'datepart',
		label: 'Date part',
		group: 'New column',
		description: 'Adds a column with one part of a date column (year, month, day…).',
		params: [
			{ field: 'column', label: 'Column', kind: 'column', required: true },
			{
				field: 'as',
				label: 'Part',
				kind: 'enum',
				options: [
					{ value: 'year', label: 'Year' },
					{ value: 'month', label: 'Month' },
					{ value: 'day', label: 'Day' },
					{ value: 'weekday', label: 'Weekday (1–7, Mon=1)' },
					{ value: 'week', label: 'Week (ISO)' },
					{ value: 'quarter', label: 'Quarter' },
					{ value: 'hour', label: 'Hour' },
					{ value: 'date', label: 'Date (YYYY-MM-DD)' },
				],
			},
			{ field: 'name', label: 'New name', kind: 'text', placeholder: 'e.g. month' },
		],
	},
	{
		id: 'bin',
		label: 'Bucket numbers',
		group: 'New column',
		description: 'Adds a column labelling each value by the bucket it falls in, e.g. "10–50".',
		params: [
			{ field: 'column', label: 'Column', kind: 'column', required: true },
			{ field: 'with', label: 'Size or edges', kind: 'text', required: true, placeholder: 'e.g. 10, or 0,10,50,100' },
			{ field: 'name', label: 'New name', kind: 'text', placeholder: 'e.g. bucket' },
		],
	},
	{
		id: 'case',
		label: 'Map values',
		group: 'New column',
		description: 'Adds a column mapping each value through a from → to lookup, with a default.',
		params: [
			{ field: 'column', label: 'Column', kind: 'column', required: true },
			{ field: 'pattern', label: 'Mapping', kind: 'mapping' },
			{ field: 'with', label: 'Default', kind: 'text', hint: 'used when no row matches' },
			{ field: 'name', label: 'New name', kind: 'text', placeholder: 'e.g. mapped' },
		],
	},
	{
		id: 'rank',
		label: 'Rank',
		group: 'New column',
		description: 'Adds a column with each row’s rank by a column’s value.',
		params: [
			{ field: 'column', label: 'Column', kind: 'column', required: true },
			{
				field: 'as',
				label: 'Order',
				kind: 'enum',
				options: [
					{ value: 'desc', label: 'Highest first' },
					{ value: 'asc', label: 'Lowest first' },
				],
			},
			{ field: 'name', label: 'New name', kind: 'text', placeholder: 'e.g. rank' },
		],
	},
	{
		id: 'cumsum',
		label: 'Running total',
		group: 'New column',
		description: 'Adds a column with the running total of a column, top to bottom (optionally per group).',
		params: [
			{ field: 'column', label: 'Column', kind: 'column', required: true },
			{ field: 'with', label: 'Group by', kind: 'column', hint: 'optional — resets the total per group' },
			{ field: 'name', label: 'New name', kind: 'text', placeholder: 'e.g. running_total' },
		],
	},
	{
		id: 'pct',
		label: 'Percent of total',
		group: 'New column',
		description: 'Adds a column with each row’s share of the column’s total (optionally per group).',
		params: [
			{ field: 'column', label: 'Column', kind: 'column', required: true },
			{ field: 'with', label: 'Group by', kind: 'column', hint: 'optional — percent of the group’s total' },
			{ field: 'name', label: 'New name', kind: 'text', placeholder: 'e.g. pct_of_total' },
		],
	},
	{
		id: 'append',
		label: 'Append rows of second table',
		group: 'Combine',
		description: 'Adds the second table’s rows below this one. Columns match by name.',
		params: [],
		second: { label: 'Second table', hint: 'rows to append' },
	},
	{
		id: 'lookup',
		label: 'Join tables by key',
		group: 'Combine',
		description: 'Adds columns from the second table where a key column matches.',
		params: [
			{ field: 'column', label: 'This table’s key', kind: 'column', required: true },
			{ field: 'with', label: 'Second table’s key', kind: 'text', hint: 'empty = same name' },
			{
				field: 'as',
				label: 'Join',
				kind: 'enum',
				options: [
					{ value: 'inner', label: 'Inner (drop unmatched)' },
					{ value: 'left', label: 'Left (keep unmatched)' },
				],
			},
		],
		second: { label: 'Second table', hint: 'joined by key' },
	},
	{
		id: 'groupby',
		label: 'Group and summarise',
		group: 'Summarise',
		description: 'Groups rows by one or more columns and summarises the rest, e.g. score:sum. Output columns are named fn_column (sum_score), or col:fn:alias sets the name.',
		params: [
			{ field: 'column', label: 'Group by', kind: 'columns', required: true },
			{ field: 'columns', label: 'Summaries', kind: 'summaries', placeholder: 'score:sum, *:count' },
		],
	},
	{
		id: 'pivot',
		label: 'Pivot',
		group: 'Summarise',
		description: 'Turns distinct values of one column into new columns.',
		params: [
			{ field: 'column', label: 'Rows', kind: 'columns', required: true },
			{ field: 'columns', label: 'Columns', kind: 'column', required: true },
			{ field: 'name', label: 'Values', kind: 'column' },
			{
				field: 'as',
				label: 'Summary',
				kind: 'enum',
				options: [
					{ value: 'sum', label: 'Sum' },
					{ value: 'avg', label: 'Average' },
					{ value: 'min', label: 'Min' },
					{ value: 'max', label: 'Max' },
					{ value: 'count', label: 'Count' },
					{ value: 'count_distinct', label: 'Count distinct' },
				],
			},
			{ field: 'with', label: 'Fill empty with', kind: 'text' },
			{ field: 'totals', label: 'Add totals', kind: 'boolean' },
		],
	},
	{
		id: 'unpivot',
		label: 'Columns to rows',
		group: 'Summarise',
		description: 'Turns several value columns into key/value row pairs (the opposite of pivot).',
		params: [
			{ field: 'columns', label: 'Id columns', kind: 'columns', required: true },
			{ field: 'columns2', label: 'Value columns', kind: 'columns', required: true },
			{ field: 'name', label: 'Key column name', kind: 'text', placeholder: 'key' },
			{ field: 'as', label: 'Value column name', kind: 'text', placeholder: 'value' },
		],
	},
]

export function opSpec(id: string): OpSpec | undefined {
	return TABLE_OPS.find((spec) => spec.id === id)
}

function splitRespectingQuotes(value: string, sep: string): string[] {
	if (!sep) return [value]
	return value.split(sep)
}

export function runTable(text: string, job: TableJob, second?: string): string {
	const format = detectFormat(text, job.format)
	let table = parseTable(text, format)
	const sep = job.sep || ' '
	const op = job.op
	if (op === 'select') {
		const names = splitList(job.columns)
		if (!names.length) throw new Error('Keep columns: choose at least one column')
		const indexes = names.map((name) => indexOf(table, name))
		table = { headers: names, rows: table.rows.map((row) => indexes.map((index) => row[index] ?? '')) }
	} else if (op === 'drop') {
		const names = new Set(splitList(job.columns))
		if (!names.size) throw new Error('Remove columns: choose at least one column')
		const keep = table.headers.map((h, i) => [h, i] as const).filter(([h]) => !names.has(h))
		table = { headers: keep.map(([h]) => h), rows: table.rows.map((row) => keep.map(([, i]) => row[i] ?? '')) }
	} else if (op === 'rename') {
		if (!job.column) throw new Error('Rename column: choose a column')
		if (!job.name.trim()) throw new Error('Rename column: name the new column')
		const index = indexOf(table, job.column)
		const headers = table.headers.slice()
		headers[index] = job.name.trim()
		table = { headers, rows: table.rows }
	} else if (op === 'filter') {
		if (!job.column) throw new Error('Filter rows: choose a column')
		const index = indexOf(table, job.column)
		const cond = job.as || '='
		const target = job.with
		table = {
			headers: table.headers,
			rows: table.rows.filter((row) => {
				const value = row[index] ?? ''
				if (cond === 'empty') return value.trim() === ''
				if (cond === 'notempty') return value.trim() !== ''
				if (cond === 'contains') return value.includes(target)
				if (cond === 'starts') return value.startsWith(target)
				if (cond === 'ends') return value.endsWith(target)
				if (cond === 'regex') return new RegExp(target).test(value)
				const bothNumbers = isNumber(value) && isNumber(target)
				const a: string | number = bothNumbers ? toNumber(value) : value
				const b: string | number = bothNumbers ? toNumber(target) : target
				switch (cond) {
					case '=':
						return a === b
					case '!=':
						return a !== b
					case '>':
						return a > b
					case '>=':
						return a >= b
					case '<':
						return a < b
					case '<=':
						return a <= b
					default:
						throw new Error(`Filter rows: unknown condition ${cond}`)
				}
			}),
		}
	} else if (op === 'regexp') {
		const pattern = new RegExp(job.pattern)
		const index = indexOf(table, job.column)
		table = { headers: table.headers, rows: table.rows.filter((row) => pattern.test(row[index] ?? '')) }
	} else if (op === 'sort') {
		const names = splitList(job.columns || job.column)
		if (!names.length) throw new Error('Sort: choose a column')
		const desc = /desc/i.test(job.as)
		const indexes = names.map((name) => indexOf(table, name))
		table = {
			headers: table.headers,
			rows: [...table.rows].sort((a, b) => {
				for (const index of indexes) {
					const av = a[index] ?? ''
					const bv = b[index] ?? ''
					const an = toNumber(av)
					const bn = toNumber(bv)
					const cmp = Number.isFinite(an) && Number.isFinite(bn) ? an - bn : av.localeCompare(bv)
					if (cmp !== 0) return desc ? -cmp : cmp
				}
				return 0
			}),
		}
	} else if (op === 'dedupe') {
		const names = splitList(job.columns)
		const indexes = (names.length ? names : table.headers).map((name) => indexOf(table, name))
		const seen = new Set<string>()
		table = {
			headers: table.headers,
			rows: table.rows.filter((row) => {
				const key = indexes.map((index) => row[index] ?? '').join('\u0001')
				if (seen.has(key)) return false
				seen.add(key)
				return true
			}),
		}
	} else if (op === 'head') {
		const n = Math.trunc(Number(job.with))
		if (!Number.isFinite(n) || n === 0) throw new Error('First N rows: give a non-zero count')
		table = { headers: table.headers, rows: n > 0 ? table.rows.slice(0, n) : table.rows.slice(n) }
	} else if (op === 'replicate') {
		const n = Math.trunc(Number(job.with))
		if (!Number.isFinite(n) || n < 1) throw new Error('Repeat rows: give a count of at least 1')
		if (job.as === 'table') {
			const rows: string[][] = []
			for (let i = 0; i < n; i++) rows.push(...table.rows)
			table = { headers: table.headers, rows }
		} else {
			const rows: string[][] = []
			for (const row of table.rows) for (let i = 0; i < n; i++) rows.push(row)
			table = { headers: table.headers, rows }
		}
	} else if (op === 'convert') {
		table = mapColumn(table, job.column, (value) => {
			if (job.as === 'upper') return value.toUpperCase()
			if (job.as === 'lower') return value.toLowerCase()
			if (job.as === 'trim') return value.trim()
			if (job.as === 'number') {
				const number = toNumber(value)
				if (!Number.isFinite(number)) throw new Error(`Convert values: not a number: ${value}`)
				return String(number)
			}
			if (job.as === 'date') {
				const date = new Date(value)
				if (Number.isNaN(date.getTime())) throw new Error(`Convert values: not a date: ${value}`)
				return date.toISOString()
			}
			throw new Error('Convert values: choose a conversion')
		})
	} else if (op === 'replace') {
		const pattern = new RegExp(job.pattern, 'g')
		table = mapColumn(table, job.column, (value) => value.replace(pattern, job.with))
	} else if (op === 'fill') {
		const names = splitList(job.columns)
		const indexes = (names.length ? names : table.headers).map((name) => indexOf(table, name))
		const rows = table.rows.map((row) => row.slice())
		for (const index of indexes) {
			if (job.as === 'down') {
				let last = ''
				for (const row of rows) {
					if ((row[index] ?? '').trim() !== '') last = row[index]
					else row[index] = last
				}
			} else if (job.as === 'up') {
				let last = ''
				for (let i = rows.length - 1; i >= 0; i--) {
					if ((rows[i][index] ?? '').trim() !== '') last = rows[i][index]
					else rows[i][index] = last
				}
			} else {
				for (const row of rows) if ((row[index] ?? '').trim() === '') row[index] = job.with
			}
		}
		table = { headers: table.headers, rows }
	} else if (op === 'split') {
		if (!job.sep) throw new Error('Split column: give a separator')
		const index = indexOf(table, job.column)
		const prefix = job.name || job.column
		const counts = table.rows.map((row) => splitRespectingQuotes(row[index] ?? '', job.sep).length)
		const maxParts = Math.max(1, ...counts)
		const newNames = Array.from({ length: maxParts }, (_, i) => `${prefix}_${i + 1}`)
		const headers = [...table.headers.slice(0, index), ...newNames, ...table.headers.slice(index + 1)]
		const rows = table.rows.map((row) => {
			const parts = splitRespectingQuotes(row[index] ?? '', job.sep)
			while (parts.length < maxParts) parts.push('')
			return [...row.slice(0, index), ...parts, ...row.slice(index + 1)]
		})
		table = { headers, rows }
	} else if (op === 'formula') {
		const name = job.name || job.column
		if (!name) throw new Error('Formula column: name the new column')
		if (!table.headers.includes(name)) table.headers.push(name)
		const index = table.headers.indexOf(name)
		table.rows = table.rows.map((row) => {
			const next = row.slice()
			while (next.length < table.headers.length) next.push('')
			try {
				next[index] = evalFormula(job.expr, record(table, next))
			} catch (error) {
				throw new Error(`Formula column: ${(error as Error).message}`)
			}
			return next
		})
	} else if (op === 'concat' || op === 'join') {
		const names = splitList(job.columns)
		const indexes = (names.length ? names : table.headers).map((name) => indexOf(table, name))
		const name = job.name || 'joined'
		table.headers.push(name)
		table.rows = table.rows.map((row) => [...row, indexes.map((index) => row[index] ?? '').join(sep)])
	} else if (op === 'newcol') {
		const name = job.name || 'new'
		const values = (second ?? job.extra).split(/\r?\n/)
		table.headers.push(name)
		table.rows = table.rows.map((row, index) => {
			if (!job.expr) return [...row, values[index] ?? '']
			try {
				return [...row, evalFormula(job.expr, record(table, row))]
			} catch (error) {
				throw new Error(`Column from lines: ${(error as Error).message}`)
			}
		})
	} else if (op === 'datepart') {
		if (!job.column) throw new Error('Date part: choose a column')
		const index = indexOf(table, job.column)
		const part = job.as || 'year'
		const name = job.name || `${part}_${job.column}`
		table = addColumn(table, name, (row) => {
			const value = row[index] ?? ''
			if (!value.trim()) return ''
			try {
				return evalFormula(`${part}(x)`, { x: value })
			} catch (error) {
				throw new Error(`Date part: ${(error as Error).message}`)
			}
		})
	} else if (op === 'bin') {
		if (!job.column) throw new Error('Bucket numbers: choose a column')
		const index = indexOf(table, job.column)
		const spec = (job.with || '').trim()
		if (!spec) throw new Error('Bucket numbers: give a bucket size, or a list of edges')
		const name = job.name || `${job.column}_bin`
		let edges: number[]
		if (spec.includes(',')) {
			edges = splitList(spec).map(Number)
			if (edges.some((n) => !Number.isFinite(n))) throw new Error('Bucket numbers: edges must be numbers, e.g. 0,10,50,100')
			edges = [...edges].sort((a, b) => a - b)
		} else {
			const size = Number(spec)
			if (!Number.isFinite(size) || size <= 0) throw new Error('Bucket numbers: the size must be a positive number')
			const nums = table.rows.map((row) => toNumber(row[index] ?? '')).filter((n) => Number.isFinite(n))
			const max = nums.length ? Math.max(...nums) : 0
			edges = []
			for (let edge = 0; edge <= max + size; edge += size) edges.push(edge)
		}
		table = addColumn(table, name, (row) => {
			const n = toNumber(row[index] ?? '')
			if (!Number.isFinite(n)) return ''
			if (n < edges[0]) return `<${edges[0]}`
			if (n >= edges[edges.length - 1]) return `${edges[edges.length - 1]}+`
			for (let i = 0; i < edges.length - 1; i++) {
				if (n >= edges[i] && n < edges[i + 1]) return `${edges[i]}–${edges[i + 1]}`
			}
			return ''
		})
	} else if (op === 'case') {
		if (!job.column) throw new Error('Map values: choose a column')
		const index = indexOf(table, job.column)
		const name = job.name || `${job.column}_mapped`
		let pairs: { from: string; to: string }[] = []
		if (job.pattern && job.pattern.trim()) {
			try {
				const parsed = JSON.parse(job.pattern)
				if (Array.isArray(parsed)) {
					pairs = parsed.filter((p): p is { from: string; to: string } => !!p && typeof p === 'object' && 'from' in p && 'to' in p)
				}
			} catch {
				throw new Error('Map values: the mapping is corrupted')
			}
		}
		table = addColumn(table, name, (row) => {
			const value = row[index] ?? ''
			const match = pairs.find((p) => p.from === value)
			return match ? match.to : job.with ?? ''
		})
	} else if (op === 'rank') {
		if (!job.column) throw new Error('Rank: choose a column')
		const index = indexOf(table, job.column)
		const desc = job.as !== 'asc'
		const name = job.name || `${job.column}_rank`
		const order = table.rows
			.map((row, rowIndex) => ({ rowIndex, n: toNumber(row[index] ?? '') }))
			.sort((a, b) => (desc ? b.n - a.n : a.n - b.n))
		const ranks = new Array<number>(table.rows.length)
		order.forEach((entry, position) => {
			ranks[entry.rowIndex] = position + 1
		})
		table = addColumn(table, name, (_row, rowIndex) => String(ranks[rowIndex]))
	} else if (op === 'cumsum') {
		if (!job.column) throw new Error('Running total: choose a column')
		const index = indexOf(table, job.column)
		const groupIndex = job.with ? indexOf(table, job.with) : -1
		const name = job.name || `${job.column}_cumsum`
		const running = new Map<string, number>()
		table = addColumn(table, name, (row) => {
			const key = groupIndex >= 0 ? row[groupIndex] ?? '' : ''
			const n = toNumber(row[index] ?? '')
			const next = (running.get(key) ?? 0) + (Number.isFinite(n) ? n : 0)
			running.set(key, next)
			return String(next)
		})
	} else if (op === 'pct') {
		if (!job.column) throw new Error('Percent of total: choose a column')
		const index = indexOf(table, job.column)
		const groupIndex = job.with ? indexOf(table, job.with) : -1
		const name = job.name || `${job.column}_pct`
		const totals = new Map<string, number>()
		for (const row of table.rows) {
			const key = groupIndex >= 0 ? row[groupIndex] ?? '' : ''
			const n = toNumber(row[index] ?? '')
			totals.set(key, (totals.get(key) ?? 0) + (Number.isFinite(n) ? n : 0))
		}
		table = addColumn(table, name, (row) => {
			const key = groupIndex >= 0 ? row[groupIndex] ?? '' : ''
			const n = toNumber(row[index] ?? '')
			const total = totals.get(key) ?? 0
			if (!total) return ''
			return String((100 * (Number.isFinite(n) ? n : 0)) / total)
		})
	} else if (op === 'append') {
		const extra = second ?? job.extra
		if (!extra || !extra.trim()) throw new Error('Append rows of second table: wire the second table')
		const otherFormat = detectFormat(extra, format)
		const other = parseTable(extra, otherFormat)
		const rows = other.rows.map((row) =>
			table.headers.map((header) => {
				const otherIndex = other.headers.indexOf(header)
				return otherIndex >= 0 ? (row[otherIndex] ?? '') : ''
			})
		)
		table = { headers: table.headers, rows: [...table.rows, ...rows] }
	} else if (op === 'lookup') {
		const extra = second ?? job.extra
		if (!extra || !extra.trim()) throw new Error('Join tables by key: wire the second table')
		if (!job.column) throw new Error('Join tables by key: choose this table’s key column')
		const otherFormat = detectFormat(extra, format)
		const other = parseTable(extra, otherFormat)
		const leftIndex = indexOf(table, job.column)
		const rightKey = job.with || job.column
		const rightIndex = other.headers.findIndex((h) => h === rightKey)
		if (rightIndex < 0) throw new Error(`Join tables by key: no column named ${rightKey} in the second table`)
		const rightCols = other.headers
			.map((h, i) => [h, i] as const)
			.filter(([, i]) => i !== rightIndex)
		const usedNames = new Set(table.headers)
		const rightNames = rightCols.map(([h]) => {
			let name = h
			while (usedNames.has(name)) name = `${name}_2`
			usedNames.add(name)
			return name
		})
		const byKey = new Map<string, string[][]>()
		for (const row of other.rows) {
			const key = row[rightIndex] ?? ''
			if (!byKey.has(key)) byKey.set(key, [])
			byKey.get(key)!.push(row)
		}
		const headers = [...table.headers, ...rightNames]
		const rows: string[][] = []
		for (const row of table.rows) {
			const key = row[leftIndex] ?? ''
			const matches = byKey.get(key) ?? []
			if (!matches.length) {
				if (job.as === 'left' || !job.as) rows.push([...row, ...rightCols.map(() => '')])
				continue
			}
			for (const match of matches) rows.push([...row, ...rightCols.map(([, i]) => match[i] ?? '')])
		}
		table = { headers, rows }
	} else if (op === 'groupby') {
		// Column: "a,b" (one or more group-by columns). Columns: "score:sum, score:avg:avg_score, *:count"
		// (old canvases wrote only "col:fn"; the ":alias" suffix is new and optional).
		if (!job.column) throw new Error('Group and summarise: choose at least one group column')
		const groupCols = splitList(job.column)
		const aggs: AggSpec[] = splitList(job.columns || '*:count').map((spec) => {
			const [column, fn, alias] = spec.split(':').map((s) => s.trim())
			if (!column || !fn) throw new Error('Group and summarise: a summary looks like score:sum (or score:sum:alias)')
			return { column, fn, as: alias }
		})
		table = aggregateTable(table, groupCols, aggs)
	} else if (op === 'pivot') {
		// Column: row key column(s), comma list. Columns: the column whose values become headers.
		// Name: the value column. As: the summary function. With: fill-empty value. Totals: totals row/column.
		const rowCols = splitList(job.column)
		if (!rowCols.length || !job.columns) throw new Error('Pivot: choose the row and header columns')
		const valueCol = job.extra || job.name
		if (!valueCol) throw new Error('Pivot: choose the value column')
		table = pivotTable(table, rowCols, splitList(job.columns)[0], valueCol, job.as || 'sum', job.with ?? '', !!job.totals)
	} else if (op === 'unpivot') {
		const idCols = splitList(job.columns)
		const valueCols = splitList(job.columns2 ?? '')
		table = unpivotTable(table, idCols, valueCols, job.name || 'key', job.as || 'value')
	} else throw new Error('Choose an operation')
	return formatTable(table, format)
}
