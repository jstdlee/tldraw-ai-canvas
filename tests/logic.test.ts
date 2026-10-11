import { describe, expect, it } from 'vitest'
import { MAX_RANGE_ITEMS, rangeItems, resolveLoopItemResult } from '../shared/logic'

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
