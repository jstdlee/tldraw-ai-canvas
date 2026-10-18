import { describe, expect, it } from 'vitest'
import {
	addResultColumn,
	collectResults,
	legacyCollectMode,
	MAX_RANGE_ITEMS,
	rangeItems,
	resolveLoopItemResult,
	rowColumnPorts,
} from '../shared/logic'

/**
 * WP21 Part B ("logic inside For each"): the pure rule for what a For each item contributes
 * to the results list, given what reached the loop body's "result" port (null = nothing did,
 * e.g. the item's path ended in a branch — an If's "else" — that was never wired back) and the
 * node's noResult mode.
 */
describe('resolveLoopItemResult', () => {
	it('uses the result value when something reached "result"', () => {
		expect(resolveLoopItemResult('mapped', 'item-1', 'skip')).toEqual({ value: 'mapped' })
		expect(resolveLoopItemResult('mapped', 'item-1', 'keep')).toEqual({ value: 'mapped' })
		expect(resolveLoopItemResult('mapped', 'item-1', 'error')).toEqual({ value: 'mapped' })
	})

	it('"skip" (default): a no-result item is left out of the output list entirely', () => {
		expect(resolveLoopItemResult(null, 'item-1', 'skip')).toEqual({ value: null })
	})

	it('"keep": a no-result item falls back to the original input item', () => {
		expect(resolveLoopItemResult(null, 'item-1', 'keep')).toEqual({ value: 'item-1' })
	})

	it('"error": a no-result item stops the loop with a message', () => {
		const outcome = resolveLoopItemResult(null, 'item-1', 'error')
		expect(outcome.value).toBeNull()
		expect(outcome.error).toBeTruthy()
	})

	it('an empty string result is still "something reached result", not no-result', () => {
		expect(resolveLoopItemResult('', 'item-1', 'skip')).toEqual({ value: '' })
	})
})

describe('rangeItems (For each "number range")', () => {
	it('counts from..to with both ends included', () => {
		expect(rangeItems(1, 5)).toEqual(['1', '2', '3', '4', '5'])
		expect(rangeItems(0, 10, 5)).toEqual(['0', '5', '10'])
		expect(rangeItems(1, 10, 4)).toEqual(['1', '5', '9'])
	})
	it('counts down with a negative step, or by default when to < from', () => {
		expect(rangeItems(3, 1)).toEqual(['3', '2', '1'])
		expect(rangeItems(10, 0, -5)).toEqual(['10', '5', '0'])
	})
	it('accepts wired text numbers', () => {
		expect(rangeItems('2', '4', '1')).toEqual(['2', '3', '4'])
	})
	it('is empty when the step points away from "to"', () => {
		expect(rangeItems(1, 5, -1)).toEqual([])
	})
	it('rejects a zero or fractional step, non-integers and too many items', () => {
		expect(() => rangeItems(1, 5, 0)).toThrow(/step/)
		expect(() => rangeItems(1, 5, 0.5)).toThrow(/step/)
		expect(() => rangeItems(1.5, 5)).toThrow(/whole numbers/)
		expect(() => rangeItems('a', 5)).toThrow(/whole numbers/)
		expect(() => rangeItems(1, MAX_RANGE_ITEMS + 1)).toThrow(/limit/)
		expect(rangeItems(1, MAX_RANGE_ITEMS)).toHaveLength(MAX_RANGE_ITEMS)
	})
})

/** WP35 Part C: collecting a For each's results independently of the split mode (GAPS-14). */
describe('legacyCollectMode', () => {
	it('matches the pre-WP35 behavior exactly: split "json" collected as json, everything else joined', () => {
		expect(legacyCollectMode('json')).toBe('json')
		expect(legacyCollectMode('lines')).toBe('joined')
		expect(legacyCollectMode('separator')).toBe('joined')
		expect(legacyCollectMode('rows')).toBe('joined')
	})
})

describe('collectResults', () => {
	it('lines / joined / json each produce their own shape, dropping skipped (null) items', () => {
		const aligned = ['a', null, 'b']
		expect(collectResults(aligned, 'lines', ',')).toBe('a\nb')
		expect(collectResults(aligned, 'joined', ' | ')).toBe('a | b')
		expect(collectResults(aligned, 'json', ',')).toBe('["a","b"]')
	})

	it('GAPS-14: "joined" respects "Join with" even for items that came from a JSON-array split', () => {
		// Before WP35, split: 'json' always produced a JSON array, ignoring "Join with" entirely.
		// The collect mode is now independent: picking "joined" explicitly must honor the joiner.
		expect(collectResults(['x', 'y', 'z'], 'joined', '\\n')).toBe('x\ny\nz')
	})

	it('an all-skipped loop collects to an empty result in every mode', () => {
		expect(collectResults([null, null], 'lines', ',')).toBe('')
		expect(collectResults([null, null], 'json', ',')).toBe('[]')
	})
})

describe('addResultColumn (collect: table, add column)', () => {
	it('appends a new column, keeping every row (no result -> empty cell)', () => {
		const built = addResultColumn(['id', 'name'], [['1', 'Ada'], ['2', 'Lin']], 'summary', ['great', null])
		expect(built.headers).toEqual(['id', 'name', 'summary'])
		expect(built.rows).toEqual([['1', 'Ada', 'great'], ['2', 'Lin', '']])
	})

	it('overwrites an existing column of the same name instead of duplicating it', () => {
		const built = addResultColumn(['id', 'summary'], [['1', 'old']], 'summary', ['new'])
		expect(built.headers).toEqual(['id', 'summary'])
		expect(built.rows).toEqual([['1', 'new']])
	})

	it('a blank result-column name falls back to "result"', () => {
		expect(addResultColumn(['id'], [['1']], '  ', ['x']).headers).toEqual(['id', 'result'])
	})

	it('a partial `aligned` (a stopped loop) only covers that many rows', () => {
		const built = addResultColumn(['id'], [['1'], ['2'], ['3']], 'r', ['a'])
		expect(built.rows).toEqual([['1', 'a']])
	})
})

describe('rowColumnPorts (For each "table rows")', () => {
	it('slugs each column into a stable row:<slug> port id', () => {
		expect(rowColumnPorts(['Customer Name', 'total'])).toEqual([
			{ id: 'row:customer_name', label: 'Customer Name' },
			{ id: 'row:total', label: 'total' },
		])
	})

	it('dedupes columns that slug to the same id', () => {
		const ports = rowColumnPorts(['Total', 'total', 'TOTAL'])
		expect(ports.map((p) => p.id)).toEqual(['row:total', 'row:total_2', 'row:total_3'])
	})
})
