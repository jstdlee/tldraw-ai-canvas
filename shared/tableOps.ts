/** CSV and TSV column tools. No network. Used by the Table node and by tests. */

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
	const source = text.replace(/^\uFEFF/, '')
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

export function parseTable(text: string, format: string): Table {
	const grid = parseDelimited(text.trim(), SEP[format] ?? ',')
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
	if (index < 0) throw new Error(`No column named ${name}`)
	return index
}

function record(table: Table, row: string[]): Record<string, string> {
	return Object.fromEntries(table.headers.map((header, index) => [header, row[index] ?? '']))
}

function isNumber(value: string): boolean {
	return value.trim() !== '' && Number.isFinite(Number(value))
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
			const nums = values.map((v) => Number(v.replace(/,/g, ''))).filter((n) => Number.isFinite(n))
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
		const n = Number((row[valueIndex] ?? '').replace(/,/g, ''))
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

export function runTable(text: string, job: TableJob): string {
	let table = parseTable(text, job.format)
	const sep = job.sep || ' '
	if (job.op === 'select') {
		const names = splitList(job.columns)
		if (!names.length) throw new Error('Name the columns to keep')
		const indexes = names.map((name) => indexOf(table, name))
		table = {
			headers: names,
			rows: table.rows.map((row) => indexes.map((index) => row[index] ?? '')),
		}
	} else if (job.op === 'convert') {
		table = mapColumn(table, job.column, (value) => {
			if (job.as === 'upper') return value.toUpperCase()
			if (job.as === 'lower') return value.toLowerCase()
			if (job.as === 'trim') return value.trim()
			if (job.as === 'number') {
				const number = Number(value.replace(/,/g, ''))
				if (!Number.isFinite(number)) throw new Error(`Not a number: ${value}`)
				return String(number)
			}
			if (job.as === 'date') {
				const date = new Date(value)
				if (Number.isNaN(date.getTime())) throw new Error(`Not a date: ${value}`)
				return date.toISOString()
			}
			throw new Error('Choose a conversion')
		})
	} else if (job.op === 'formula') {
		const name = job.name || job.column
		if (!name) throw new Error('Name the new column')
		if (!table.headers.includes(name)) table.headers.push(name)
		const index = table.headers.indexOf(name)
		table.rows = table.rows.map((row) => {
			const next = row.slice()
			while (next.length < table.headers.length) next.push('')
			next[index] = evalFormula(job.expr, record(table, next))
			return next
		})
	} else if (job.op === 'concat' || job.op === 'join') {
		const names = splitList(job.columns)
		const indexes = (names.length ? names : table.headers).map((name) => indexOf(table, name))
		const name = job.name || 'joined'
		table.headers.push(name)
		table.rows = table.rows.map((row) => [...row, indexes.map((index) => row[index] ?? '').join(sep)])
	} else if (job.op === 'replace') {
		const pattern = new RegExp(job.pattern, 'g')
		table = mapColumn(table, job.column, (value) => value.replace(pattern, job.with))
	} else if (job.op === 'regexp') {
		const pattern = new RegExp(job.pattern)
		const index = indexOf(table, job.column)
		table = { headers: table.headers, rows: table.rows.filter((row) => pattern.test(row[index] ?? '')) }
	} else if (job.op === 'newcol') {
		const name = job.name || 'new'
		const values = job.extra.split(/\r?\n/)
		table.headers.push(name)
		table.rows = table.rows.map((row, index) => {
			const made = job.expr ? evalFormula(job.expr, record(table, row)) : (values[index] ?? '')
			return [...row, made]
		})
	} else if (job.op === 'groupby') {
		// Columns: "score:sum, score:avg, *:count". Column: the group key.
		if (!job.column) throw new Error('Name the group column')
		const aggs = splitList(job.columns || '*:count').map((spec) => {
			const [column, fn] = spec.split(':').map((s) => s.trim())
			if (!column || !fn) throw new Error('Aggregation looks like score:sum')
			return { column, fn }
		})
		table = aggregateTable(table, job.column, aggs)
	} else if (job.op === 'pivot') {
		// Column: row key. Columns: the column whose values become headers. As: sum/avg/min/max/count. Extra: value column.
		if (!job.column || !job.columns) throw new Error('Name the row and column fields')
		const valueCol = job.extra || job.name
		if (!valueCol) throw new Error('Name the value column (New name)')
		table = pivotTable(table, job.column, splitList(job.columns)[0], valueCol, job.as || 'sum')
	} else if (job.op === 'dedupe') {
		const names = splitList(job.columns)
		const indexes = (names.length ? names : table.headers).map((name) => indexOf(table, name))
		const seen = new Set<string>()
		table = {
			headers: table.headers,
			rows: table.rows.filter((row) => {
				const key = indexes.map((index) => row[index] ?? '').join('')
				if (seen.has(key)) return false
				seen.add(key)
				return true
			}),
		}
	} else if (job.op === 'sort') {
		const names = splitList(job.columns || job.column)
		if (!names.length) throw new Error('Name the column to sort by')
		const desc = /desc/i.test(job.as)
		const indexes = names.map((name) => indexOf(table, name))
		table = {
			headers: table.headers,
			rows: [...table.rows].sort((a, b) => {
				for (const index of indexes) {
					const av = a[index] ?? ''
					const bv = b[index] ?? ''
					const an = Number(av.replace(/,/g, ''))
					const bn = Number(bv.replace(/,/g, ''))
					const cmp = Number.isFinite(an) && Number.isFinite(bn) ? an - bn : av.localeCompare(bv)
					if (cmp !== 0) return desc ? -cmp : cmp
				}
				return 0
			}),
		}
	} else throw new Error('Choose a table operation')
	return formatTable(table, job.format)
}
