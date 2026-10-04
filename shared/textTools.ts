/**
 * Text tools that need no AI. Pure functions, used by the "Text tools" node.
 * `a` and `b` are the node's two parameter fields; `input2` is the second input port.
 */

export type TextToolOp = string

export interface TextToolInfo {
	id: TextToolOp
	label: string
	group: string
	a?: string
	b?: string
}

/** Every tool, grouped for the node's dropdown. */
export const TEXT_TOOL_OPS: TextToolInfo[] = [
	// Build
	{ id: 'template', group: 'Build', label: 'Template', a: 'e.g. Title: {{input}} — {{input2}} ({{date}})' },
	{ id: 'append', group: 'Build', label: 'Append input 2', a: 'separator (default new line)' },
	{ id: 'prefix_suffix', group: 'Build', label: 'Add prefix / suffix to each line', a: 'prefix', b: 'suffix' },
	{ id: 'number_lines', group: 'Build', label: 'Number the lines', a: 'format, e.g. "{n}. " ' },
	{ id: 'lorem', group: 'Build', label: 'Lorem ipsum', a: 'paragraphs (3)' },
	// Find & extract
	{ id: 'replace', group: 'Find & extract', label: 'Find & replace', a: 'find (or /regex/flags)', b: 'replace with ($1 works)' },
	{ id: 'regex', group: 'Find & extract', label: 'Extract with regex', a: 'pattern, e.g. https?://\\S+', b: 'flags (default gi)' },
	{ id: 'extract_emails', group: 'Find & extract', label: 'Extract e-mail addresses' },
	{ id: 'extract_urls', group: 'Find & extract', label: 'Extract URLs' },
	{ id: 'extract_numbers', group: 'Find & extract', label: 'Extract numbers' },
	{ id: 'extract_hashtags', group: 'Find & extract', label: 'Extract #hashtags and @mentions' },
	{ id: 'extract_ips', group: 'Find & extract', label: 'Extract IP addresses' },
	{ id: 'keep_lines', group: 'Find & extract', label: 'Keep lines containing', a: 'text (or /regex/)' },
	{ id: 'remove_lines', group: 'Find & extract', label: 'Remove lines containing', a: 'text (or /regex/)' },
	{ id: 'json', group: 'Find & extract', label: 'JSON value', a: 'path, e.g. data.items[0].name' },
	{ id: 'split', group: 'Find & extract', label: 'Split → pick item', a: 'separator (default new line)', b: 'item number (1 = first, -1 = last)' },
	// Clean up
	{ id: 'trim', group: 'Clean up', label: 'Trim spaces & blank lines' },
	{ id: 'remove_line_breaks', group: 'Clean up', label: 'Remove line breaks', a: 'join with (default space)' },
	{ id: 'wrap', group: 'Clean up', label: 'Wrap lines at width', a: 'width (80)' },
	{ id: 'remove_extra_spaces', group: 'Clean up', label: 'Remove extra spaces' },
	{ id: 'remove_empty_lines', group: 'Clean up', label: 'Remove empty lines' },
	{ id: 'remove_punctuation', group: 'Clean up', label: 'Remove punctuation' },
	{ id: 'remove_accents', group: 'Clean up', label: 'Remove accents (é → e)' },
	{ id: 'strip_html', group: 'Clean up', label: 'Strip HTML tags' },
	{ id: 'unique', group: 'Clean up', label: 'Remove duplicate lines' },
	// Order
	{ id: 'sort', group: 'Order', label: 'Sort lines A→Z' },
	{ id: 'sort_desc', group: 'Order', label: 'Sort lines Z→A' },
	{ id: 'sort_length', group: 'Order', label: 'Sort lines by length' },
	{ id: 'reverse_lines', group: 'Order', label: 'Reverse line order' },
	{ id: 'reverse_text', group: 'Order', label: 'Reverse text' },
	{ id: 'join', group: 'Order', label: 'Join lines', a: 'separator (default ", ")' },
	// Case
	{ id: 'upper', group: 'Case', label: 'UPPER CASE' },
	{ id: 'lower', group: 'Case', label: 'lower case' },
	{ id: 'title', group: 'Case', label: 'Title Case' },
	{ id: 'sentence', group: 'Case', label: 'Sentence case' },
	{ id: 'toggle', group: 'Case', label: 'tOGGLE cASE' },
	{ id: 'camel', group: 'Case', label: 'camelCase' },
	{ id: 'pascal', group: 'Case', label: 'PascalCase' },
	{ id: 'snake', group: 'Case', label: 'snake_case' },
	{ id: 'kebab', group: 'Case', label: 'kebab-case' },
	{ id: 'slug', group: 'Case', label: 'Slug (url-friendly)' },
	// Count & compare
	{ id: 'count', group: 'Count & compare', label: 'Count words / chars / lines / sentences' },
	{ id: 'word_frequency', group: 'Count & compare', label: 'Word frequency', a: 'top N (20)' },
	{ id: 'diff', group: 'Count & compare', label: 'Diff input vs input 2 (lines)' },
	// Encode
	{ id: 'url_encode', group: 'Encode', label: 'URL encode' },
	{ id: 'url_decode', group: 'Encode', label: 'URL decode' },
	{ id: 'base64_encode', group: 'Encode', label: 'Base64 encode' },
	{ id: 'base64_decode', group: 'Encode', label: 'Base64 decode' },
	{ id: 'html_encode', group: 'Encode', label: 'HTML escape' },
	{ id: 'html_decode', group: 'Encode', label: 'HTML unescape' },
	{ id: 'to_binary', group: 'Encode', label: 'Text → binary' },
	{ id: 'from_binary', group: 'Encode', label: 'Binary → text' },
	{ id: 'to_hex', group: 'Encode', label: 'Text → hex' },
	{ id: 'from_hex', group: 'Encode', label: 'Hex → text' },
	{ id: 'rot13', group: 'Encode', label: 'ROT13' },
	{ id: 'sha256', group: 'Encode', label: 'SHA-256 hash' },
	// Data
	{ id: 'json_format', group: 'Data', label: 'JSON pretty print' },
	{ id: 'json_minify', group: 'Data', label: 'JSON minify' },
	{ id: 'csv_to_json', group: 'Data', label: 'CSV → JSON', a: 'delimiter (default ,)' },
	{ id: 'json_to_csv', group: 'Data', label: 'JSON array → CSV' },
	{ id: 'csv_to_markdown', group: 'Data', label: 'CSV → Markdown table', a: 'delimiter (default ,)' },
	{ id: 'lines_to_json', group: 'Data', label: 'Lines → JSON array' },
	{ id: 'json_to_lines', group: 'Data', label: 'JSON array → lines' },
	// URL
	{ id: 'url_parse', group: 'URL', label: 'Parse URL into parts' },
	{ id: 'url_query', group: 'URL', label: 'URL query → JSON' },
	{ id: 'url_domain', group: 'URL', label: 'URL → domain' },
	{ id: 'url_clean', group: 'URL', label: 'Remove tracking parameters (utm_, fbclid…)' },
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
			const wordCount = input.trim() ? input.trim().split(/\s+/).length : 0
			const lineCount = input ? lines().length : 0
			const sentences = (input.match(/[^.!?\n]+[.!?]+/g) ?? []).length
			const paragraphs = input.split(/\r?\n\s*\r?\n/).filter((p) => p.trim()).length
			const noSpaces = input.replace(/\s/g, '').length
			const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
			return `${n(wordCount, 'word')}, ${n(input.length, 'character')} (${noSpaces} without spaces), ${n(lineCount, 'line')}, ${n(sentences, 'sentence')}, ${n(paragraphs, 'paragraph')}`
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
		default:
			return runMoreTools(op, input, a, b, input2)
	}
}

const words = (text: string) => text.match(/[\p{L}\p{N}']+/gu) ?? []

function lineFilter(pattern: string): (line: string) => boolean {
	const literal = pattern.match(/^\/(.+)\/([a-z]*)$/s)
	if (literal) {
		const re = new RegExp(literal[1], literal[2])
		return (l) => re.test(l)
	}
	const needle = pattern.toLowerCase()
	return (l) => l.toLowerCase().includes(needle)
}

function wrapText(text: string, width: number) {
	return text
		.split(/\r?\n/)
		.map((line) => {
			const out: string[] = []
			let current = ''
			for (const word of line.split(/\s+/).filter(Boolean)) {
				if (current && (current + ' ' + word).length > width) {
					out.push(current)
					current = word
				} else current = current ? `${current} ${word}` : word
			}
			out.push(current)
			return out.join('\n')
		})
		.join('\n')
}

/** Minimal CSV parser: quotes, escaped quotes, new lines inside quotes. */
export function parseCsv(text: string, delimiter = ','): string[][] {
	const rows: string[][] = []
	let row: string[] = []
	let field = ''
	let quoted = false
	for (let i = 0; i < text.length; i++) {
		const c = text[i]
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"'
				i++
			} else if (c === '"') quoted = false
			else field += c
		} else if (c === '"') quoted = true
		else if (c === delimiter) {
			row.push(field)
			field = ''
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++
			row.push(field)
			rows.push(row)
			row = []
			field = ''
		} else field += c
	}
	if (field || row.length) {
		row.push(field)
		rows.push(row)
	}
	return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

function csvCell(v: unknown) {
	const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function caseWords(text: string) {
	return text
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
		.map((w) => w.toLowerCase())
}

function lineDiff(a: string, b: string): string {
	const x = a.split(/\r?\n/)
	const y = b.split(/\r?\n/)
	// Longest common subsequence table (fine for a few thousand lines).
	const m = x.length
	const n = y.length
	if (m * n > 4_000_000) throw new Error('Texts are too long to diff')
	const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
	for (let i = m - 1; i >= 0; i--)
		for (let j = n - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
	const out: string[] = []
	let i = 0
	let j = 0
	while (i < m && j < n) {
		if (x[i] === y[j]) {
			out.push(`  ${x[i]}`)
			i++
			j++
		} else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(`- ${x[i++]}`)
		else out.push(`+ ${y[j++]}`)
	}
	while (i < m) out.push(`- ${x[i++]}`)
	while (j < n) out.push(`+ ${y[j++]}`)
	return out.join('\n')
}

/** Small synchronous SHA-256 (so the tool can stay synchronous). */
export function sha256Hex(text: string): string {
	const bytes = new TextEncoder().encode(text)
	const K = new Uint32Array([
		0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
		0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
		0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
		0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
		0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
		0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
		0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
	])
	const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
	const len = bytes.length
	const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6)
	padded.set(bytes)
	padded[len] = 0x80
	const view = new DataView(padded.buffer)
	view.setUint32(padded.length - 4, (len * 8) >>> 0)
	view.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32))
	const w = new Uint32Array(64)
	const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
	for (let off = 0; off < padded.length; off += 64) {
		for (let t = 0; t < 16; t++) w[t] = view.getUint32(off + t * 4)
		for (let t = 16; t < 64; t++) {
			const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)
			const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)
			w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0
		}
		let [a, b, c, d, e, f, g, h] = H
		for (let t = 0; t < 64; t++) {
			const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) >>> 0
			const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
			h = g
			g = f
			f = e
			e = (d + t1) >>> 0
			d = c
			c = b
			b = a
			a = (t1 + t2) >>> 0
		}
		H[0] += a
		H[1] += b
		H[2] += c
		H[3] += d
		H[4] += e
		H[5] += f
		H[6] += g
		H[7] += h
	}
	return [...H].map((x) => x.toString(16).padStart(8, '0')).join('')
}

const LOREM =
	'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.'

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi|ref_src|si)$/i

function runMoreTools(op: string, input: string, a: string, b: string, input2: string): string {
	const lines = () => input.split(/\r?\n/)
	switch (op) {
		case 'prefix_suffix':
			return lines().map((l) => `${a}${l}${b}`).join('\n')
		case 'number_lines': {
			const fmt = a || '{n}. '
			return lines().map((l, i) => fmt.replace('{n}', String(i + 1)) + l).join('\n')
		}
		case 'lorem':
			return Array.from({ length: Math.min(50, Math.max(1, Number(a) || 3)) }, () => LOREM).join('\n\n')
		case 'extract_emails':
			return [...new Set(input.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])].join('\n')
		case 'extract_urls':
			return [...new Set(input.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [])].join('\n')
		case 'extract_numbers':
			return (input.match(/-?\d+(?:[.,]\d+)*(?:\.\d+)?/g) ?? []).join('\n')
		case 'extract_hashtags':
			return [...new Set(input.match(/(^|\s)([#@][\p{L}\p{N}_]+)/gu)?.map((m) => m.trim()) ?? [])].join('\n')
		case 'extract_ips':
			return [...new Set(input.match(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g) ?? [])].join('\n')
		case 'keep_lines':
			return lines().filter(lineFilter(a)).join('\n')
		case 'remove_lines':
			return lines().filter((l) => !lineFilter(a)(l)).join('\n')
		case 'remove_line_breaks':
			return input.replace(/\s*\r?\n\s*/g, a === '' ? ' ' : a).trim()
		case 'wrap':
			return wrapText(input, Math.max(10, Number(a) || 80))
		case 'remove_extra_spaces':
			return lines().map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
		case 'remove_empty_lines':
			return lines().filter((l) => l.trim()).join('\n')
		case 'remove_punctuation':
			return input.replace(/[\p{P}\p{S}]+/gu, '')
		case 'remove_accents':
			return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
		case 'sort_desc':
			return lines().sort((x, y) => y.localeCompare(x, undefined, { numeric: true })).join('\n')
		case 'sort_length':
			return lines().sort((x, y) => x.length - y.length).join('\n')
		case 'reverse_lines':
			return lines().reverse().join('\n')
		case 'reverse_text':
			return [...input].reverse().join('')
		case 'sentence':
			return input.toLowerCase().replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (m) => m.toUpperCase())
		case 'toggle':
			return [...input].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('')
		case 'camel':
			return caseWords(input).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('')
		case 'pascal':
			return caseWords(input).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
		case 'snake':
			return caseWords(input).join('_')
		case 'kebab':
			return caseWords(input).join('-')
		case 'word_frequency': {
			const counts = new Map<string, number>()
			for (const w of words(input.toLowerCase())) counts.set(w, (counts.get(w) ?? 0) + 1)
			return [...counts]
				.sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
				.slice(0, Math.max(1, Number(a) || 20))
				.map(([w, n]) => `${w}\t${n}`)
				.join('\n')
		}
		case 'diff':
			return lineDiff(input, input2)
		case 'html_encode':
			return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
		case 'html_decode':
			return input
				.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
				.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
				.replace(/&quot;/g, '"')
				.replace(/&#39;|&apos;/g, "'")
				.replace(/&lt;/g, '<')
				.replace(/&gt;/g, '>')
				.replace(/&nbsp;/g, ' ')
				.replace(/&amp;/g, '&')
		case 'to_binary':
			return [...new TextEncoder().encode(input)].map((b) => b.toString(2).padStart(8, '0')).join(' ')
		case 'from_binary':
			return new TextDecoder().decode(Uint8Array.from((input.match(/[01]{8}/g) ?? []).map((b) => parseInt(b, 2))))
		case 'to_hex':
			return [...new TextEncoder().encode(input)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
		case 'from_hex':
			return new TextDecoder().decode(Uint8Array.from((input.replace(/[^0-9a-f]/gi, '').match(/../g) ?? []).map((h) => parseInt(h, 16))))
		case 'rot13':
			return input.replace(/[a-z]/gi, (c) => {
				const base = c <= 'Z' ? 65 : 97
				return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base)
			})
		case 'sha256':
			return sha256Hex(input)
		case 'json_format':
			return JSON.stringify(JSON.parse(input), null, 2)
		case 'json_minify':
			return JSON.stringify(JSON.parse(input))
		case 'csv_to_json': {
			const [head, ...rows] = parseCsv(input, a || ',')
			if (!head) return '[]'
			return JSON.stringify(rows.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? '']))), null, 2)
		}
		case 'json_to_csv': {
			const data = JSON.parse(input)
			if (!Array.isArray(data)) throw new Error('Input must be a JSON array')
			const keys = [...new Set(data.flatMap((row) => (row && typeof row === 'object' ? Object.keys(row) : ['value'])))]
			const body = data.map((row) =>
				keys.map((k) => csvCell(row && typeof row === 'object' ? (row as Record<string, unknown>)[k] : row)).join(',')
			)
			return [keys.map(csvCell).join(','), ...body].join('\n')
		}
		case 'csv_to_markdown': {
			const [head, ...rows] = parseCsv(input, a || ',')
			if (!head) return ''
			const esc = (v: string) => v.replace(/\|/g, '\\|').trim()
			return [
				`| ${head.map(esc).join(' | ')} |`,
				`| ${head.map(() => '---').join(' | ')} |`,
				...rows.map((r) => `| ${head.map((_, i) => esc(r[i] ?? '')).join(' | ')} |`),
			].join('\n')
		}
		case 'lines_to_json':
			return JSON.stringify(lines().map((l) => l.trim()).filter(Boolean), null, 2)
		case 'json_to_lines': {
			const data = JSON.parse(input)
			if (!Array.isArray(data)) throw new Error('Input must be a JSON array')
			return data.map((d) => (typeof d === 'string' ? d : JSON.stringify(d))).join('\n')
		}
		case 'url_parse': {
			const u = new URL(input.trim())
			return JSON.stringify(
				{
					protocol: u.protocol.replace(':', ''),
					host: u.hostname,
					port: u.port || null,
					path: u.pathname,
					query: Object.fromEntries(u.searchParams),
					hash: u.hash.replace('#', '') || null,
					origin: u.origin,
				},
				null,
				2
			)
		}
		case 'url_query':
			return JSON.stringify(Object.fromEntries(new URL(input.trim()).searchParams), null, 2)
		case 'url_domain':
			return lines()
				.map((l) => l.trim())
				.filter(Boolean)
				.map((l) => {
					try {
						return new URL(/^[a-z]+:\/\//i.test(l) ? l : `https://${l}`).hostname.replace(/^www\./, '')
					} catch {
						return ''
					}
				})
				.join('\n')
		case 'url_clean':
			return lines()
				.map((l) => {
					try {
						const u = new URL(l.trim())
						for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key)
						return u.toString()
					} catch {
						return l
					}
				})
				.join('\n')
		default:
			throw new Error(`Unknown text tool: ${op}`)
	}
}
