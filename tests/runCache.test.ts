import { describe, expect, it } from 'vitest'
import { isRunCacheable, usesTimeDependentFormula } from '../shared/runCache'

describe('isRunCacheable', () => {
	it('never caches side-effect or time-dependent node types', () => {
		for (const type of ['http', 'download', 'save', 'camera', 'capture', 'random', 'sleep', 'chat', 'image_gen']) {
			expect(isRunCacheable({ type })).toBe(false)
		}
	})

	it('caches an ordinary card', () => {
		expect(isRunCacheable({ type: 'prompt', text: 'hi' })).toBe(true)
	})

	it('never caches a card whose formula calls today()', () => {
		expect(isRunCacheable({ type: 'table', expr: 'concat(name, today())' })).toBe(false)
	})

	it('never caches a database card whose SQL writes', () => {
		expect(isRunCacheable({ type: 'database', sql: 'insert into t values (1)' })).toBe(false)
		expect(isRunCacheable({ type: 'database', sql: 'update t set a = 1 where id = 1' })).toBe(false)
	})

	it('caches a database card whose SQL only reads', () => {
		expect(isRunCacheable({ type: 'database', sql: 'select * from t' })).toBe(true)
	})
})

describe('usesTimeDependentFormula', () => {
	it('finds today() in any string field', () => {
		expect(usesTimeDependentFormula({ a: 'x', b: 'today()' })).toBe(true)
		expect(usesTimeDependentFormula({ a: 'x', b: 'y' })).toBe(false)
	})
})
