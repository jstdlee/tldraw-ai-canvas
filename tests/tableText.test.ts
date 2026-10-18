import { describe, expect, it } from 'vitest'
import { toCsv, parseTableText, sortTableRows } from '../shared/tableText'

describe('toCsv', () => {
	it('quotes only when a cell needs it, and doubles embedded quotes', () => {
		expect(toCsv(['a', 'b'], [['plain', 'has,comma']])).toBe('a,b\nplain,"has,comma"')
		expect(toCsv(['a'], [['has "quote"']])).toBe('a\n"has ""quote"""')
		expect(toCsv(['a'], [['line1\nline2']])).toBe('a\n"line1\nline2"')
	})

	it('writes null/undefined as an empty cell', () => {
		expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\n,')
	})

	it('writes numbers and booleans unquoted', () => {
		expect(toCsv(['n', 'b'], [[10.5, true]])).toBe('n,b\n10.5,true')
	})

	it('writes a Date as an ISO 8601 string', () => {
		const d = new Date('2024-03-01T00:00:00.000Z')
		expect(toCsv(['when'], [[d]])).toBe('when\n2024-03-01T00:00:00.000Z')
	})

	it('round-trips through parseTableText', () => {
		const csv = toCsv(['region', 'month', 'amount'], [
			['North', 'Jan', 10.5],
			['South', 'Feb, late', 7],
			['East', 'Mar', null],
		])
		const table = parseTableText(csv)
		expect(table.headers).toEqual(['region', 'month', 'amount'])
		expect(table.rows).toEqual([
			['North', 'Jan', '10.5'],
			['South', 'Feb, late', '7'],
			['East', 'Mar', ''],
		])
	})
})

describe('parseTableText: CSV / TSV / semicolon', () => {
	it('parses plain CSV', () => {
		expect(parseTableText('a,b\n1,2')).toEqual({ headers: ['a', 'b'], rows: [['1', '2']] })
	})

	it('parses TSV', () => {
		expect(parseTableText('a\tb\n1\t2')).toEqual({ headers: ['a', 'b'], rows: [['1', '2']] })
	})

	it('parses semicolon CSV', () => {
		expect(parseTableText('a;b\n1;2')).toEqual({ headers: ['a', 'b'], rows: [['1', '2']] })
	})

	it('keeps a comma inside a quoted cell', () => {
		const table = parseTableText('a,b\n"x,y",2')
		expect(table.rows).toEqual([['x,y', '2']])
	})

	it('keeps a quote inside a quoted cell', () => {
		const table = parseTableText('a\n"she said ""hi"""')
		expect(table.rows).toEqual([['she said "hi"']])
	})

	it('keeps a newline inside a quoted cell', () => {
		const table = parseTableText('a,b\n"line1\nline2",2')
		expect(table.rows).toEqual([['line1\nline2', '2']])
	})

	it('reads a NULL cell as empty', () => {
		const table = parseTableText('a,b\n1,\n2,x')
		expect(table.rows).toEqual([
			['1', ''],
			['2', 'x'],
		])
	})

	it('parses numbers and unicode as text', () => {
		const table = parseTableText('n,name\n10.5,北京')
		expect(table.rows).toEqual([['10.5', '北京']])
	})

	// DATA-06: a row blank in every column (e.g. a stray ",") survives as an empty row in the
	// middle of the table; only a wholly-blank line at the very start/end is dropped.
	it('keeps an interior wholly-blank row instead of dropping it silently', () => {
		const table = parseTableText('a,b\n1,x\n,\n3,z')
		expect(table).toEqual({ headers: ['a', 'b'], rows: [['1', 'x'], ['', ''], ['3', 'z']] })
	})

	it('still drops a trailing blank line (or several)', () => {
		const table = parseTableText('a,b\n1,2\n\n\n')
		expect(table).toEqual({ headers: ['a', 'b'], rows: [['1', '2']] })
	})

	it('still drops a leading blank line', () => {
		const table = parseTableText('\n\na,b\n1,2')
		expect(table).toEqual({ headers: ['a', 'b'], rows: [['1', '2']] })
	})
})

describe('parseTableText: JSON', () => {
	it('parses a JSON array of objects, unioning keys across rows', () => {
		const table = parseTableText(JSON.stringify([{ a: 1, b: 'x' }, { a: 2, c: true }]))
		expect(table.headers).toEqual(['a', 'b', 'c'])
		expect(table.rows).toEqual([
			['1', 'x', ''],
			['2', '', 'true'],
		])
	})

	it('parses a JSON array of arrays, first row as header', () => {
		const table = parseTableText(JSON.stringify([['a', 'b'], [1, 2], [3, 4]]))
		expect(table).toEqual({ headers: ['a', 'b'], rows: [['1', '2'], ['3', '4']] })
	})

	it('parses a JSON {columns, rows} object', () => {
		const table = parseTableText(JSON.stringify({ columns: ['a', 'b'], rows: [[1, 2], [3, null]] }))
		expect(table).toEqual({ headers: ['a', 'b'], rows: [['1', '2'], ['3', '']] })
	})

	it('throws a clear error for JSON that is not table-shaped', () => {
		expect(() => parseTableText(JSON.stringify({ hello: 'world' }))).toThrow(/not a table/)
	})

	// GAPS-10: a For each loop's collected lines, or Generate image's `images`, come out as a
	// JSON array of scalars — one column, "value", not a hard "not a table" dead end.
	it('parses a JSON array of scalars as one column named "value"', () => {
		const table = parseTableText(JSON.stringify(['a', 'b', 'c']))
		expect(table).toEqual({ headers: ['value'], rows: [['a'], ['b'], ['c']] })
	})

	it('parses a JSON array of numbers the same way', () => {
		const table = parseTableText(JSON.stringify([1, 2, 3]))
		expect(table).toEqual({ headers: ['value'], rows: [['1'], ['2'], ['3']] })
	})

	// GAPS-07/GAPS-10: a `{ data: [...] }` / `{ items: [...] }` wrapper around the real rows —
	// a common REST API shape — is accepted the same way the bare array would be.
	it('accepts a {data: [...]} wrapper around an array of objects', () => {
		const table = parseTableText(JSON.stringify({ meta: { total: 1 }, data: [{ id: 1, name: 'Ada' }] }))
		expect(table).toEqual({ headers: ['id', 'name'], rows: [['1', 'Ada']] })
	})

	it('accepts an {items: [...]} wrapper around an array of scalars', () => {
		const table = parseTableText(JSON.stringify({ items: ['x', 'y'] }))
		expect(table).toEqual({ headers: ['value'], rows: [['x'], ['y']] })
	})

	// GAPS-07: a nested object becomes dotted columns, not "[object Object]"; a nested array of
	// scalars is joined with "; "; a deeper nested array (of objects) is kept as JSON text.
	it('flattens a nested object to dotted columns', () => {
		const table = parseTableText(
			JSON.stringify([{ id: 1, customer: { name: 'Ada', country: 'FR' }, tags: ['x', 'y'], history: [{ at: 1 }] }])
		)
		expect(table.headers).toEqual(['id', 'customer.name', 'customer.country', 'tags', 'history'])
		expect(table.rows).toEqual([['1', 'Ada', 'FR', 'x; y', '[{"at":1}]']])
	})
})

describe('parseTableText: Markdown table', () => {
	it('parses a Markdown table', () => {
		const md = '| name | score |\n| --- | --- |\n| Ada | 3 |\n| Lin | 5 |'
		const table = parseTableText(md)
		expect(table.headers).toEqual(['name', 'score'])
		expect(table.rows).toEqual([
			['Ada', '3'],
			['Lin', '5'],
		])
	})
})

describe('parseTableText: garbage', () => {
	it('throws a clear error naming what it saw, for plain prose', () => {
		expect(() => parseTableText('The quick brown fox jumps over the lazy dog.')).toThrow(/not a table/)
	})

	it('throws for a multi-line paragraph', () => {
		expect(() => parseTableText('This is a sentence.\nSo is this one, with more words.')).toThrow(/not a table/)
	})

	it('throws on empty text', () => {
		expect(() => parseTableText('')).toThrow()
		expect(() => parseTableText('   ')).toThrow()
	})

	// DATA-04: a one-column table of ordinary free text (names, titles, notes) is real data, not
	// a mistake — only a single bare line, or a ragged split, still looks like one.
	it('accepts a one-column table of free text with spaces', () => {
		const table = parseTableText('name\nAda Lovelace\nAda King')
		expect(table).toEqual({ headers: ['name'], rows: [['Ada Lovelace'], ['Ada King']] })
	})

	it('accepts a one-column list with no header row implied, same shape', () => {
		const table = parseTableText('tagline\nPlain one\nPlayful two')
		expect(table).toEqual({ headers: ['tagline'], rows: [['Plain one'], ['Playful two']] })
	})
})

describe('sortTableRows (DATA-05)', () => {
	it('sorts a thousands-separated numeric column numerically, not as text', () => {
		const rows = [['1,000'], ['250'], ['999,000'], ['9,500'], ['80']]
		const sorted = sortTableRows(rows, 0, 'asc')
		expect(sorted.map((r) => r[0])).toEqual(['80', '250', '1,000', '9,500', '999,000'])
	})
})
