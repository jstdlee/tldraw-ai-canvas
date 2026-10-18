import { describe, expect, it } from 'vitest'
import { parseImageList } from '../shared/imageList'

describe('parseImageList', () => {
	it('is empty for nothing', () => {
		expect(parseImageList(null)).toEqual([])
		expect(parseImageList('')).toEqual([])
		expect(parseImageList('   ')).toEqual([])
	})

	it('splits newline-joined URLs (Generate image\'s own "images" port shape)', () => {
		expect(parseImageList('/api/images/a\n/api/images/b')).toEqual(['/api/images/a', '/api/images/b'])
	})

	it('parses a JSON array of strings', () => {
		expect(parseImageList('["/api/images/a", "/api/images/b"]')).toEqual(['/api/images/a', '/api/images/b'])
	})

	it('parses a JSON array of objects with a url/image/src field', () => {
		expect(parseImageList('[{"url":"/a.png"},{"image":"/b.png"},{"src":"/c.png"}]')).toEqual([
			'/a.png',
			'/b.png',
			'/c.png',
		])
	})

	it('drops blank lines and trims whitespace', () => {
		expect(parseImageList('  /a.png  \n\n /b.png\n')).toEqual(['/a.png', '/b.png'])
	})

	it('reads a table\'s url column when the header genuinely names it', () => {
		const csv = 'name,url\nada,/a.png\nbea,/b.png'
		expect(parseImageList(csv)).toEqual(['/a.png', '/b.png'])
	})

	it('never mistakes a plain URL-per-line list for a one-column table (no header row)', () => {
		// These lines contain slashes/colons but no comma/semicolon/tab, and no header naming
		// url/image/src — must stay a plain line list, not get "parsed" into a table that drops
		// the first URL as a header.
		expect(parseImageList('/api/images/a\n/api/images/b\n/api/images/c')).toEqual([
			'/api/images/a',
			'/api/images/b',
			'/api/images/c',
		])
	})

	it('falls back to a line list when something merely looks JSON-ish but is not an array', () => {
		expect(parseImageList('[not valid json')).toEqual(['[not valid json'])
	})
})
