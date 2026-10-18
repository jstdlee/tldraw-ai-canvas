import { describe, expect, it } from 'vitest'
import { sleep } from '../client/pipeline/utils/sleep'
import { isAbortError } from '../shared/abort'

describe('sleep (FLOW-04: Stop must interrupt an in-flight Sleep)', () => {
	it('resolves normally with no signal', async () => {
		const started = Date.now()
		await sleep(20)
		expect(Date.now() - started).toBeGreaterThanOrEqual(15)
	})

	it('rejects immediately when the signal is already aborted', async () => {
		const controller = new AbortController()
		controller.abort()
		const started = Date.now()
		await expect(sleep(5_000, controller.signal)).rejects.toThrow()
		expect(Date.now() - started).toBeLessThan(500)
	})

	it('rejects as soon as the signal aborts mid-wait, well before the timeout', async () => {
		const controller = new AbortController()
		const started = Date.now()
		setTimeout(() => controller.abort(), 20)
		let error: unknown
		try {
			await sleep(5_000, controller.signal)
		} catch (e) {
			error = e
		}
		const elapsed = Date.now() - started
		expect(elapsed).toBeLessThan(500)
		expect(isAbortError(error)).toBe(true)
	})

	it('a completed sleep does not fire the abort listener later', async () => {
		const controller = new AbortController()
		await sleep(10, controller.signal)
		// Aborting afterwards must not throw an unhandled rejection from a stale listener.
		controller.abort()
		await new Promise((r) => setTimeout(r, 10))
	})
})
