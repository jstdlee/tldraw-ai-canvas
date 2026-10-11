/**
 * WP21 Part E ("HTTP request: import from text"): parse a captured request pasted by the user
 * — a cURL command, a raw HTTP request, or a browser "Copy as fetch" snippet — into the same
 * shape the HTTP card's fields use. Pure (no tldraw import), so it's testable in Node; the
 * client-side "Import request…" dialog (`WebNodes.tsx`) and the `request` input port both call
 * this to fill/override the card's fields.
 */

export interface ImportedHttpAuth {
	kind: 'bearer' | 'basic'
	/** The raw secret value (the bearer token, or "user:password" for basic). Caller is
	 * responsible for moving this to the secret store — never kept as plain text on the card. */
	value: string
}

export interface ImportedHttpRequest {
	method: string
	url: string
	/** One "key=value" per line, like the HTTP card's own Query field. */
	query: string
	headers: Record<string, string>
	body?: string
	auth?: ImportedHttpAuth
}

/** `https://host/path?a=1&b=2` -> `{ url: "https://host/path", query: "a=1\nb=2" }`. */
function splitQuery(rawUrl: string): { url: string; query: string } {
	const idx = rawUrl.indexOf('?')
	if (idx === -1) return { url: rawUrl, query: '' }
	const base = rawUrl.slice(0, idx)
	const params = new URLSearchParams(rawUrl.slice(idx + 1))
	return { url: base, query: [...params.entries()].map(([k, v]) => `${k}=${v}`).join('\n') }
}

/**
 * Pulls `Authorization: Bearer <token>` / `Basic <base64>` out of the headers into an auth
 * value (mutating `headers`, since the header is rebuilt from `auth`/`authRef` at run time —
 * keeping it too would send it twice, and would leak the secret onto the card as plain text).
 */
function extractAuth(headers: Record<string, string>): ImportedHttpAuth | undefined {
	const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')
	if (!entry) return undefined
	const [key, value] = entry
	const bearer = /^Bearer\s+(.+)$/i.exec(value.trim())
	if (bearer) {
		delete headers[key]
		return { kind: 'bearer', value: bearer[1].trim() }
	}
	const basic = /^Basic\s+(.+)$/i.exec(value.trim())
	if (basic) {
		try {
			const decoded = typeof atob === 'function' ? atob(basic[1].trim()) : Buffer.from(basic[1].trim(), 'base64').toString('utf8')
			delete headers[key]
			return { kind: 'basic', value: decoded }
		} catch {
			return undefined
		}
	}
	return undefined
}

/** A shell-like tokenizer for the cURL command: splits on whitespace, respecting single and
 * double quotes (with `\"` escapes inside double quotes), and joins `\`-newline continuations. */
function tokenizeCurl(command: string): string[] {
	const joined = command.replace(/\\\r?\n/g, ' ')
	const tokens: string[] = []
	let i = 0
	while (i < joined.length) {
		while (i < joined.length && /\s/.test(joined[i])) i++
		if (i >= joined.length) break
		let token = ''
		while (i < joined.length && !/\s/.test(joined[i])) {
			const c = joined[i]
			if (c === "'" || c === '"') {
				const quote = c
				i++
				while (i < joined.length && joined[i] !== quote) {
					if (quote === '"' && joined[i] === '\\' && i + 1 < joined.length) {
						token += joined[i + 1]
						i += 2
						continue
					}
					token += joined[i]
					i++
				}
				i++ // closing quote
			} else {
				token += c
				i++
			}
		}
		tokens.push(token)
	}
	return tokens
}

/** `--flag=value` -> two tokens (`--flag`, `value`), so the parser below only needs to handle
 * the space-separated form. */
function splitLongFlags(tokens: string[]): string[] {
	const out: string[] = []
	for (const token of tokens) {
		const m = /^(--[A-Za-z-]+)=(.*)$/.exec(token)
		if (m) {
			out.push(m[1], m[2])
		} else {
			out.push(token)
		}
	}
	return out
}

export function parseCurl(command: string): ImportedHttpRequest {
	const tokens = splitLongFlags(tokenizeCurl(command))
	let i = 0
	if (tokens[i] === '$') i++
	if ((tokens[i] ?? '').replace(/^.*\//, '').toLowerCase() !== 'curl') {
		throw new Error('Not a curl command — expected it to start with "curl".')
	}
	i++
	let method = ''
	let url = ''
	const headers: Record<string, string> = {}
	let body: string | undefined
	let hasData = false
	let basicAuth: string | undefined

	for (; i < tokens.length; i++) {
		const t = tokens[i]
		switch (t) {
			case '-X':
			case '--request':
				method = (tokens[++i] ?? '').toUpperCase()
				break
			case '-H':
			case '--header': {
				const line = tokens[++i] ?? ''
				const m = /^([^:]+):\s*(.*)$/.exec(line)
				if (m) headers[m[1].trim()] = m[2].trim()
				break
			}
			case '-d':
			case '--data':
			case '--data-raw':
			case '--data-binary':
			case '--data-ascii':
				body = tokens[++i] ?? ''
				hasData = true
				break
			case '-b':
			case '--cookie':
				headers['Cookie'] = tokens[++i] ?? ''
				break
			case '-u':
			case '--user':
				basicAuth = tokens[++i] ?? ''
				break
			case '--url':
				url = tokens[++i] ?? url
				break
			// Flags that don't change the request shape — safe to ignore.
			case '--compressed':
			case '-s':
			case '--silent':
			case '-L':
			case '--location':
			case '-k':
			case '--insecure':
			case '-i':
			case '--include':
			case '-v':
			case '--verbose':
				break
			default:
				if (!t.startsWith('-') && !url) url = t
				break
		}
	}
	if (!url) throw new Error('No URL found in the curl command.')
	if (!method) method = hasData ? 'POST' : 'GET'
	const { url: baseUrl, query } = splitQuery(url)
	let auth = extractAuth(headers)
	if (!auth && basicAuth) auth = { kind: 'basic', value: basicAuth }
	return { method, url: baseUrl, query, headers, body, auth }
}

export function parseRawHttp(text: string): ImportedHttpRequest {
	const lines = text.replace(/\r\n/g, '\n').split('\n')
	const requestLine = (lines.shift() ?? '').trim()
	const m = /^([A-Za-z]+)\s+(\S+)\s+HTTP\/\d(?:\.\d)?$/i.exec(requestLine)
	if (!m) throw new Error('Not a raw HTTP request — expected a request line like "POST /path HTTP/1.1".')
	const method = m[1].toUpperCase()
	const path = m[2]
	const headers: Record<string, string> = {}
	let i = 0
	for (; i < lines.length; i++) {
		const line = lines[i]
		if (line.trim() === '') {
			i++
			break
		}
		const hm = /^([^:]+):\s*(.*)$/.exec(line)
		if (hm) headers[hm[1].trim()] = hm[2].trim()
	}
	const body = lines.slice(i).join('\n')
	const hostEntry = Object.entries(headers).find(([k]) => k.toLowerCase() === 'host')
	if (!hostEntry) throw new Error('No Host header found — cannot build a URL.')
	delete headers[hostEntry[0]]
	const fullUrl = /^https?:\/\//i.test(path) ? path : `https://${hostEntry[1]}${path}`
	const { url, query } = splitQuery(fullUrl)
	const auth = extractAuth(headers)
	return { method, url, query, headers, body: body.trim() ? body : undefined, auth }
}

/** Unescape a single- or double-quoted JS string literal's contents (good enough for a
 * browser-generated "Copy as fetch" snippet; not a full JS string-literal parser). */
function unquoteJsString(raw: string): string {
	const inner = raw.slice(1, -1)
	return inner.replace(/\\(.)/g, '$1')
}

export function parseFetchCall(text: string): ImportedHttpRequest {
	const m = /fetch\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*(?:,\s*(\{[\s\S]*\})\s*)?\)/.exec(text)
	if (!m) throw new Error('Not a fetch(...) call.')
	const url = unquoteJsString(m[1])
	let options: Record<string, unknown> = {}
	if (m[2]) {
		try {
			options = JSON.parse(m[2]) as Record<string, unknown>
		} catch {
			throw new Error('Could not parse the fetch(...) options object.')
		}
	}
	const method = (typeof options.method === 'string' ? options.method : 'GET').toUpperCase()
	const headers: Record<string, string> = {}
	if (options.headers && typeof options.headers === 'object') {
		for (const [k, v] of Object.entries(options.headers as Record<string, unknown>)) headers[k] = String(v)
	}
	const body = typeof options.body === 'string' ? options.body : undefined
	const { url: baseUrl, query } = splitQuery(url)
	const auth = extractAuth(headers)
	return { method, url: baseUrl, query, headers, body, auth }
}

/** Detects the format (cURL / raw HTTP / fetch) and parses it. */
export function parseHttpImport(text: string): ImportedHttpRequest {
	const trimmed = text.trim()
	if (!trimmed) throw new Error('Paste a captured request first.')
	if (/^fetch\s*\(/.test(trimmed)) return parseFetchCall(trimmed)
	if (/^\$?\s*(?:[\w./-]*\/)?curl\b/i.test(trimmed)) return parseCurl(trimmed)
	if (/^[A-Za-z]+\s+\S+\s+HTTP\/\d(?:\.\d)?/.test(trimmed.split(/\r?\n/)[0])) return parseRawHttp(trimmed)
	throw new Error('Could not recognize the request format — paste a curl command, a raw HTTP request, or a fetch(...) call.')
}

/** Headers as one "Name: value" per line, for the HTTP card's Headers field. */
export function headersToLines(headers: Record<string, string>): string {
	return Object.entries(headers)
		.map(([k, v]) => `${k}: ${v}`)
		.join('\n')
}
