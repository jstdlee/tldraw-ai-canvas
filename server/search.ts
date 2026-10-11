/**
 * WP24: runs one web search against Exa, Tavily or Brave. The server holds the keys (the
 * secret store, or a provider default from `data/search-config.json`); the client only ever
 * sends `provider`/`query`/`count`/`options` and, optionally, its own `keyRef`.
 */

import {
	buildSearchRequest,
	clampSearchCount,
	parseSearchResponse,
	SEARCH_PROVIDER_LABELS,
	SearchOptions,
	SearchProviderId,
	SearchResultItem,
} from '../shared/search'
import { resolveSecret } from '../shared/secrets'
import { ConfigError } from './config'
import { loadSearchConfig } from './searchConfig'
import { getSecretValue } from './secretsStore'

const TIMEOUT_MS = 20_000

export interface SearchInput {
	provider: SearchProviderId
	query: string
	/** `secret:<id>` or `env:NAME`; falls back to the provider's saved key when empty. */
	keyRef?: string
	count?: number
	options?: SearchOptions
	signal?: AbortSignal
}

export interface SearchOutput {
	results: SearchResultItem[]
	provider: SearchProviderId
	ms: number
	answer?: string
}

export async function runSearch(input: SearchInput): Promise<SearchOutput> {
	const { provider, query, options, signal } = input
	if (!provider || !(provider in SEARCH_PROVIDER_LABELS)) throw new ConfigError('Unknown search provider')
	if (!query?.trim()) throw new ConfigError('query is required')

	const savedRef = loadSearchConfig()[provider]?.keyRef
	const ref = input.keyRef?.trim() || savedRef
	if (!ref) {
		throw new ConfigError(
			`${SEARCH_PROVIDER_LABELS[provider]} needs an API key. Add one on the card, or in AI providers → Search providers.`
		)
	}
	let apiKey: string
	try {
		apiKey = resolveSecret(ref, process.env, getSecretValue)
	} catch (e) {
		// Never let a resolution error leak the ref/key; keep the provider name only.
		throw new ConfigError(`${SEARCH_PROVIDER_LABELS[provider]}: ${(e as Error).message}`)
	}

	const count = clampSearchCount(input.count)
	const built = buildSearchRequest(provider, apiKey, query.trim(), count, options)

	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
	const onAbort = () => controller.abort()
	signal?.addEventListener('abort', onAbort)

	const started = Date.now()
	try {
		const res = await fetch(built.url, {
			method: built.method,
			headers: built.headers,
			body: built.body,
			signal: controller.signal,
		})
		const text = await res.text()
		let json: unknown = {}
		if (text) {
			try {
				json = JSON.parse(text)
			} catch {
				json = {}
			}
		}
		if (!res.ok) {
			const message =
				(typeof json === 'object' && json
					? (json as { error?: string; message?: string }).error ?? (json as { message?: string }).message
					: undefined) || res.statusText
			throw new ConfigError(`${SEARCH_PROVIDER_LABELS[provider]} ${res.status}: ${message}`)
		}
		const { results, answer } = parseSearchResponse(provider, json)
		return { results, provider, ms: Date.now() - started, answer }
	} catch (e) {
		if (signal?.aborted) throw e // Stop: let the route's AbortError propagate as-is.
		if (e instanceof ConfigError) throw e
		if ((e as Error)?.name === 'AbortError') throw new ConfigError(`${SEARCH_PROVIDER_LABELS[provider]} timed out`)
		throw new ConfigError(`${SEARCH_PROVIDER_LABELS[provider]}: ${(e as Error).message}`)
	} finally {
		clearTimeout(timeout)
		signal?.removeEventListener('abort', onAbort)
	}
}
