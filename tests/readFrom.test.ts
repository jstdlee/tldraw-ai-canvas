import { describe, expect, it } from 'vitest'
import { detectFileKind } from '../shared/fileKind'

describe('detectFileKind', () => {
	it('detects text files by extension', () => {
		expect(detectFileKind('notes.txt', '')).toBe('text')
		expect(detectFileKind('data.csv', 'text/csv')).toBe('text')
		expect(detectFileKind('data.tsv', '')).toBe('text')
		expect(detectFileKind('readme.md', '')).toBe('text')
		expect(detectFileKind('config.json', 'application/json')).toBe('text')
		expect(detectFileKind('page.html', '')).toBe('text')
		expect(detectFileKind('script.py', '')).toBe('text')
	})

	it('detects text files by MIME type when the extension is unknown', () => {
		expect(detectFileKind('file', 'text/plain')).toBe('text')
		expect(detectFileKind('data.weird', 'application/json; charset=utf-8')).toBe('text')
	})

	it('detects images by extension or MIME type', () => {
		expect(detectFileKind('photo.png', 'image/png')).toBe('image')
		expect(detectFileKind('photo.jpg', '')).toBe('image')
		expect(detectFileKind('photo.jpeg', '')).toBe('image')
		expect(detectFileKind('anim.gif', '')).toBe('image')
		expect(detectFileKind('shot.webp', '')).toBe('image')
		expect(detectFileKind('unknown-name', 'image/png')).toBe('image')
	})

	it('detects spreadsheets', () => {
		expect(detectFileKind('book.xlsx', '')).toBe('sheet')
		expect(detectFileKind('book.xls', '')).toBe('sheet')
		expect(detectFileKind('book.ods', '')).toBe('sheet')
		expect(
			detectFileKind('unknown-name', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
		).toBe('sheet')
	})

	it('falls back to binary', () => {
		expect(detectFileKind('archive.zip', 'application/zip')).toBe('binary')
		expect(detectFileKind('app.exe', 'application/octet-stream')).toBe('binary')
		expect(detectFileKind('no-extension-or-mime', '')).toBe('binary')
	})
})
