import { describe, expect, it } from 'vitest'
import { coerceFieldValue, FieldCoerceError } from '../shared/fieldCoerce'

describe('coerceFieldValue', () => {
	it('coerces numbers from strings and numbers', () => {
		expect(coerceFieldValue('number', '42', 'Top')).toBe(42)
		expect(coerceFieldValue('number', 3.5, 'Top')).toBe(3.5)
		expect(coerceFieldValue('number', '  7 ', 'Top')).toBe(7)
	})

	it('throws on a non-numeric value for a number field', () => {
		expect(() => coerceFieldValue('number', 'abc', 'Top')).toThrow(FieldCoerceError)
		expect(() => coerceFieldValue('number', '', 'Top')).toThrow(FieldCoerceError)
		expect(() => coerceFieldValue('number', NaN, 'Top')).toThrow(FieldCoerceError)
	})

	it('coerces booleans from common words', () => {
		for (const word of ['true', '1', 'yes', 'TRUE', 'Yes']) {
			expect(coerceFieldValue('boolean', word, 'Flag')).toBe(true)
		}
		for (const word of ['false', '0', 'no', '']) {
			expect(coerceFieldValue('boolean', word, 'Flag')).toBe(false)
		}
		expect(coerceFieldValue('boolean', true, 'Flag')).toBe(true)
	})

	it('throws on an unrecognised boolean word', () => {
		expect(() => coerceFieldValue('boolean', 'maybe', 'Flag')).toThrow(FieldCoerceError)
	})

	it('matches enum options case-insensitively and returns the canonical option', () => {
		expect(coerceFieldValue('enum', 'bar', 'Kind', ['Bar', 'Line', 'Pie'])).toBe('Bar')
	})

	it('throws when an enum value is not one of the options, listing them', () => {
		try {
			coerceFieldValue('enum', 'square', 'Kind', ['Bar', 'Line', 'Pie'])
			throw new Error('expected a throw')
		} catch (error) {
			expect(error).toBeInstanceOf(FieldCoerceError)
			expect((error as Error).message).toContain('Bar, Line, Pie')
		}
	})

	it('accepts valid JSON and rejects invalid JSON', () => {
		expect(coerceFieldValue('json', '{"a":1}', 'Params')).toBe('{"a":1}')
		expect(() => coerceFieldValue('json', '{not json', 'Params')).toThrow(FieldCoerceError)
	})

	it('coerces text-like kinds to a string, treating null as empty', () => {
		expect(coerceFieldValue('text', 123, 'Name')).toBe('123')
		expect(coerceFieldValue('longtext', null, 'Name')).toBe('')
		expect(coerceFieldValue('sql', 'SELECT 1', 'SQL')).toBe('SELECT 1')
	})
})
