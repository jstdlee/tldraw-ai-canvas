/** CSV and TSV column tools. No network. Used by the DataPipe node and by tests. */

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

/** Small string formula. Columns are names. + adds numbers or joins text. */
export function evalFormula(expr: string, row: Record<string, string>): string {
	const source = expr.trim()
	const call = /^([a-z]+)\((.*)\)$/i.exec(source)
	if (call) {
		const fn = call[1].toLowerCase()
		const args = splitArgs(call[2]).map((arg) => evalFormula(arg, row))
		if (fn === 'upper') return (args[0] ?? '').toUpperCase()
		if (fn === 'lower') return (args[0] ?? '').toLowerCase()
		if (fn === 'trim') return (args[0] ?? '').trim()
		if (fn === 'len') return String((args[0] ?? '').length)
		if (fn === 'concat') return args.join('')
		if (fn === 'replace') {
			const pattern = args[1] ?? ''
			return (args[0] ?? '').replace(new RegExp(pattern, 'g'), args[2] ?? '')
		}
		throw new Error(`Unknown function ${fn}`)
	}
	if (source.includes('+')) {
		const parts = source.split('+').map((part) => evalFormula(part.trim(), row))
		if (parts.every(isNumber)) return String(parts.reduce((sum, part) => sum + Number(part), 0))
		return parts.join('')
	}
	if ((source.startsWith('"') && source.endsWith('"')) || (source.startsWith("'") && source.endsWith("'"))) {
		return source.slice(1, -1)
	}
	if (Object.prototype.hasOwnProperty.call(row, source)) return row[source] ?? ''
	return source
}

function splitArgs(body: string): string[] {
	const args: string[] = []
	let current = ''
	let depth = 0
	let quote = ''
	for (const char of body) {
		if (quote) {
			current += char
			if (char === quote) quote = ''
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			current += char
		} else if (char === '(') {
			depth++
			current += char
		} else if (char === ')') {
			depth--
			current += char
		} else if (char === ',' && depth === 0) {
			args.push(current.trim())
			current = ''
		} else current += char
	}
	if (current.trim()) args.push(current.trim())
	return args
}

/** Aggregate rows by a column: groupBy column + agg like "score:sum". Returns group + one column per agg. */
export function aggregateTable(table: Table, groupBy: string, aggs: { column: string; fn: string; as?: string }[]): Table {
	const groupIndex = indexOf(table, groupBy)
	// "*:count" counts members without needing a real column.
	const parsed = aggs.map((a) => ({ ...a, index: a.column === '*' ? -1 : indexOf(table, a.column) }))
	const groups = new Map<string, string[][]>()
	for (const row of table.rows) {
		const key = row[groupIndex] ?? ''
		if (!groups.has(key)) groups.set(key, [])
		groups.get(key)!.push(row)
	}
	const headers = [groupBy, ...parsed.map((a) => a.as || `${a.fn}_${a.column}`)]
	const rows = [...groups.entries()].map(([key, members]) => {
		const cells = parsed.map((a) => {
			const values = members.map((m) => m[a.index] ?? '')
			const nums = values.map(toNumber).filter((n) => Number.isFinite(n))
			switch (a.fn) {
				case 'count':
					return String(members.length)
				case 'sum':
					return String(nums.reduce((s, n) => s + n, 0))
				case 'avg':
					return nums.length ? String(nums.reduce((s, n) => s + n, 0) / nums.length) : ''
				case 'min':
					return nums.length ? String(Math.min(...nums)) : ''
				case 'max':
					return nums.length ? String(Math.max(...nums)) : ''
				case 'list':
					return values.filter(Boolean).join(' | ')
				default:
					throw new Error(`Unknown aggregation ${a.fn}`)
			}
		})
		return [key, ...cells]
	})
	return { headers, rows }
}

/** Pivot: rows become distinct index values, columns become distinct column values, cells aggregated. */
export function pivotTable(table: Table, index: string, column: string, value: string, fn: string): Table {
	const indexIndex = indexOf(table, index)
	const columnIndex = indexOf(table, column)
	const valueIndex = indexOf(table, value)
	const columns = [...new Set(table.rows.map((row) => row[columnIndex] ?? ''))]
	const buckets = new Map<string, Map<string, number[]>>()
	for (const row of table.rows) {
		const r = row[indexIndex] ?? ''
		const c = row[columnIndex] ?? ''
		const n = toNumber(row[valueIndex] ?? '')
		if (!buckets.has(r)) buckets.set(r, new Map())
		const cell = buckets.get(r)!
		if (!cell.has(c)) cell.set(c, [])
		if (Number.isFinite(n)) cell.get(c)!.push(n)
	}
	const aggregate = (nums: number[]): string => {
		if (fn === 'count') return String(nums.length)
		if (!nums.length) return ''
		if (fn === 'sum') return String(nums.reduce((s, n) => s + n, 0))
		if (fn === 'avg') return String(nums.reduce((s, n) => s + n, 0) / nums.length)
		if (fn === 'min') return String(Math.min(...nums))
		if (fn === 'max') return String(Math.max(...nums))
		throw new Error(`Unknown aggregation ${fn}`)
	}
	const rows = [...buckets.entries()].map(([r, cell]) => [r, ...columns.map((c) => aggregate(cell.get(c) ?? []))])
	return { headers: [index, ...columns], rows }
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

// ---------------------------------------------------------------------------
// Operation registry: read by the DataPipe UI (only the chosen op's params
// show) and by the AI (WP7).
// ---------------------------------------------------------------------------

export type ParamKind = 'column' | 'columns' | 'text' | 'number' | 'enum' | 'formula' | 'regex'

export interface OpParam {
	field: 'columns' | 'column' | 'as' | 'expr' | 'sep' | 'pattern' | 'with' | 'name'
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
		description: 'Groups rows by a column and summarises the rest, e.g. score:sum.',
		params: [
			{ field: 'column', label: 'Group by', kind: 'column', required: true },
			{ field: 'columns', label: 'Summaries', kind: 'text', placeholder: 'score:sum, *:count' },
		],
	},
	{
		id: 'pivot',
		label: 'Pivot',
		group: 'Summarise',
		description: 'Turns distinct values of one column into new columns.',
		params: [
			{ field: 'column', label: 'Row key', kind: 'column', required: true },
			{ field: 'columns', label: 'Header column', kind: 'column', required: true },
			{ field: 'name', label: 'Value column', kind: 'column' },
			{
				field: 'as',
				label: 'Summarise with',
				kind: 'enum',
				options: [
					{ value: 'sum', label: 'Sum' },
					{ value: 'avg', label: 'Average' },
					{ value: 'min', label: 'Min' },
					{ value: 'max', label: 'Max' },
					{ value: 'count', label: 'Count' },
				],
			},
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
			next[index] = evalFormula(job.expr, record(table, next))
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
			const made = job.expr ? evalFormula(job.expr, record(table, row)) : (values[index] ?? '')
			return [...row, made]
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
		// Columns: "score:sum, score:avg, *:count". Column: the group key.
		if (!job.column) throw new Error('Group and summarise: name the group column')
		const aggs = splitList(job.columns || '*:count').map((spec) => {
			const [column, fn] = spec.split(':').map((s) => s.trim())
			if (!column || !fn) throw new Error('Group and summarise: a summary looks like score:sum')
			return { column, fn }
		})
		table = aggregateTable(table, job.column, aggs)
	} else if (op === 'pivot') {
		// Column: row key. Columns: the column whose values become headers. Name/extra: value column.
		if (!job.column || !job.columns) throw new Error('Pivot: name the row and header columns')
		const valueCol = job.extra || job.name
		if (!valueCol) throw new Error('Pivot: name the value column')
		table = pivotTable(table, job.column, splitList(job.columns)[0], valueCol, job.as || 'sum')
	} else throw new Error('Choose an operation')
	return formatTable(table, format)
}
