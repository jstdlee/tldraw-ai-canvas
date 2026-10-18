import { describe, expect, it } from 'vitest'
import { fillTemplate, findTemplateVars, isImageValue } from '../shared/templateCard'

describe('findTemplateVars', () => {
	it('finds plain {{name}} vars, same as Generate text', () => {
		expect(findTemplateVars('Hello {{name}}, your total is {{total}}.')).toEqual(['name', 'total'])
	})

	it('also finds {{name|table}} vars, which the plain regex alone would miss', () => {
		expect(findTemplateVars('{{title}}\n{{rows|table}}')).toEqual(['title', 'rows'])
	})

	it('dedupes a name that appears both plain and with |table', () => {
		expect(findTemplateVars('{{data}}: {{data|table}}')).toEqual(['data'])
	})

	it('no vars at all parses to an empty list', () => {
		expect(findTemplateVars('just plain text')).toEqual([])
	})
})

describe('isImageValue', () => {
	it('recognizes data URLs, uploaded images, and http(s) image URLs', () => {
		expect(isImageValue('data:image/png;base64,aaaa')).toBe(true)
		expect(isImageValue('/api/images/abc.png')).toBe(true)
		expect(isImageValue('https://example.com/pic.jpg')).toBe(true)
	})

	it('rejects plain text/urls', () => {
		expect(isImageValue('hello')).toBe(false)
		expect(isImageValue('https://example.com/page.html')).toBe(false)
	})
})

describe('fillTemplate', () => {
	it('escape: none substitutes the raw value', () => {
		expect(fillTemplate('Hi {{name}}!', { escape: 'none', values: { name: 'Ada' } })).toBe('Hi Ada!')
	})

	it('a missing var becomes an empty string', () => {
		expect(fillTemplate('[{{missing}}]', { escape: 'none', values: {} })).toBe('[]')
	})

	it('GAPS-18: escape: json makes a hand-built JSON body valid even with quotes and newlines', () => {
		const template = '{"text": "{{input}}"}'
		const filled = fillTemplate(template, { escape: 'json', values: { input: 'Hello "world"\nLine2' } })
		expect(() => JSON.parse(filled)).not.toThrow()
		expect(JSON.parse(filled)).toEqual({ text: 'Hello "world"\nLine2' })
	})

	it('escape: html escapes <, >, & in plain text', () => {
		expect(fillTemplate('{{x}}', { escape: 'html', values: { x: '<b>&</b>' } })).toBe('&lt;b&gt;&amp;&lt;/b&gt;')
	})

	it('escape: html turns an image value into an <img> tag instead of escaping it', () => {
		const filled = fillTemplate('{{pic}}', { escape: 'html', values: { pic: 'https://example.com/a.png' } })
		expect(filled).toBe('<img src="https://example.com/a.png">')
	})

	it('an image value outside html mode stays a plain URL/data-URL', () => {
		const filled = fillTemplate('{{pic}}', { escape: 'none', values: { pic: 'https://example.com/a.png' } })
		expect(filled).toBe('https://example.com/a.png')
	})

	it('escape: url percent-encodes the value', () => {
		expect(fillTemplate('q={{q}}', { escape: 'url', values: { q: 'a b&c' } })).toBe('q=a%20b%26c')
	})

	it('escape: csv quotes a value that needs it', () => {
		expect(fillTemplate('{{x}}', { escape: 'csv', values: { x: 'a,b' } })).toBe('"a,b"')
		expect(fillTemplate('{{x}}', { escape: 'csv', values: { x: 'plain' } })).toBe('plain')
	})

	it('{{name|table}} renders a Markdown table by default', () => {
		const filled = fillTemplate('{{rows|table}}', { escape: 'none', values: { rows: 'name,score\nAda,91\nLin,88' } })
		expect(filled).toBe('| name | score |\n| --- | --- |\n| Ada | 91 |\n| Lin | 88 |')
	})

	it('{{name|table}} renders an HTML table when escape: html', () => {
		const filled = fillTemplate('{{rows|table}}', { escape: 'html', values: { rows: 'name,score\nAda,91' } })
		expect(filled).toBe('<table><thead><tr><th>name</th><th>score</th></tr></thead><tbody><tr><td>Ada</td><td>91</td></tr></tbody></table>')
	})

	it('{{name|table}} falls back to the raw value when it is not actually a table', () => {
		// An empty value always fails parseTableText ("The table is empty"), regardless of how
		// liberally it otherwise accepts plain text as a one-column table.
		expect(fillTemplate('[{{x|table}}]', { escape: 'none', values: { x: '' } })).toBe('[]')
	})

	it('a table value is never escaped as plain text even under escape: html', () => {
		// The table's own <table> markup must not get HTML-entity-escaped as if it were a
		// plain string value — only its individual cell text is escaped (inside renderTable).
		const filled = fillTemplate('{{rows|table}}', { escape: 'html', values: { rows: 'a\n"<b>"' } })
		expect(filled).toContain('<table>')
		expect(filled).toContain('&lt;b&gt;')
	})
})
