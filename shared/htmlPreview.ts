/**
 * WP29: pure helpers for the HTML preview / HTML form cards. Splits LLM-style fenced
 * code blocks (```html/```css/```js) out of plain text, assembles one HTML document from
 * whatever pieces are given (a full document, a fragment, or separate html/css/js), and
 * validates the `postMessage` payload the sandboxed iframe's bridge script sends back.
 * No tldraw import — testable in Node.
 */

export interface HtmlSources {
	/** LLM-style text: may contain ```html/```css/```js fences, a full document, or a fragment. */
	text?: string
	/** Explicit overrides; each wins over anything found in `text`. */
	html?: string
	css?: string
	js?: string
}

export interface SplitBlocks {
	html: string
	css: string
	js: string
	/** Everything outside a fenced block, trimmed — used as a fragment when no ```html fence exists. */
	plain: string
	/** Whether any fenced block was found at all. */
	hasFences: boolean
}

const FENCE_RE = /```(html|css|js|javascript)\s*\n([\s\S]*?)```/gi

/** Pulls ```html/```css/```js(```javascript) fenced blocks out of LLM-style text. Blocks of the
 * same language are joined with a blank line; everything outside any fence is `plain`. */
export function splitFencedBlocks(text: string): SplitBlocks {
	let html = ''
	let css = ''
	let js = ''
	let hasFences = false
	const append = (current: string, addition: string) => (current ? current + '\n\n' + addition : addition)

	const re = new RegExp(FENCE_RE)
	let match: RegExpExecArray | null
	while ((match = re.exec(text))) {
		hasFences = true
		const lang = match[1].toLowerCase()
		const body = match[2].trim()
		if (lang === 'html') html = append(html, body)
		else if (lang === 'css') css = append(css, body)
		else js = append(js, body)
	}
	const plain = hasFences ? text.replace(FENCE_RE, '').trim() : text.trim()
	return { html, css, js, plain, hasFences }
}

/** Whether `html` already looks like a full document (has a `<html` or `<!doctype` tag). */
export function looksLikeFullDocument(html: string): boolean {
	return /<\s*(!doctype|html)\b/i.test(html)
}

/** The CSP meta tag content: blocks all network by default; "Allow network" relaxes it to
 * images/styles/scripts/connections over https/http, but it is never `allow-same-origin` on
 * the iframe itself — that stays the caller's job.
 *
 * GAPS-15: a CSP source list may not mix the `'none'` keyword with any other source expression
 * (every browser's console warns "'img-src' contains the keyword 'none' alongside with other
 * source expressions", and some treat the whole directive as invalid). `img-src` always lists
 * `data:`/`blob:` on their own — those already deny network images when network is off, so
 * `'none'` would be both invalid and redundant here. */
export function previewCsp(allowNetwork: boolean): string {
	const net = allowNetwork ? ' https: http:' : ''
	return [
		"default-src 'none'",
		`img-src data: blob:${net}`,
		"style-src 'unsafe-inline'",
		"script-src 'unsafe-inline'",
		...(allowNetwork ? [`connect-src${net}`, `font-src data:${net}`, `media-src data: blob:${net}`] : []),
	].join('; ')
}

function injectBeforeTag(doc: string, tag: string, content: string): string {
	if (!content) return doc
	const re = new RegExp(`</${tag}>`, 'i')
	if (re.test(doc)) return doc.replace(re, content + `</${tag}>`)
	// No closing tag to anchor on (a document fragment missing <head>/<body>) — prepend.
	return content + doc
}

export interface AssembleOptions {
	allowNetwork?: boolean
	/** Extra script injected right before `</body>` (the form card's bridge script). */
	injectScript?: string
}

/** Assembles one HTML document from `sources`: explicit `html`/`css`/`js` win over anything
 * split out of `text`; a full document found either way is used as the base (css/js/CSP/bridge
 * injected into it), a fragment is wrapped in a minimal document. Always includes a CSP meta
 * tag blocking network by default. */
export function assembleHtmlDocument(sources: HtmlSources, options: AssembleOptions = {}): string {
	const fromText = sources.text ? splitFencedBlocks(sources.text) : null
	const explicitHtml = sources.html?.trim()
	const html = explicitHtml || fromText?.html || fromText?.plain || ''
	const css = sources.css?.trim() || fromText?.css || ''
	const js = sources.js?.trim() || fromText?.js || ''

	const csp = previewCsp(!!options.allowNetwork)
	const cspTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
	const styleTag = css ? `<style>${css}</style>` : ''
	const scriptTag = js ? `<script>${js}</script>` : ''
	const bridgeTag = options.injectScript ? `<script>${options.injectScript}</script>` : ''

	if (looksLikeFullDocument(html)) {
		let doc = html
		// Don't add a second CSP meta if the document already defines one.
		if (!/http-equiv=["']Content-Security-Policy["']/i.test(doc)) {
			doc = injectBeforeTag(doc, 'head', cspTag)
		}
		doc = injectBeforeTag(doc, 'head', styleTag)
		doc = injectBeforeTag(doc, 'body', scriptTag + bridgeTag)
		return doc
	}

	return (
		'<!DOCTYPE html><html><head><meta charset="utf-8">' +
		cspTag +
		styleTag +
		'</head><body>' +
		html +
		scriptTag +
		bridgeTag +
		'</body></html>'
	)
}

// ---------------------------------------------------------------------------
// HTML form bridge: injected into the iframe, reports user interaction home via postMessage.
// ---------------------------------------------------------------------------

/** Marker on every bridge message, so the handler can tell it apart from any other message the
 * page (or an extension) might send to the window. */
export const BRIDGE_MARKER = '__htmlFormBridge'

/** Cap on a bridge message's JSON size (guide: 1 MB) — a runaway page can't wedge the app. */
export const BRIDGE_MAX_BYTES = 1_000_000

export interface FormSubmitPayload {
	kind: 'submit'
	fields: Record<string, unknown>
}

export interface FormClickPayload {
	kind: 'click'
	clicked: string
	value?: string
	data?: Record<string, string>
}

export type BridgePayload = FormSubmitPayload | FormClickPayload

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (!isPlainObject(value)) return false
	return Object.values(value).every((v) => typeof v === 'string')
}

/** Validates a raw `event.data` as a bridge payload: the marker must be present, the shape must
 * match one of the two kinds, and the serialized size must stay under the cap. Returns null for
 * anything else (including a well-formed but foreign message). */
export function parseBridgePayload(raw: unknown): BridgePayload | null {
	if (!isPlainObject(raw) || raw[BRIDGE_MARKER] !== true) return null
	let size: number
	try {
		size = JSON.stringify(raw).length
	} catch {
		return null
	}
	if (size > BRIDGE_MAX_BYTES) return null

	if (raw.kind === 'submit') {
		if (!isPlainObject(raw.fields)) return null
		return { kind: 'submit', fields: raw.fields }
	}
	if (raw.kind === 'click') {
		if (typeof raw.clicked !== 'string') return null
		const value = typeof raw.value === 'string' ? raw.value : undefined
		const data = raw.data === undefined ? undefined : isStringRecord(raw.data) ? raw.data : undefined
		if (raw.data !== undefined && data === undefined) return null
		return { kind: 'click', clicked: raw.clicked, value, data }
	}
	return null
}

/** The payload as the card's `json` output: a submit's fields as-is; a click as
 * `{ clicked, value, ...data }` (guide B). */
export function bridgePayloadToJson(payload: BridgePayload): string {
	if (payload.kind === 'submit') return JSON.stringify(payload.fields, null, 2)
	const obj: Record<string, unknown> = { clicked: payload.clicked }
	if (payload.value !== undefined) obj.value = payload.value
	if (payload.data) Object.assign(obj, payload.data)
	return JSON.stringify(obj, null, 2)
}

/**
 * A2 (GAPS-05): the form card's `value` output — a single, routable string pulled out of a
 * submission's `json`, so "form → Decision switch" needs no extra card in between. Reads the
 * already-built `json` text (not the raw `BridgePayload`) since that's what's persisted on the
 * node: a click's own `value` (its `data-value`), or a submit's one field when the form has
 * exactly one. Anything else (no `value` key, or more than one submitted field) has no single
 * obvious answer, so this returns '' rather than guessing.
 */
export function valueFromSubmissionJson(json: string | null | undefined): string {
	if (!json) return ''
	let obj: unknown
	try {
		obj = JSON.parse(json)
	} catch {
		return ''
	}
	if (!isPlainObject(obj)) return ''
	// A click payload's json always carries a `clicked` key — never treat that (or any
	// accompanying data-* attribute) as if it were a submitted field; its own `value` key
	// (the clicked element's data-value) is the only thing a click can contribute here.
	if ('clicked' in obj) return typeof obj.value === 'string' ? obj.value : ''
	const keys = Object.keys(obj)
	if (keys.length !== 1) return ''
	const only = obj[keys[0]]
	if (only == null) return ''
	return typeof only === 'string' ? only : JSON.stringify(only)
}

/**
 * The bridge script injected into the form card's document (never the preview-only card's).
 * Plain ES5-ish JS: it runs inside the sandboxed iframe, not through our bundler.
 *  - A `<form>` submit is turned into a FormData-like object: repeated names become arrays,
 *    checkboxes become booleans, `type=number`/`range` inputs become numbers, everything else
 *    stays a string.
 *  - A click on a `button`, `[data-value]`, or `a[data-value]` outside any form reports the
 *    element's text as `clicked`, its `data-value` (or `value`) as `value`, and its other
 *    `data-*` attributes alongside.
 */
export function buildFormBridgeScript(): string {
	return `(function(){
		function fieldsFromForm(form, submitter){
			var result = {};
			var els = form.querySelectorAll('[name]');
			for (var i = 0; i < els.length; i++) {
				var el = els[i];
				// GAPS-06: a named submit/button/reset control is never one of the form's own
				// *fields* — without this, every button sharing a name reports as an array of
				// every button's value, not just the one clicked.
				var tag = el.tagName;
				if (tag === 'BUTTON' || (tag === 'INPUT' && (el.type === 'submit' || el.type === 'button' || el.type === 'reset'))) continue;
				var name = el.getAttribute('name');
				if (!name || el.disabled) continue;
				var value;
				if (el.type === 'checkbox') {
					value = el.checked;
				} else if (el.type === 'radio') {
					if (!el.checked) continue;
					value = el.value;
				} else if (el.tagName === 'SELECT' && el.multiple) {
					value = [];
					for (var j = 0; j < el.options.length; j++) {
						if (el.options[j].selected) value.push(el.options[j].value);
					}
				} else if (el.type === 'number' || el.type === 'range') {
					value = el.value === '' ? null : Number(el.value);
				} else {
					value = el.value;
				}
				if (Object.prototype.hasOwnProperty.call(result, name)) {
					var existing = result[name];
					if (Array.isArray(existing)) existing.push(value);
					else result[name] = [existing, value];
				} else {
					result[name] = value;
				}
			}
			// GAPS-06: the submitter (the button/input[type=submit] actually clicked) reports its
			// own name/value last, as a plain field — so {"style":"formal"}, not every button's
			// value collected as an array under a shared name.
			if (submitter && submitter.name) {
				result[submitter.name] = submitter.value;
			}
			return result;
		}
		document.addEventListener('submit', function(e){
			var form = e.target;
			if (!form || form.tagName !== 'FORM') return;
			e.preventDefault();
			window.parent.postMessage({ ${BRIDGE_MARKER}: true, kind: 'submit', fields: fieldsFromForm(form, e.submitter) }, '*');
		}, true);
		document.addEventListener('click', function(e){
			var el = e.target && e.target.closest ? e.target.closest('button, [data-value], a[data-value]') : null;
			if (!el || el.closest('form')) return;
			var data = {};
			if (el.dataset) {
				for (var key in el.dataset) {
					if (key !== 'value') data[key] = el.dataset[key];
				}
			}
			var value = el.dataset && el.dataset.value !== undefined ? el.dataset.value : (el.value !== undefined ? el.value : undefined);
			window.parent.postMessage({ ${BRIDGE_MARKER}: true, kind: 'click', clicked: (el.textContent || '').trim(), value: value, data: data }, '*');
		}, true);
	})();`
}
