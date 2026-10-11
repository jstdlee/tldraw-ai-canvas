import { describe, expect, it } from 'vitest'
import { toCsv, parseTableText } from '../shared/tableText'

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
		expect(() => parseTableText(JSON.stringify(['a', 'b', 'c']))).toThrow(/not a table/)
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
})
