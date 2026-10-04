/**
 * Text tools that need no AI. Pure functions, used by the "Text tools" node.
 * `a` and `b` are the node's two parameter fields; `input2` is the second input port.
 */

export type TextToolOp =
	| 'upper'
	| 'lower'
	| 'title'
	| 'trim'
	| 'replace'
	| 'regex'
	| 'split'
	| 'join'
	| 'template'
	| 'json'
	| 'count'
	| 'sort'
	| 'unique'
	| 'strip_html'
	| 'slug'
	| 'url_encode'
	| 'url_decode'
	| 'base64_encode'
	| 'base64_decode'
	| 'append'

export const TEXT_TOOL_OPS: {
	id: TextToolOp
	label: string
	a?: string
	b?: string
}[] = [
	{ id: 'template', label: 'Template', a: 'e.g. Title: {{input}} — {{input2}}' },
	{ id: 'replace', label: 'Find & replace', a: 'find (or /regex/flags)', b: 'replace with ($1 works)' },
	{ id: 'regex', label: 'Extract with regex', a: 'pattern, e.g. https?://\\S+', b: 'flags (default gi)' },
	{ id: 'json', label: 'JSON value', a: 'path, e.g. data.items[0].name' },
	{ id: 'split', label: 'Split → pick item', a: 'separator (default new line)', b: 'item number (1 = first, -1 = last)' },
	{ id: 'join', label: 'Join lines', a: 'separator (default ", ")' },
	{ id: 'append', label: 'Append input 2', a: 'separator (default new line)' },
	{ id: 'count', label: 'Count words / chars / lines' },
	{ id: 'trim', label: 'Trim spaces & blank lines' },
	{ id: 'sort', label: 'Sort lines' },
	{ id: 'unique', label: 'Remove duplicate lines' },
	{ id: 'upper', label: 'UPPER CASE' },
	{ id: 'lower', label: 'lower case' },
	{ id: 'title', label: 'Title Case' },
	{ id: 'strip_html', label: 'Strip HTML tags' },
	{ id: 'slug', label: 'Slug (url-friendly)' },
	{ id: 'url_encode', label: 'URL encode' },
	{ id: 'url_decode', label: 'URL decode' },
	{ id: 'base64_encode', label: 'Base64 encode' },
	{ id: 'base64_decode', label: 'Base64 decode' },
]

function parseRegex(source: string, defaultFlags: string): RegExp {
	const literal = source.match(/^\/(.+)\/([a-z]*)$/s)
	return literal ? new RegExp(literal[1], literal[2]) : new RegExp(source, defaultFlags)
}

/** Read `a.b[0].c` from a JSON value. */
export function jsonPath(value: unknown, path: string): unknown {
	const parts = path
		.replace(/\[(\d+|-\d+)\]/g, '.$1')
		.split('.')
		.map((p) => p.trim())
		.filter(Boolean)
	let current: unknown = value
	for (const part of parts) {
		if (current == null) return undefined
		if (Array.isArray(current) && /^-?\d+$/.test(part)) {
			const i = Number(part)
			current = current[i < 0 ? current.length + i : i]
		} else {
			current = (current as Record<string, unknown>)[part]
		}
	}
	return current
}

function toBase64(text: string) {
	const bytes = new TextEncoder().encode(text)
	let binary = ''
	for (const b of bytes) binary += String.fromCharCode(b)
	return btoa(binary)
}

function fromBase64(text: string) {
	const binary = atob(text.trim())
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
	return new TextDecoder().decode(bytes)
}

export function runTextTool(op: TextToolOp, input: string, a = '', b = '', input2 = ''): string {
	const lines = () => input.split(/\r?\n/)
	switch (op) {
		case 'upper':
			return input.toUpperCase()
		case 'lower':
			return input.toLowerCase()
		case 'title':
			return input.toLowerCase().replace(/(^|[\s\-(["'])(\p{L})/gu, (_, p, c) => p + c.toUpperCase())
		case 'trim':
			return lines()
				.map((l) => l.trim())
				.filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== ''))
				.join('\n')
				.trim()
		case 'replace': {
			if (!a) return input
			const literal = a.match(/^\/(.+)\/([a-z]*)$/s)
			return literal ? input.replace(parseRegex(a, 'g'), b) : input.split(a).join(b)
		}
		case 'regex': {
			if (!a) return ''
			const flags = b || 'gi'
			const re = parseRegex(a, flags.includes('g') ? flags : flags + 'g')
			return [...input.matchAll(re)].map((m) => m[1] ?? m[0]).join('\n')
		}
		case 'split': {
			const sep = a === '' ? /\r?\n/ : a
			const items = input.split(sep).map((s) => s.trim())
			const n = Number(b || 1)
			if (!Number.isInteger(n) || n === 0) return items.join('\n')
			return items[n > 0 ? n - 1 : items.length + n] ?? ''
		}
		case 'join':
			return lines()
				.map((l) => l.trim())
				.filter(Boolean)
				.join(a === '' ? ', ' : a.replace(/\\n/g, '\n'))
		case 'append':
			return input2 ? `${input}${a === '' ? '\n' : a.replace(/\\n/g, '\n')}${input2}` : input
		case 'template':
			return (a || '{{input}}')
				.replace(/\{\{\s*input\s*\}\}/g, input)
				.replace(/\{\{\s*input2\s*\}\}/g, input2)
				.replace(/\{\{\s*date\s*\}\}/g, new Date().toISOString().slice(0, 10))
				.replace(/\{\{\s*time\s*\}\}/g, new Date().toTimeString().slice(0, 5))
		case 'json': {
			let data: unknown
			try {
				data = JSON.parse(input)
			} catch {
				throw new Error('Input is not valid JSON')
			}
			const value = a ? jsonPath(data, a) : data
			if (value === undefined) return ''
			return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
		}
		case 'count': {
			const words = input.trim() ? input.trim().split(/\s+/).length : 0
			const lineCount = input ? lines().length : 0
			return `${words} words, ${input.length} characters, ${lineCount} lines`
		}
		case 'sort':
			return lines()
				.sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))
				.join('\n')
		case 'unique':
			return [...new Set(lines())].join('\n')
		case 'strip_html':
			return input
				.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
				.replace(/<br\s*\/?>/gi, '\n')
				.replace(/<[^>]+>/g, '')
				.replace(/&nbsp;/g, ' ')
				.replace(/&amp;/g, '&')
				.replace(/&lt;/g, '<')
				.replace(/&gt;/g, '>')
				.trim()
		case 'slug':
			return input
				.normalize('NFKD')
				.replace(/[̀-ͯ]/g, '')
				.toLowerCase()
				.replace(/[^\p{L}\p{N}]+/gu, '-')
				.replace(/^-+|-+$/g, '')
		case 'url_encode':
			return encodeURIComponent(input)
		case 'url_decode':
			return decodeURIComponent(input)
		case 'base64_encode':
			return toBase64(input)
		case 'base64_decode':
			return fromBase64(input)
	}
}
