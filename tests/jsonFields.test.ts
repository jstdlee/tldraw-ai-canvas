import { describe, expect, it } from 'vitest'
import { extractJsonText, parsePaths, runJsonFields, slugPath } from '../shared/jsonFields'

describe('slugPath / parsePaths', () => {
	it('slugs a path into a stable port-id-safe string', () => {
		expect(slugPath('value')).toBe('value')
		expect(slugPath('customer.country')).toBe('customer_country')
		expect(slugPath('data[0].name')).toBe('data_0_name')
		expect(slugPath('  Topic  ')).toBe('topic')
		expect(slugPath('')).toBe('path')
	})

	it('parses one path per line, dropping blanks, each with its own port id', () => {
		expect(parsePaths('value\n\ntopic\ndata[0].name\n')).toEqual([
			{ path: 'value', portId: 'path:value' },
			{ path: 'topic', portId: 'path:topic' },
			{ path: 'data[0].name', portId: 'path:data_0_name' },
		])
	})

	it('dedupes two paths that slug the same', () => {
		const paths = parsePaths('customer.country\nCustomer Country')
		expect(paths.map((p) => p.portId)).toEqual(['path:customer_country', 'path:customer_country_2'])
	})

	it('empty/missing text parses to no paths', () => {
		expect(parsePaths(null)).toEqual([])
		expect(parsePaths('')).toEqual([])
	})
})

describe('extractJsonText', () => {
	it('passes plain JSON through unchanged (trimmed)', () => {
		expect(extractJsonText('  {"a":1}  ')).toBe('{"a":1}')
		expect(extractJsonText('[1,2,3]')).toBe('[1,2,3]')
	})

	it('pulls the first ```json fence out of LLM/Agent prose', () => {
		const prose = 'Here is the result:\n```json\n{"a": 1}\n```\nLet me know if you need more.'
		expect(extractJsonText(prose)).toBe('{"a": 1}')
	})

	it('falls back to the trimmed text when there is no fence and it does not look like JSON', () => {
		expect(extractJsonText('not json at all')).toBe('not json at all')
	})
})

describe('runJsonFields', () => {
	const sample = JSON.stringify({
		value: 'hi',
		topic: 'demo',
		tone: 'friendly',
		customer: { name: 'Ada', country: 'NO' },
		data: [{ name: 'Lin' }, { name: 'Zoe' }],
	})

	it('extracts a scalar, a nested field, and an array-indexed field', () => {
		const result = runJsonFields(sample, 'value\ncustomer.country\ndata[0].name')
		expect(result.values).toEqual({
			'path:value': 'hi',
			'path:customer_country': 'NO',
			'path:data_0_name': 'Lin',
		})
		expect(result.warnings).toEqual([])
	})

	it('objects/arrays are extracted as JSON text, not [object Object]', () => {
		const result = runJsonFields(sample, 'customer')
		expect(result.values['path:customer']).toBe(JSON.stringify({ name: 'Ada', country: 'NO' }))
	})

	it('a missing path is empty, with a warning naming it', () => {
		const result = runJsonFields(sample, 'value\nnope.really')
		expect(result.values['path:value']).toBe('hi')
		expect(result.values['path:nope_really']).toBe('')
		expect(result.warnings).toEqual(['"nope.really" not found'])
	})

	it('"rest" is the object minus the top-level keys that were pulled out', () => {
		const result = runJsonFields(sample, 'value\ncustomer.country')
		expect(JSON.parse(result.rest)).toEqual({ topic: 'demo', tone: 'friendly', data: [{ name: 'Lin' }, { name: 'Zoe' }] })
	})

	it('reads JSON out of a ```json fence inside LLM/Agent prose', () => {
		const prose = 'Sure, here you go:\n```json\n' + sample + '\n```'
		const result = runJsonFields(prose, 'topic')
		expect(result.values['path:topic']).toBe('demo')
	})

	it('a top-level JSON array keeps "rest" as the whole array (no top-level keys to drop)', () => {
		const result = runJsonFields('[{"a":1},{"a":2}]', 'nothing.here')
		expect(JSON.parse(result.rest)).toEqual([{ a: 1 }, { a: 2 }])
	})

	it('throws a clear error for empty or invalid input', () => {
		expect(() => runJsonFields('', 'value')).toThrow(/No JSON/)
		expect(() => runJsonFields('not json', 'value')).toThrow(/not valid JSON/)
	})
})
