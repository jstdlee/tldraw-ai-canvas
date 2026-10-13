import { describe, expect, it } from 'vitest'
import {
	assembleHtmlDocument,
	bridgePayloadToJson,
	BRIDGE_MARKER,
	BRIDGE_MAX_BYTES,
	buildFormBridgeScript,
	looksLikeFullDocument,
	parseBridgePayload,
	previewCsp,
	splitFencedBlocks,
} from '../shared/htmlPreview'

describe('splitFencedBlocks', () => {
	it('splits html/css/js fenced blocks out of LLM-style text', () => {
		const text = [
			'Here you go:',
			'```html',
			'<button>Hi</button>',
			'```',
			'```css',
			'button { color: red; }',
			'```',
			'```js',
			'console.log(1)',
			'```',
		].join('\n')
		const blocks = splitFencedBlocks(text)
		expect(blocks.hasFences).toBe(true)
		expect(blocks.html).toBe('<button>Hi</button>')
		expect(blocks.css).toBe('button { color: red; }')
		expect(blocks.js).toBe('console.log(1)')
		expect(blocks.plain).toBe('Here you go:')
	})

	it('accepts ```javascript as a js fence', () => {
		const blocks = splitFencedBlocks('```javascript\nconst a = 1\n```')
		expect(blocks.js).toBe('const a = 1')
	})

	it('joins repeated same-language fences', () => {
		const blocks = splitFencedBlocks('```html\n<p>a</p>\n```\n```html\n<p>b</p>\n```')
		expect(blocks.html).toBe('<p>a</p>\n\n<p>b</p>')
	})

	it('treats text with no fences as plain, with no html/css/js', () => {
		const blocks = splitFencedBlocks('<div>fragment</div>')
		expect(blocks.hasFences).toBe(false)
		expect(blocks.plain).toBe('<div>fragment</div>')
		expect(blocks.html).toBe('')
	})
})

describe('looksLikeFullDocument', () => {
	it('recognizes <html> and <!doctype>, not a fragment', () => {
		expect(looksLikeFullDocument('<!DOCTYPE html><html></html>')).toBe(true)
		expect(looksLikeFullDocument('<HTML><body></body></HTML>')).toBe(true)
		expect(looksLikeFullDocument('<div>hi</div>')).toBe(false)
	})
})

describe('previewCsp', () => {
	it('blocks everything by default, relaxes img/connect/font/media when network is allowed', () => {
		const blocked = previewCsp(false)
		expect(blocked).toContain("default-src 'none'")
		expect(blocked).not.toContain('connect-src')

		const allowed = previewCsp(true)
		expect(allowed).toContain('connect-src https: http:')
		expect(allowed).toContain('img-src data: blob: https: http:')
	})
})

describe('assembleHtmlDocument', () => {
	it('wraps a plain fragment in a minimal document with a CSP meta tag', () => {
		const doc = assembleHtmlDocument({ text: '<button>Hi</button>' })
		expect(doc).toContain('<!DOCTYPE html>')
		expect(doc).toContain('Content-Security-Policy')
		expect(doc).toContain('<button>Hi</button>')
	})

	it('splits fenced blocks out of `text` and assembles them', () => {
		const doc = assembleHtmlDocument({ text: '```html\n<p>hi</p>\n```\n```css\np{color:red}\n```' })
		expect(doc).toContain('<p>hi</p>')
		expect(doc).toContain('<style>p{color:red}</style>')
	})

	it('explicit html/css/js override anything found in text', () => {
		const doc = assembleHtmlDocument({
			text: '```html\n<p>from text</p>\n```',
			html: '<p>from override</p>',
			css: 'p{color:blue}',
		})
		expect(doc).toContain('from override')
		expect(doc).not.toContain('from text')
		expect(doc).toContain('color:blue')
	})

	it('injects css/js/CSP into a full document instead of double-wrapping it', () => {
		const doc = assembleHtmlDocument({ html: '<html><head><title>x</title></head><body><p>hi</p></body></html>', css: 'p{color:green}' })
		expect(doc.match(/<html/gi)?.length).toBe(1)
		expect(doc).toContain('color:green')
		expect(doc).toContain('Content-Security-Policy')
	})

	it('does not allow network by default, and relaxes the CSP when asked', () => {
		const blocked = assembleHtmlDocument({ text: '<p>hi</p>' })
		expect(blocked).toContain(previewCsp(false))
		const allowed = assembleHtmlDocument({ text: '<p>hi</p>' }, { allowNetwork: true })
		expect(allowed).toContain(previewCsp(true))
	})

	it('injects the given script right before </body>', () => {
		const doc = assembleHtmlDocument({ text: '<p>hi</p>' }, { injectScript: 'window.__bridge = 1' })
		expect(doc).toContain('<script>window.__bridge = 1</script>')
		expect(doc.indexOf('__bridge')).toBeGreaterThan(doc.indexOf('<p>hi</p>'))
	})
})

describe('buildFormBridgeScript', () => {
	it('posts messages tagged with the bridge marker', () => {
		const script = buildFormBridgeScript()
		expect(script).toContain('postMessage')
		expect(script).toContain(BRIDGE_MARKER)
		expect(script).toContain("addEventListener('submit'")
		expect(script).toContain("addEventListener('click'")
	})
})

describe('parseBridgePayload', () => {
	it('accepts a valid submit payload', () => {
		const payload = parseBridgePayload({ [BRIDGE_MARKER]: true, kind: 'submit', fields: { name: 'Ada', ok: true } })
		expect(payload).toEqual({ kind: 'submit', fields: { name: 'Ada', ok: true } })
	})

	it('accepts a valid click payload, with and without data', () => {
		const click = parseBridgePayload({ [BRIDGE_MARKER]: true, kind: 'click', clicked: 'Option A', value: 'a', data: { extra: '1' } })
		expect(click).toEqual({ kind: 'click', clicked: 'Option A', value: 'a', data: { extra: '1' } })

		const bare = parseBridgePayload({ [BRIDGE_MARKER]: true, kind: 'click', clicked: 'Go' })
		expect(bare).toEqual({ kind: 'click', clicked: 'Go', value: undefined, data: undefined })
	})

	it('rejects anything missing the marker', () => {
		expect(parseBridgePayload({ kind: 'submit', fields: {} })).toBeNull()
		expect(parseBridgePayload('hello')).toBeNull()
		expect(parseBridgePayload(null)).toBeNull()
		expect(parseBridgePayload(42)).toBeNull()
	})

	it('rejects a malformed submit/click payload', () => {
		expect(parseBridgePayload({ [BRIDGE_MARKER]: true, kind: 'submit', fields: 'not an object' })).toBeNull()
		expect(parseBridgePayload({ [BRIDGE_MARKER]: true, kind: 'click' })).toBeNull()
		expect(parseBridgePayload({ [BRIDGE_MARKER]: true, kind: 'click', clicked: 'x', data: { n: 1 } })).toBeNull()
		expect(parseBridgePayload({ [BRIDGE_MARKER]: true, kind: 'other' })).toBeNull()
	})

	it('rejects a payload over the size cap', () => {
		const huge = { [BRIDGE_MARKER]: true, kind: 'submit', fields: { blob: 'x'.repeat(BRIDGE_MAX_BYTES) } }
		expect(parseBridgePayload(huge)).toBeNull()
	})
})

describe('bridgePayloadToJson', () => {
	it('pretty-prints a submit payload as its fields', () => {
		const json = bridgePayloadToJson({ kind: 'submit', fields: { name: 'Ada' } })
		expect(JSON.parse(json)).toEqual({ name: 'Ada' })
	})

	it('spreads a click payload as { clicked, value, ...data }', () => {
		const json = bridgePayloadToJson({ kind: 'click', clicked: 'Option A', value: 'a', data: { tag: 'x' } })
		expect(JSON.parse(json)).toEqual({ clicked: 'Option A', value: 'a', tag: 'x' })
	})
})
