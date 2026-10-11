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

/**
 * WP19 Part 1: an old canvas may still carry a bearer token / basic password typed straight
 * into the node. True when that value should move to the server's secret store (and the
 * plain field cleared) the next time the card runs — pure so the decision is testable without
 * a network call; the node's `execute` does the actual `apiSaveSecret` + `updateNode`.
 */
export function needsAuthValueMigration(
	auth: string | undefined,
	authRef: string | undefined,
	authValue: string | undefined
): boolean {
	return !!auth && !authRef && !!authValue
}

/** The `Authorization` header for a bearer/basic auth scheme, or `{}` when there is nothing to send. */
export function authHeader(auth: string | undefined, secret: string | undefined): Record<string, string> {
	const kind = (auth ?? '').toLowerCase()
	const value = (secret ?? '').trim()
	if (!value) return {}
	if (kind === 'bearer') return { Authorization: `Bearer ${value}` }
	if (kind === 'basic') {
		const token = typeof btoa === 'function' ? btoa(value) : Buffer.from(value).toString('base64')
		return { Authorization: `Basic ${token}` }
	}
	return {}
}

export function buildHttpRequest(input: HttpBuildInput): BuiltHttpRequest {
	const method = (input.method || 'GET').toUpperCase()
	const headers = { ...parseHeaderLines(input.headers ?? ''), ...authHeader(input.auth, input.authValue) }
	const sendsBody = !['GET', 'HEAD'].includes(method)
	return {
		method,
		url: applyQuery(input.url.trim(), input.query ?? ''),
		headers,
		body: sendsBody ? input.body : undefined,
	}
}
