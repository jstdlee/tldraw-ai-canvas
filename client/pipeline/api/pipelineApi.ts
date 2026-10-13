/**
 * Frontend API client for the local Node server (server/index.ts).
 * Model fields take a model key from the AI config; empty means the default.
 */

import { LlmUsage, takeUsageTrailer } from '../../../shared/llmUsage'
import { ModelCapability } from '../../../shared/aiConfig'


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
	/** Overrides the default capability ('vision' when an image is present, else 'chat'). */
	capability?: ModelCapability
}

export interface GenerateTextResult {
	text: string
	usage?: LlmUsage
}

/**
 * Call the /api/generate-text endpoint to generate text from a multimodal AI model.
 * Falls back to a local placeholder if the worker is not available.
 */
export async function apiGenerateText(params: GenerateTextParams, signal?: AbortSignal): Promise<GenerateTextResult> {
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
			signal,
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

function visibleChat(raw: string) {
	return stripThinking(takeUsageTrailer(raw).text)
}

/**
 * Stream a chat reply from /api/chat. `onText` gets the full text so far.
 * Resolves with the final text and token usage; rejects on an error.
 */
export async function apiChatStream(
	params: { model?: string; messages: ChatMessage[] } & LlmRequestSettings,
	onText: (text: string) => void,
	signal?: AbortSignal
): Promise<{ text: string; usage?: LlmUsage }> {
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
		onText(visibleChat(text))
	}
	const errorAt = takeUsageTrailer(text).text.lastIndexOf('\n\n[error] ')
	if (errorAt !== -1) throw new Error(takeUsageTrailer(text).text.slice(errorAt + 10))
	const done = takeUsageTrailer(text)
	return { text: stripThinking(done.text), usage: done.usage }
}

/** Hide <think>…</think> blocks that some local models write into the text. */
export function stripThinking(text: string) {
	const withoutClosed = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '')
	const open = withoutClosed.indexOf('<think>')
	return (open === -1 ? withoutClosed : withoutClosed.slice(0, open)).trimStart()
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal,
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
	/** Response headers, one "name: value" line each. */
	headers?: string
	ms?: number
}

/** Bring an image URL, data URL, or stored image path into the image store. */
export async function apiImportImage(source: string): Promise<string> {
	const value = source.trim()
	if (value.startsWith('data:image/') || value.startsWith('/api/images/')) return value
	if (/^https?:\/\//i.test(value)) {
		const data = await postJson<{ imageUrl: string }>('/api/images/from-url', { url: value })
		return data.imageUrl
	}
	throw new Error('Paste an image, upload one, or use an image URL.')
}

/** Is this URL an image? Checked before pasting a link onto the canvas. */
export function apiProbeImage(url: string) {
	return postJson<{ isImage: boolean; mime?: string; width?: number; height?: number }>('/api/images/probe', { url })
}

export interface GenerateImageParams {
	/** Model key from the AI config; empty means the default image model. */
	model?: string
	prompt: string
	n: number
	size?: string
	/** Reference images: data URLs, /api/images/… URLs, or http(s) URLs. */
	images?: string[]
	negative?: string
	seed?: number
}

/** Generate N images from a prompt. Returns /api/images/… URLs; keys stay on the server. */
export function apiGenerateImage(params: GenerateImageParams, signal?: AbortSignal) {
	return postJson<{ images: string[] }>('/api/generate-image', params, signal)
}

/** HTTP node: the local server makes the request (no CORS limits). */
export function apiHttp(
	params: {
		method: string
		url: string
		headers?: Record<string, string>
		body?: string
		extractText?: boolean
		/** Bearer / basic auth: `auth` picks the scheme, `authRef` (`secret:<id>`) or `authValue` gives the value. The server resolves it; the value never comes back. */
		auth?: string
		authRef?: string
		authValue?: string
	},
	signal?: AbortSignal
) {
	return postJson<HttpResult>('/api/http', params, signal)
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
export function apiJev(
	params: {
		model?: string
		type: 'noul' | 'choice' | 'score'
		question: string
		context?: string
		options?: string[]
		levels?: string[]
	},
	signal?: AbortSignal
) {
	return postJson<JevResult>('/api/jev', params, signal)
}

/** Network tools on the local server: ping, traceroute, dig, whois, ports, subnet… */
export function apiNetTool(params: { tool: string; target: string; option?: string }) {
	return postJson<{ output: string; ms: number }>('/api/nettool', params)
}

/** Save a key to the server's secret store; the node only ever keeps the returned ref. */
export async function apiSaveSecret(value: string): Promise<string> {
	return (await postJson<{ ref: string }>('/api/secrets', { value })).ref
}

/** List the models a provider (saved or ad-hoc) serves, e.g. for the Model provider card. */
export function apiProviderModels(provider: { kind: string; baseURL?: string; keyRef?: string; accountId?: string }) {
	return postJson<{ models: { id: string; label?: string; vision?: boolean; image?: boolean }[] }>(
		'/api/providers/models',
		{ provider: { id: 'adhoc', name: 'adhoc', enabled: true, ...provider } }
	)
}

// --- Web search (WP24): Exa, Tavily, Brave ----------------------------------

export interface SearchResultItem {
	title: string
	url: string
	snippet: string
	published?: string
	score?: number
	content?: string
}

export interface SearchOptions {
	tavilyDepth?: 'basic' | 'advanced'
	tavilyIncludeAnswer?: boolean
	exaIncludeText?: boolean
}

export interface SearchParams {
	provider: 'exa' | 'tavily' | 'brave'
	query: string
	/** The card's own saved key; falls back to the provider default from the AI providers dialog. */
	keyRef?: string
	count?: number
	options?: SearchOptions
}

export interface SearchResult {
	results: SearchResultItem[]
	provider: string
	ms: number
	answer?: string
}

/** Web search node: the local server calls Exa/Tavily/Brave (keys never reach the browser). */
export function apiSearch(params: SearchParams, signal?: AbortSignal) {
	return postJson<SearchResult>('/api/search', params, signal)
}

// --- WP31: Agent card -------------------------------------------------------

export interface AgentRunParams {
	task: string
	context?: string
	model?: string
	search?: string[]
	mcpServers?: string[]
	skills?: string[]
	systemPrompt?: string
	maxSteps?: number
}

/** One event from `POST /api/agent/run` (shape mirrors `server/agent/types.ts`'s `AgentRunEvent`). */
export type AgentRunEvent =
	| { type: 'step_start'; step: number }
	| { type: 'tool_call'; step: number; toolCallId: string; name: string; argsPreview: string }
	| { type: 'tool_result'; step: number; toolCallId: string; name: string; resultPreview: string; isError: boolean }
	| { type: 'text_delta'; step: number; delta: string }
	| { type: 'final'; output: string; steps: unknown[] }
	| { type: 'error'; message: string; steps: unknown[] }

/** Agent card: streams SSE progress events from the pi-agent-core run on the server. */
export async function* apiAgentRun(params: AgentRunParams, signal?: AbortSignal): AsyncGenerator<AgentRunEvent> {
	const res = await fetch('/api/agent/run', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(params),
		signal,
	})
	if (!res.body) {
		const err = await res.json().catch(() => ({ error: res.statusText }))
		throw new Error((err as { error?: string }).error ?? 'Agent run failed')
	}
	const reader = res.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ''
	try {
		while (true) {
			const { value, done } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true })
			const chunks = buffer.split('\n\n')
			buffer = chunks.pop() || ''
			for (const chunk of chunks) {
				const match = chunk.match(/^data: (.+)$/m)
				if (!match) continue
				yield JSON.parse(match[1]) as AgentRunEvent
			}
		}
	} finally {
		reader.releaseLock()
	}
}
