import { describe, expect, it } from 'vitest'
import { cleanNumberText, extractFromText } from '../shared/extractFromText'

describe('cleanNumberText', () => {
	it('strips **bold** markers, trailing % off numbers, and thousands separators', () => {
		expect(cleanNumberText('**45%**')).toBe('45')
		expect(cleanNumberText('1,234.5')).toBe('1234.5')
		expect(cleanNumberText('**Revenue**: $1,000,000 (12%)')).toBe('Revenue: $1000000 (12)')
	})

	it('leaves plain text and non-thousands commas alone', () => {
		expect(cleanNumberText('Ada, Lin, and Zoe')).toBe('Ada, Lin, and Zoe')
	})
})

/**
 * WP35 Part B: 8 real LLM/Agent-style prose fixtures, each with the extra chatty wrapper text
 * a real model answer has around the actual structured data.
 */
describe('extractFromText — 8 LLM-style fixtures', () => {
	it('1. a Markdown table wrapped in explanatory prose (find: auto)', () => {
		const prose = [
			'Here are the findings from the latest survey:',
			'',
			'| Country | Share |',
			'| --- | --- |',
			'| Norway | 42% |',
			'| Sweden | 31% |',
			'',
			'Let me know if you would like a breakdown by age group.',
		].join('\n')
		const result = extractFromText(prose, { find: 'auto' })
		expect(result.kind).toBe('table')
		expect(result.table).toBe('Country,Share\nNorway,42%\nSweden,31%')
	})

	it('2. a ```json fenced block inside an agent-style answer (find: auto)', () => {
		const prose =
			'I looked up the record and here it is:\n\n```json\n{"id": 42, "name": "Ada", "active": true}\n```\n\nAnything else?'
		const result = extractFromText(prose, { find: 'auto' })
		expect(result.kind).toBe('json')
		expect(JSON.parse(result.json)).toEqual({ id: 42, name: 'Ada', active: true })
	})

	it('3. a ```csv fenced block becomes the table output (find: auto)', () => {
		const prose = 'Sure, exported as CSV:\n\n```csv\nname,score\nAda,91\nLin,88\n```\n'
		const result = extractFromText(prose, { find: 'auto' })
		expect(result.kind).toBe('table')
		expect(result.table).toBe('name,score\nAda,91\nLin,88')
	})

	it('4. a bare (unfenced) JSON object mid-sentence (find: auto)', () => {
		const prose = "Sure — here's the summary: {\"topic\": \"billing\", \"sentiment\": \"neutral\"}. Hope that helps!"
		const result = extractFromText(prose, { find: 'auto' })
		expect(result.kind).toBe('json')
		expect(JSON.parse(result.json)).toEqual({ topic: 'billing', sentiment: 'neutral' })
	})

	it('5. a bullet list after a chatty intro (find: auto)', () => {
		const prose = [
			"Based on the transcript, here's what stood out:",
			'',
			'- The customer wants a refund',
			'- The order shipped to the wrong address',
			'- A follow-up call is expected',
			'',
			'Let me know if you need the full transcript.',
		].join('\n')
		const result = extractFromText(prose, { find: 'auto' })
		expect(result.kind).toBe('list')
		expect(result.list).toBe('The customer wants a refund\nThe order shipped to the wrong address\nA follow-up call is expected')
	})

	it('6. a numbered list (find: list, explicit)', () => {
		const prose = 'Steps to reproduce:\n1. Open the app\n2. Click Settings\n3. Crash\n'
		const result = extractFromText(prose, { find: 'list' })
		expect(result.kind).toBe('list')
		expect(result.list).toBe('Open the app\nClick Settings\nCrash')
	})

	it('7. a table with bold headers and %/thousands-separated numbers, cleaned', () => {
		const prose = [
			'| **Region** | **Revenue** |',
			'| --- | --- |',
			'| EU | $1,234,000 |',
			'| US | 56% |',
		].join('\n')
		const result = extractFromText(prose, { find: 'table', clean: true })
		expect(result.table).toBe('Region,Revenue\nEU,$1234000\nUS,56')
	})

	it('8. prose with nothing extractable throws a clear error', () => {
		expect(() => extractFromText('Just a normal paragraph with no structure at all.', { find: 'auto' })).toThrow(
			/No table, JSON, fenced block, or bullet list/
		)
		expect(() => extractFromText('Some prose.', { find: 'table' })).toThrow(/No Markdown table/)
		expect(() => extractFromText('Some prose.', { find: 'json' })).toThrow(/No JSON object or array/)
		expect(() => extractFromText('Some prose.', { find: 'list' })).toThrow(/No bullet or numbered list/)
	})
})

describe('extractFromText — fence language filter and auto ordering', () => {
	it('find: fence with a lang picks that language out of several fences', () => {
		const prose = '```html\n<p>hi</p>\n```\n```python\nprint(1)\n```\n'
		const result = extractFromText(prose, { find: 'fence', lang: 'python' })
		expect(result.kind).toBe('fence')
		expect(result.code).toBe('print(1)')
	})

	it('find: fence with no lang takes the first fence, any language', () => {
		const result = extractFromText('```js\nconsole.log(1)\n```\n', { find: 'fence' })
		expect(result.code).toBe('console.log(1)')
	})

	it('auto picks whichever shape appears first in the text, not a fixed type priority', () => {
		const prose = '- First item\n- Second item\n\nAnd the raw data: {"a": 1}'
		const result = extractFromText(prose, { find: 'auto' })
		expect(result.kind).toBe('list')
	})
})
