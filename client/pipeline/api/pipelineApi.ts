/**
 * Frontend API client for the local Node server (server/index.ts).
 * Model fields take a model key from the AI config; empty means the default.
 */


export interface LlmRequestSettings {
	system?: string
	temperature?: number | null
	maxTokens?: number | null
	/** Reasoning effort: 'none' | 'low' | 'medium' | 'high'. */
	thinking?: string
}

export interface GenerateTextParams extends LlmRequestSettings {
	/** Text, an image URL / data URL, or a web URL (the server reads the page). */
	input?: string
	/** Extra images, e.g. frames from a video. */
	images?: string[]
	prompt: string
	model?: string
}

export interface GenerateTextResult {
	text: string
}

/**
 * Call the /api/generate-text endpoint to generate text from a multimodal AI model.
 * Falls back to a local placeholder if the worker is not available.
 */
export async function apiGenerateText(params: GenerateTextParams): Promise<GenerateTextResult> {
	// Coerce input to string so the worker always receives a string
	const coercedParams = {
		...params,
		input: params.input != null ? String(params.input) : undefined,
	}
	try {
		const response = await fetch('/api/generate-text', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(coercedParams),
		})

		if (!response.ok) {
			const err = await response.json().catch(() => ({ error: response.statusText }))
			throw new Error((err as { error?: string }).error ?? 'Text generation failed')
		}

		return (await response.json()) as GenerateTextResult
	} catch (e) {
		throw e instanceof Error ? e : new Error(String(e))
	}
}


export type ChatContentPart = { type: 'text'; text: string } | { type: 'image'; image: string }

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system'
	content: string | ChatContentPart[]
}

/**
 * Stream a chat reply from /api/chat. `onText` gets the full text so far.
 * Resolves with the final text; rejects on an error.
 */
export async function apiChatStream(
	params: { model?: string; messages: ChatMessage[] } & LlmRequestSettings,
	onText: (text: string) => void,
	signal?: AbortSignal
): Promise<string> {
	const response = await fetch('/api/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(params),
		signal,
	})
	if (!response.ok || !response.body) {
		const err = await response.json().catch(() => ({ error: response.statusText }))
		throw new Error((err as { error?: string }).error ?? 'Chat failed')
	}
	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let text = ''
	while (true) {
		const { value, done } = await reader.read()
		if (done) break
		text += decoder.decode(value, { stream: true })
		onText(stripThinking(text))
	}
	const errorAt = text.lastIndexOf('\n\n[error] ')
	if (errorAt !== -1) throw new Error(text.slice(errorAt + 10))
	return stripThinking(text)
}

/** Hide <think>…</think> blocks that some local models write into the text. */
export function stripThinking(text: string) {
	const withoutClosed = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '')
	const open = withoutClosed.indexOf('<think>')
	return (open === -1 ? withoutClosed : withoutClosed.slice(0, open)).trimStart()
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	const data = await response.json().catch(() => ({ error: response.statusText }))
	if (!response.ok) throw new Error((data as { error?: string }).error ?? response.statusText)
	return data as T
}

export interface HttpResult {
	status: number
	ok: boolean
	contentType: string
	text: string
	imageUrl?: string
	bytes: number
}

/** HTTP node: the local server makes the request (no CORS limits). */
export function apiHttp(params: {
	method: string
	url: string
	headers?: Record<string, string>
	body?: string
	extractText?: boolean
}) {
	return postJson<HttpResult>('/api/http', params)
}

export interface DownloadResult {
	path: string
	fileName: string
	contentType: string
	bytes: number
	imageUrl?: string
	text?: string
}

/** Download node: save a URL into data/downloads on this machine. */
export function apiDownload(params: { url: string; fileName?: string }) {
	return postJson<DownloadResult>('/api/download', params)
}

/** Save node: write text or an image into data/exports on this machine. */
export function apiSave(params: { content: string; fileName?: string }) {
	return postJson<{ path: string; bytes: number }>('/api/save', params)
}

export interface JevResult {
	type: 'noul' | 'choice' | 'score'
	answer: string
	probabilities: Record<string, number>
	confidence: number | null
	source: string
}

/** JEV decision: System One API, or a chat model asked for probabilities. */
export function apiJev(params: {
	model?: string
	type: 'noul' | 'choice' | 'score'
	question: string
	context?: string
	options?: string[]
	levels?: string[]
}) {
	return postJson<JevResult>('/api/jev', params)
}

/** Network tools on the local server: ping, traceroute, dig, whois, ports, subnet… */
export function apiNetTool(params: { tool: string; target: string; option?: string }) {
	return postJson<{ output: string; ms: number }>('/api/nettool', params)
}
