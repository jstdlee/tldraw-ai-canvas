import { describe, expect, it } from 'vitest'
import { buildAdhocModelValue, parseModelValue } from '../shared/modelRef'

describe('parseModelValue', () => {
	it('treats a plain string as a configured model key', () => {
		expect(parseModelValue('openai/gpt-4o')).toEqual({ key: 'openai/gpt-4o' })
	})

	it('treats empty / missing values as neither', () => {
		expect(parseModelValue('')).toEqual({})
		expect(parseModelValue(undefined)).toEqual({})
		expect(parseModelValue(null)).toEqual({})
	})

	it('parses an ad-hoc Model provider value', () => {
		const value = buildAdhocModelValue({
			kind: 'adhoc',
			baseURL: 'https://api.openai.com/v1',
			model: 'gpt-4o-mini',
			keyRef: 'secret:abc123',
		})
		expect(parseModelValue(value)).toEqual({
			adhoc: { kind: 'adhoc', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyRef: 'secret:abc123' },
		})
	})

	it('an ad-hoc value never needs a key', () => {
		const value = buildAdhocModelValue({ kind: 'adhoc', baseURL: 'http://127.0.0.1:11434/v1', model: 'llama3.2' })
		expect(parseModelValue(value).adhoc?.keyRef).toBeUndefined()
	})

	it('falls back to a plain key when JSON-looking text is not an ad-hoc ref', () => {
		expect(parseModelValue('{"not":"adhoc"}')).toEqual({ key: '{"not":"adhoc"}' })
		expect(parseModelValue('{not valid json')).toEqual({ key: '{not valid json' })
	})
})
