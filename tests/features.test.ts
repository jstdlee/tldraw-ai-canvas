import { describe, expect, it } from 'vitest'
import { isMermaid, looksLikeMarkdown, toggleTask } from '../shared/clipText'
import { jsonPath, runTextTool } from '../shared/textTools'
import { htmlToText, safeFileName } from '../server/http'

describe('text tools', () => {
	it('templates with both inputs', () => {
		expect(runTextTool('template', 'cat', 'A {{input}} and a {{input2}}', '', 'dog')).toBe('A cat and a dog')
	})
	it('find & replace: literal and regex', () => {
		expect(runTextTool('replace', 'a.b.c', '.', '-')).toBe('a-b-c')
		expect(runTextTool('replace', 'x1 y22', '/(\\d+)/g', '<$1>')).toBe('x<1> y<22>')
	})
	it('extracts regex matches (group 1 when present)', () => {
		const text = 'see https://a.com and http://b.org/x'
		expect(runTextTool('regex', text, 'https?://\\S+')).toBe('https://a.com\nhttp://b.org/x')
		expect(runTextTool('regex', 'id=7; id=9', 'id=(\\d)')).toBe('7\n9')
	})
	it('reads JSON paths', () => {
		const json = JSON.stringify({ data: { items: [{ name: 'a' }, { name: 'b' }] } })
		expect(runTextTool('json', json, 'data.items[1].name')).toBe('b')
		expect(runTextTool('json', json, 'data.items[-1]')).toBe('{\n  "name": "b"\n}')
		expect(jsonPath({ a: [1, 2] }, 'a[0]')).toBe(1)
		expect(() => runTextTool('json', 'not json', 'a')).toThrow('not valid JSON')
	})
	it('splits, joins, sorts, dedupes', () => {
		expect(runTextTool('split', 'a,b,c', ',', '-1')).toBe('c')
		expect(runTextTool('join', 'a\n\nb\nc', ' | ')).toBe('a | b | c')
		expect(runTextTool('sort', 'b10\na\nb2')).toBe('a\nb2\nb10')
		expect(runTextTool('unique', 'x\ny\nx')).toBe('x\ny')
	})
	it('counts, cases, slugs, encodes', () => {
		expect(runTextTool('count', 'one two\nthree')).toBe('3 words, 13 characters (11 without spaces), 2 lines, 0 sentences, 1 paragraph')
		expect(runTextTool('title', 'hello wide world')).toBe('Hello Wide World')
		expect(runTextTool('slug', 'Héllo, World!')).toBe('hello-world')
		expect(runTextTool('base64_decode', runTextTool('base64_encode', 'héllo ✓'))).toBe('héllo ✓')
		expect(runTextTool('url_encode', 'a b&c')).toBe('a%20b%26c')
	})
})

describe('clips', () => {
	it('toggles the right checklist item', () => {
		const md = '- [ ] one\n- [x] two\n* [ ] three'
		expect(toggleTask(md, 0)).toBe('- [x] one\n- [x] two\n* [ ] three')
		expect(toggleTask(md, 1)).toBe('- [ ] one\n- [ ] two\n* [ ] three')
		expect(toggleTask(md, 2)).toBe('- [ ] one\n- [x] two\n* [x] three')
	})
	it('detects Mermaid and Markdown on paste', () => {
		expect(isMermaid('flowchart LR\n A-->B')).toBe(true)
		expect(isMermaid('```mermaid\nsequenceDiagram\n A->>B: hi')).toBe(true)
		expect(isMermaid('just a sentence about graphs')).toBe(false)
		expect(looksLikeMarkdown('# Title\nbody')).toBe(true)
		expect(looksLikeMarkdown('- a\n- b')).toBe(true)
		expect(looksLikeMarkdown('plain line\nanother plain line')).toBe(false)
	})
})

describe('web helpers', () => {
	it('turns HTML into readable text', () => {
		const html = '<html><head><title>T</title><style>x{}</style></head><body><p>Hi &amp; bye</p><script>evil()</script><ul><li>a</li></ul></body></html>'
		expect(htmlToText(html)).toBe('T\n\nHi & bye\n• a')
	})
	it('keeps saved files inside the folder', () => {
		expect(safeFileName('../../etc/passwd', 'x')).toBe('passwd')
		expect(safeFileName('..', 'fallback')).toBe('fallback')
		expect(safeFileName('my report (1).txt', 'x')).toBe('my report (1).txt')
	})
})
