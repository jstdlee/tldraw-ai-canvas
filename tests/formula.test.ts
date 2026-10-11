import { describe, expect, it } from 'vitest'
import { evaluateFormula } from '../shared/formula'
import { evalFormula } from '../shared/tableOps'

function run(expr: string, row: Record<string, string> = {}): string {
	return evaluateFormula(expr, row)
}

describe('formula: literals and columns', () => {
	it('evaluates numbers, strings, booleans and null', () => {
		expect(run('42')).toBe('42')
		expect(run('"hi"')).toBe('hi')
		expect(run("'hi'")).toBe('hi')
		expect(run('true')).toBe('true')
		expect(run('false')).toBe('false')
		expect(run('isempty(null)')).toBe('true')
	})

	it('reads bare and bracketed column names', () => {
		expect(run('score', { score: '9' })).toBe('9')
		expect(run('[a column]', { 'a column': 'hi' })).toBe('hi')
	})

	it('names the columns when one is unknown', () => {
		expect(() => run('nope', { score: '1', city: 'x' })).toThrow(/no column named "nope".*Columns: score, city/)
	})
})

describe('formula: operator precedence', () => {
	it('multiplication binds tighter than addition', () => {
		expect(run('2 + 3 * 4')).toBe('14')
		expect(run('(2 + 3) * 4')).toBe('20')
	})

	it('comparisons bind looser than arithmetic', () => {
		expect(run('1 + 1 = 2')).toBe('true')
		expect(run('1 + 1 > 3')).toBe('false')
	})

	it('and binds tighter than or', () => {
		expect(run('true or true and false')).toBe('true')
		expect(run('(true or true) and false')).toBe('false')
	})

	it('not negates its operand', () => {
		expect(run('not true')).toBe('false')
		expect(run('not 1 = 2')).toBe('true')
	})

	it('unary minus and concat', () => {
		expect(run('-5 + 3')).toBe('-2')
		expect(run('"a" & "b" & "c"')).toBe('abc')
	})
})

describe('formula: + adds numbers, else concatenates (old behaviour)', () => {
	it('adds when both sides are numbers', () => {
		expect(run('a + b', { a: '1', b: '2' })).toBe('3')
	})

	it('concatenates otherwise', () => {
		expect(run('a + b', { a: 'x', b: 'y' })).toBe('xy')
	})
})

describe('formula: text functions', () => {
	it('upper/lower/trim/len', () => {
		expect(run('upper(name)', { name: 'ada' })).toBe('ADA')
		expect(run('lower("ADA")')).toBe('ada')
		expect(run('trim("  hi  ")')).toBe('hi')
		expect(run('len("hello")')).toBe('5')
	})

	it('left/right/mid', () => {
		expect(run('left("hello", 3)')).toBe('hel')
		expect(run('right("hello", 3)')).toBe('llo')
		expect(run('right("hello", 0)')).toBe('')
		expect(run('mid("hello", 2, 3)')).toBe('ell')
	})

	it('replace', () => {
		expect(run('replace("banana", "a", "o")')).toBe('bonono')
	})

	it('contains/startswith/endswith', () => {
		expect(run('contains("hello", "ell")')).toBe('true')
		expect(run('startswith("hello", "he")')).toBe('true')
		expect(run('endswith("hello", "lo")')).toBe('true')
	})

	it('split', () => {
		expect(run('split("a-b-c", "-", 1)')).toBe('b')
	})

	it('concat and text', () => {
		expect(run('concat("a", "b", "c")')).toBe('abc')
		expect(run('text(5)')).toBe('5')
	})
})

describe('formula: number functions', () => {
	it('number()', () => {
		expect(run('number("42")')).toBe('42')
		expect(() => run('number("abc")')).toThrow(/Formula:/)
	})

	it('round keeps the given decimals', () => {
		expect(run('round(3.14159, 2)')).toBe('3.14')
		expect(run('round(3, 1)')).toBe('3.0')
		expect(run('round(3.5)')).toBe('4')
	})

	it('numbers print without trailing .0 otherwise', () => {
		expect(run('1 + 2')).toBe('3')
		expect(run('6 / 2')).toBe('3')
	})

	it('floor/ceil/abs/min/max/pow/sqrt', () => {
		expect(run('floor(3.7)')).toBe('3')
		expect(run('ceil(3.2)')).toBe('4')
		expect(run('abs(-5)')).toBe('5')
		expect(run('min(3, 1, 2)')).toBe('1')
		expect(run('max(3, 1, 2)')).toBe('3')
		expect(run('pow(2, 3)')).toBe('8')
		expect(run('sqrt(9)')).toBe('3')
	})
})

describe('formula: logic functions', () => {
	it('if/ifs', () => {
		expect(run('if(score > 5, "big", "small")', { score: '9' })).toBe('big')
		expect(run('if(score > 5, "big", "small")', { score: '1' })).toBe('small')
		expect(run('ifs(score < 3, "low", score < 7, "mid", "high")', { score: '5' })).toBe('mid')
		expect(run('ifs(score < 3, "low", score < 7, "mid", "high")', { score: '9' })).toBe('high')
	})

	it('if only evaluates the taken branch', () => {
		expect(run('if(true, 1, nope)')).toBe('1')
	})

	it('coalesce and isempty', () => {
		expect(run('coalesce("", null, "third")')).toBe('third')
		expect(run('isempty("")')).toBe('true')
		expect(run('isempty("x")')).toBe('false')
	})
})

describe('formula: date functions (fixed clock)', () => {
	const date = { d: '2024-03-14' }

	it('date/year/month/day', () => {
		expect(run('date(d)', date)).toBe('2024-03-14')
		expect(run('year(d)', date)).toBe('2024')
		expect(run('month(d)', date)).toBe('3')
		expect(run('day(d)', date)).toBe('14')
	})

	it('weekday (1-7, Mon=1), week, quarter, hour', () => {
		expect(run('weekday(d)', date)).toBe('4') // 2024-03-14 is a Thursday
		expect(run('week(d)', date)).toBe('11')
		expect(run('quarter(d)', date)).toBe('1')
		expect(run('hour("2024-03-14T15:00:00Z")')).toBe('15')
	})

	it('datediff and dateadd', () => {
		expect(run('datediff("2024-01-01", "2024-01-10", "day")')).toBe('9')
		expect(run('datediff("2024-01-01", "2025-03-01", "month")')).toBe('14')
		expect(run('datediff("2020-01-01", "2024-01-01", "year")')).toBe('4')
		expect(run('dateadd("2024-01-01", 5, "day")')).toBe('2024-01-06')
		expect(run('dateadd("2024-01-01", 2, "month")')).toBe('2024-03-01')
		expect(run('dateadd("2024-01-01", 1, "year")')).toBe('2025-01-01')
	})

	it('today() uses the injected clock', () => {
		expect(evaluateFormula('today()', {}, { now: () => new Date('2024-06-15T00:00:00Z') })).toBe('2024-06-15')
	})
})

describe('formula: errors', () => {
	it('names the position and what was expected for a parse error', () => {
		expect(() => run('round(score, 1', { score: '1' })).toThrow(/Formula: expected "\)" after round\(score, 1/)
	})

	it('suggests close function names for an unknown function', () => {
		expect(() => run('uper(name)', { name: 'ada' })).toThrow(/unknown function "uper"/)
	})
})

describe('formula: old forms still give the same results (backward compatibility)', () => {
	it('upper(name)', () => {
		expect(run('upper(name)', { name: 'ada' })).toBe('ADA')
	})

	it('a + b', () => {
		expect(run('a + b', { a: '2', b: '3' })).toBe('5')
	})

	it('quoted strings', () => {
		expect(run('"hello"')).toBe('hello')
		expect(run("'hello'")).toBe('hello')
	})

	it('bare column names', () => {
		expect(run('score', { score: '42' })).toBe('42')
	})

	it('evalFormula (the tableOps-facing entry point) delegates to the same engine', () => {
		expect(evalFormula('upper(name)', { name: 'ada' })).toBe('ADA')
		expect(evalFormula('a + b', { a: '1', b: '2' })).toBe('3')
	})
})
