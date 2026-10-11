import { describe, expect, it } from 'vitest'
import { runHash } from '../shared/runHash'

describe('runHash', () => {
	it('is stable for the same value', () => {
		expect(runHash({ type: 'prompt', text: 'hello' })).toBe(runHash({ type: 'prompt', text: 'hello' }))
	})

	it('does not depend on key order', () => {
		expect(runHash({ a: 1, b: 2 })).toBe(runHash({ b: 2, a: 1 }))
	})

	it('changes when a value changes', () => {
		expect(runHash({ a: 1 })).not.toBe(runHash({ a: 2 }))
	})

	it('changes when a key is added or removed', () => {
		expect(runHash({ a: 1 })).not.toBe(runHash({ a: 1, b: 1 }))
	})

	it('treats undefined fields like null', () => {
		expect(runHash({ a: undefined })).toBe(runHash({ a: null }))
	})

	it('distinguishes nested object shapes from arrays', () => {
		expect(runHash({ a: [1, 2] })).not.toBe(runHash({ a: { 0: 1, 1: 2 } }))
	})

	it('returns a short base-36 string', () => {
		const hash = runHash('anything')
		expect(hash).toMatch(/^[0-9a-z]+$/)
		expect(hash.length).toBeLessThan(12)
	})
})
