/** Build the URL, headers and body for the HTTP node (Postman-style fields). */

export interface HttpBuildInput {
	method?: string
	url: string
	query?: string
	headers?: string
	body?: string
	auth?: string
	authValue?: string
}

export interface BuiltHttpRequest {
	method: string
	url: string
	headers: Record<string, string>
	body?: string
}

export function parseHeaderLines(text: string): Record<string, string> {
	const trimmed = text.trim()
	if (!trimmed) return {}
	if (trimmed.startsWith('{')) {
		const parsed = JSON.parse(trimmed) as Record<string, unknown>
		return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]))
	}
	return Object.fromEntries(
		trimmed
			.split(/\r?\n/)
			.map((line) => line.match(/^\s*([^:]+):\s*(.*)$/))
			.filter((match): match is RegExpMatchArray => !!match)
			.map((match) => [match[1].trim(), match[2].trim()])
	)
}

/** `q=cat` lines, or a JSON object, appended to the URL. */
export function applyQuery(url: string, query: string): string {
	const trimmed = query.trim()
	if (!trimmed) return url
	const params = new URLSearchParams()
	if (trimmed.startsWith('{')) {
		const parsed = JSON.parse(trimmed) as Record<string, unknown>
		for (const [key, value] of Object.entries(parsed)) params.append(key, String(value))
	} else {
		for (const line of trimmed.split(/\r?\n/)) {
			const raw = line.trim()
			if (!raw || raw.startsWith('#')) continue
			const eq = raw.indexOf('=')
			if (eq === -1) params.append(raw, '')
			else params.append(raw.slice(0, eq).trim(), raw.slice(eq + 1).trim())
		}
	}
	const extra = params.toString()
	if (!extra) return url
	return url + (url.includes('?') ? '&' : '?') + extra
}

export function buildHttpRequest(input: HttpBuildInput): BuiltHttpRequest {
	const method = (input.method || 'GET').toUpperCase()
	const headers = parseHeaderLines(input.headers ?? '')
	const auth = (input.auth ?? '').toLowerCase()
	const secret = (input.authValue ?? '').trim()
	if (auth === 'bearer' && secret) headers.Authorization = `Bearer ${secret}`
	if (auth === 'basic' && secret) {
		const token = typeof btoa === 'function' ? btoa(secret) : Buffer.from(secret).toString('base64')
		headers.Authorization = `Basic ${token}`
	}
	const sendsBody = !['GET', 'HEAD'].includes(method)
	return {
		method,
		url: applyQuery(input.url.trim(), input.query ?? ''),
		headers,
		body: sendsBody ? input.body : undefined,
	}
}
