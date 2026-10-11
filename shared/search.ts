/**
 * WP24: web search card (Exa, Tavily, Brave). Pure request builders and response parsers —
 * no tldraw import, testable in Node. The server (`server/search.ts`) calls these to build the
 * outgoing request and normalize each provider's response into one shape; the client never
 * talks to these APIs directly (keys stay on the server).
 */

export type SearchProviderId = 'exa' | 'tavily' | 'brave'

export const SEARCH_PROVIDER_IDS: SearchProviderId[] = ['exa', 'tavily', 'brave']

export const SEARCH_PROVIDER_LABELS: Record<SearchProviderId, string> = {
	exa: 'Exa',
	tavily: 'Tavily',
	brave: 'Brave Search',
}

export interface SearchOptions {
	/** Tavily: 'basic' (fast) or 'advanced' (slower, more relevant). Default 'basic'. */
	tavilyDepth?: 'basic' | 'advanced'
	/** Tavily: also ask for a short LLM-generated answer. */
	tavilyIncludeAnswer?: boolean
	/** Exa: fetch each result's extracted page text, not just its title/URL. */
	exaIncludeText?: boolean
}

export interface SearchResultItem {
	title: string
	url: string
	snippet: string
	published?: string
	score?: number
	/** Full extracted text (Exa with `exaIncludeText`, Tavily always), when the provider sent one. */
	content?: string
}

export interface BuiltSearchRequest {
	url: string
	method: 'GET' | 'POST'
	headers: Record<string, string>
	body?: string
}

export interface ParsedSearchResponse {
	results: SearchResultItem[]
	/** Tavily only: a short LLM-generated answer, when requested and returned. */
	answer?: string
}

const DEFAULT_COUNT = 5
const MAX_COUNT = 20
const SNIPPET_MAX = 500

export function clampSearchCount(count: number | undefined): number {
	const n = Math.round(count ?? DEFAULT_COUNT)
	return Math.min(MAX_COUNT, Math.max(1, Number.isFinite(n) ? n : DEFAULT_COUNT))
}

function snippetOf(text: string | undefined): string {
	if (!text) return ''
	const flat = text.replace(/\s+/g, ' ').trim()
	return flat.length > SNIPPET_MAX ? flat.slice(0, SNIPPET_MAX) + '…' : flat
}

// ---------------------------------------------------------------------------
// Exa: POST https://api.exa.ai/search, header x-api-key.
// https://exa.ai/docs/reference/search
// ---------------------------------------------------------------------------

export function buildExaRequest(apiKey: string, query: string, count: number, options?: SearchOptions): BuiltSearchRequest {
	const body: Record<string, unknown> = { query, numResults: count, type: 'auto' }
	if (options?.exaIncludeText) body.contents = { text: { maxCharacters: 2000 } }
	return {
		url: 'https://api.exa.ai/search',
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
		body: JSON.stringify(body),
	}
}

interface ExaApiResult {
	title?: string
	url: string
	text?: string
	publishedDate?: string
	score?: number
	highlights?: string[]
}

export function parseExaResponse(json: unknown): ParsedSearchResponse {
	const results = Array.isArray((json as { results?: unknown })?.results)
		? ((json as { results: ExaApiResult[] }).results)
		: []
	return {
		results: results
			.filter((r) => r && typeof r.url === 'string')
			.map((r) => ({
				title: r.title?.trim() || r.url,
				url: r.url,
				snippet: snippetOf(r.text || r.highlights?.[0]),
				published: r.publishedDate || undefined,
				score: typeof r.score === 'number' ? r.score : undefined,
				content: r.text || undefined,
			})),
	}
}

// ---------------------------------------------------------------------------
// Tavily: POST https://api.tavily.com/search, header Authorization: Bearer <key>.
// https://docs.tavily.com/documentation/api-reference/endpoint/search
// ---------------------------------------------------------------------------

export function buildTavilyRequest(apiKey: string, query: string, count: number, options?: SearchOptions): BuiltSearchRequest {
	const body = {
		query,
		max_results: count,
		search_depth: options?.tavilyDepth ?? 'basic',
		include_answer: !!options?.tavilyIncludeAnswer,
	}
	return {
		url: 'https://api.tavily.com/search',
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
		body: JSON.stringify(body),
	}
}

interface TavilyApiResult {
	title?: string
	url: string
	content?: string
	score?: number
}

export function parseTavilyResponse(json: unknown): ParsedSearchResponse {
	const data = (json as { results?: TavilyApiResult[]; answer?: string }) ?? {}
	const results = Array.isArray(data.results) ? data.results : []
	return {
		results: results
			.filter((r) => r && typeof r.url === 'string')
			.map((r) => ({
				title: r.title?.trim() || r.url,
				url: r.url,
				snippet: snippetOf(r.content),
				score: typeof r.score === 'number' ? r.score : undefined,
				content: r.content || undefined,
			})),
		answer: data.answer?.trim() || undefined,
	}
}

// ---------------------------------------------------------------------------
// Brave: GET https://api.search.brave.com/res/v1/web/search, header X-Subscription-Token.
// https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
// ---------------------------------------------------------------------------

export function buildBraveRequest(apiKey: string, query: string, count: number): BuiltSearchRequest {
	const url = new URL('https://api.search.brave.com/res/v1/web/search')
	url.searchParams.set('q', query)
	url.searchParams.set('count', String(count))
	return {
		url: url.toString(),
		method: 'GET',
		headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
	}
}

interface BraveApiResult {
	title?: string
	url: string
	description?: string
	age?: string
}

export function parseBraveResponse(json: unknown): ParsedSearchResponse {
	const results = ((json as { web?: { results?: BraveApiResult[] } })?.web?.results ?? []) as BraveApiResult[]
	return {
		results: results
			.filter((r) => r && typeof r.url === 'string')
			.map((r) => ({
				title: r.title?.trim() || r.url,
				url: r.url,
				snippet: snippetOf(r.description),
				published: r.age || undefined,
			})),
	}
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function buildSearchRequest(
	provider: SearchProviderId,
	apiKey: string,
	query: string,
	count: number,
	options?: SearchOptions
): BuiltSearchRequest {
	switch (provider) {
		case 'exa':
			return buildExaRequest(apiKey, query, count, options)
		case 'tavily':
			return buildTavilyRequest(apiKey, query, count, options)
		case 'brave':
			return buildBraveRequest(apiKey, query, count)
	}
}

export function parseSearchResponse(provider: SearchProviderId, json: unknown): ParsedSearchResponse {
	switch (provider) {
		case 'exa':
			return parseExaResponse(json)
		case 'tavily':
			return parseTavilyResponse(json)
		case 'brave':
			return parseBraveResponse(json)
	}
}

/** Markdown list used as the card's main `output`: "1. [title](url) — snippet". */
export function formatSearchMarkdown(results: SearchResultItem[]): string {
	if (!results.length) return ''
	return results
		.map((r, i) => `${i + 1}. [${r.title}](${r.url})${r.snippet ? ` — ${r.snippet}` : ''}`)
		.join('\n')
}
