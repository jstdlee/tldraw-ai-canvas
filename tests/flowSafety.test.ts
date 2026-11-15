import { describe, expect, it } from 'vitest'
import {
	askOutputs,
	clampRetries,
	clampTimeoutMin,
	clampWaitSec,
	fillInput,
	parseAskOptions,
	parseAskReply,
	pendingSetters,
	readVariables,
	retryDelaysMs,
	runWithRetries,
} from '../shared/flowSafety'

/** WP49: pure parts of Try / catch, Ask user, variables and Notify. */

describe('retry timing', () => {
	it('clamps retries to 0–5 and the wait to 0–600 s (default 1 s)', () => {
		expect(clampRetries(-2)).toBe(0)
		expect(clampRetries(3.7)).toBe(3)
		expect(clampRetries(99)).toBe(5)
		expect(clampRetries('x')).toBe(0)
		expect(clampWaitSec(undefined)).toBe(1)
		expect(clampWaitSec(-1)).toBe(0)
		expect(clampWaitSec(9999)).toBe(600)
		expect(retryDelaysMs(3, 0.5)).toEqual([500, 500, 500])
		expect(retryDelaysMs(0, 5)).toEqual([])
	})

	it('retries N times with the wait between, then reports the last error', async () => {
		const waits: number[] = []
		const tried: number[] = []
		const result = await runWithRetries({
			retries: 2,
			waitSec: 2,
			sleep: async (ms) => void waits.push(ms),
			attempt: async (n) => {
				tried.push(n)
				return { ok: false, error: `boom ${n}` }
			},
		})
		expect(tried).toEqual([1, 2, 3])
		expect(waits).toEqual([2000, 2000])
		expect(result).toEqual({ ok: false, error: 'boom 3', attempts: 3 })
	})

	it('stops retrying at the first success', async () => {
		const result = await runWithRetries({
			retries: 5,
			waitSec: 0,
			sleep: async () => {},
			attempt: async (n) => (n === 2 ? { ok: true, value: 'fine' } : { ok: false, error: 'no' }),
		})
		expect(result).toEqual({ ok: true, value: 'fine', attempts: 2 })
	})

	it('a sleep that throws (Stop) ends the retries', async () => {
		await expect(
			runWithRetries({
				retries: 3,
				waitSec: 1,
				sleep: async () => {
					throw new DOMException('Stopped', 'AbortError')
				},
				attempt: async () => ({ ok: false, error: 'no' }),
			})
		).rejects.toThrow('Stopped')
	})
})

describe('Ask user answers', () => {
	it('reads options one per line, trimmed, no blanks or repeats', () => {
		expect(parseAskOptions(' A \n\nB\nA\r\nC ')).toEqual(['A', 'B', 'C'])
		expect(parseAskOptions(undefined)).toEqual([])
	})

	it('maps a reply to exactly one output', () => {
		expect(askOutputs({ kind: 'approve' }, 'draft')).toEqual({ answer: 'draft', rejected: null })
		expect(askOutputs({ kind: 'approve' }, '')).toEqual({ answer: 'approved', rejected: null })
		expect(askOutputs({ kind: 'reject' }, 'draft')).toEqual({ answer: null, rejected: 'draft' })
		expect(askOutputs({ kind: 'reject' }, '')).toEqual({ answer: null, rejected: 'rejected' })
		expect(askOutputs({ kind: 'choose', value: 'B' }, 'x')).toEqual({ answer: 'B', rejected: null })
		expect(askOutputs({ kind: 'text', value: 'hi' }, 'x')).toEqual({ answer: 'hi', rejected: null })
	})

	it('parses a typed reply against the answer type', () => {
		expect(parseAskReply('approve', 'Yes', [])).toEqual({ kind: 'approve' })
		expect(parseAskReply('approve', 'no', [])).toEqual({ kind: 'reject' })
		expect(() => parseAskReply('approve', 'maybe', [])).toThrow('not approve or reject')
		expect(parseAskReply('choose', 'b', ['A', 'B'])).toEqual({ kind: 'choose', value: 'B' })
		expect(() => parseAskReply('choose', 'C', ['A', 'B'])).toThrow('not one of the options')
		expect(parseAskReply('text', ' free words ', [])).toEqual({ kind: 'text', value: ' free words ' })
		expect(parseAskReply('text', 'reject', [])).toEqual({ kind: 'reject' })
	})

	it('timeout 0 or bad means wait forever', () => {
		expect(clampTimeoutMin(0)).toBe(0)
		expect(clampTimeoutMin(-3)).toBe(0)
		expect(clampTimeoutMin('x')).toBe(0)
		expect(clampTimeoutMin(5)).toBe(5)
	})

	it('fills {{input}} with any spacing', () => {
		expect(fillInput('Send {{input}}? ({{ input }})', 'mail')).toBe('Send mail? (mail)')
	})
})

describe('variable ordering', () => {
	const cards = [
		{ id: 's1', type: 'set_variable', name: 'x', settled: false },
		{ id: 's2', type: 'set_variable', name: ' x ', settled: true },
		{ id: 's3', type: 'set_variable', name: 'y', settled: false },
		{ id: 's4', type: 'set_variable', name: 'x', settled: false },
		{ id: 'g', type: 'get_variable', name: 'x', settled: false },
	]
	it('a Get waits for every unsettled Set of its name', () => {
		expect(pendingSetters({ id: 'g', name: 'x' }, cards, new Set())).toEqual(['s1', 's4'])
	})
	it('but not for a Set downstream of itself (that would deadlock)', () => {
		expect(pendingSetters({ id: 'g', name: 'x' }, cards, new Set(['s4']))).toEqual(['s1'])
	})
	it('nothing to wait for once all settled, or with no name', () => {
		const settled = cards.map((card) => ({ ...card, settled: true }))
		expect(pendingSetters({ id: 'g', name: 'x' }, settled, new Set())).toEqual([])
		expect(pendingSetters({ id: 'g', name: ' ' }, cards, new Set())).toEqual([])
	})
	it('reads only string variables from the document meta', () => {
		expect(readVariables({ variables: { a: '1', b: 2, c: null } })).toEqual({ a: '1' })
		expect(readVariables({})).toEqual({})
		expect(readVariables(null)).toEqual({})
		expect(readVariables({ variables: ['x'] })).toEqual({})
	})
})
