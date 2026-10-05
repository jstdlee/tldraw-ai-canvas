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
	} else throw new Error('Choose a table operation')
	return formatTable(table, job.format)
}
