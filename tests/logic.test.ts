import { describe, expect, it } from 'vitest'
import { resolveLoopItemResult } from '../shared/logic'

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
