import { describe, expect, it } from 'vitest'
import { fillVars, findVars, MAX_TEMPLATE_VARS } from '../shared/templateVars'

describe('findVars', () => {
	it('finds a variable across several texts, in order of first appearance', () => {
		expect(findVars(['Hello {{name}}', 'Topic: {{topic}}'])).toEqual(['name', 'topic'])
	})

	it('dedupes repeated names', () => {
		expect(findVars(['{{a}} and {{b}} and {{a}} again'])).toEqual(['a', 'b'])
	})

	it('ignores empty or missing texts', () => {
		expect(findVars([null, undefined, '', 'plain text, no vars'])).toEqual([])
	})

	it('allows surrounding whitespace inside the braces', () => {
		expect(findVars(['{{ name }}'])).toEqual(['name'])
	})

	it('caps at 12 distinct variables', () => {
		const names = Array.from({ length: 20 }, (_, i) => `v${i}`)
		const text = names.map((n) => `{{${n}}}`).join(' ')
		const found = findVars([text])
		expect(found).toHaveLength(MAX_TEMPLATE_VARS)
		expect(found).toEqual(names.slice(0, MAX_TEMPLATE_VARS))
	})
})

describe('fillVars', () => {
	it('replaces every occurrence with its value', () => {
		expect(fillVars('Hello {{name}}, welcome to {{name}}\'s party', { name: 'Ada' })).toBe(
			"Hello Ada, welcome to Ada's party"
		)
	})

	it('replaces a missing value with an empty string', () => {
		expect(fillVars('Hello {{name}}', {})).toBe('Hello ')
	})

	it('leaves text with no variables unchanged', () => {
		expect(fillVars('plain text', { name: 'Ada' })).toBe('plain text')
	})
})
