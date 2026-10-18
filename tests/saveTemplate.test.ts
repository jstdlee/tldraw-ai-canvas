import { describe, expect, it } from 'vitest'
import { fillSaveFileName } from '../shared/saveTemplate'

describe('fillSaveFileName', () => {
	it('fills every token', () => {
		expect(fillSaveFileName('{{name}}-{{date}}-{{index}}', { name: 'crop', date: '2026-10-18', index: '3' })).toBe(
			'crop-2026-10-18-3'
		)
	})

	it('leaves a template with no tokens untouched', () => {
		expect(fillSaveFileName('report.csv', { name: 'x', date: 'y', index: '1' })).toBe('report.csv')
	})

	it('allows whitespace inside the braces', () => {
		expect(fillSaveFileName('{{ name }}', { name: 'crop', date: 'y', index: '1' })).toBe('crop')
	})

	it('ignores an unknown token', () => {
		expect(fillSaveFileName('{{nope}}', { name: 'crop', date: 'y', index: '1' })).toBe('{{nope}}')
	})
})
