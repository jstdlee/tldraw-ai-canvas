import { describe, expect, it } from 'vitest'
import { shortTimeStamp, slugifyFileName } from '../shared/fileSlug'

describe('slugifyFileName', () => {
	it('lowercases and dashes separators', () => {
		expect(slugifyFileName('Resize Image')).toBe('resize-image')
		expect(slugifyFileName('Crop & Rotate!!')).toBe('crop-rotate')
	})

	it('falls back for empty input', () => {
		expect(slugifyFileName('')).toBe('file')
		expect(slugifyFileName('   ')).toBe('file')
		expect(slugifyFileName('***', 'card')).toBe('card')
	})

	it('caps length', () => {
		expect(slugifyFileName('a'.repeat(200)).length).toBeLessThanOrEqual(60)
	})
})

describe('shortTimeStamp', () => {
	it('is a short string, different for two different real timestamps', () => {
		const a = shortTimeStamp(new Date(Date.now()))
		const b = shortTimeStamp(new Date(Date.now() + 5000))
		expect(a.length).toBeLessThan(10)
		expect(a).not.toBe(b)
	})
})
