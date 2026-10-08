import { isMermaid, looksLikeMarkdown } from './clipText'

export type ContentKind = 'image' | 'url' | 'mermaid' | 'markdown' | 'json' | 'text'

/** A bare host (www.example.com, example.com/path) — no scheme yet. */
const BARE_HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?$/i

/**
 * Give a value a URL scheme when it clearly is one. `www.wikipedia.com` and
 * `example.com/page` become `https://…`; anything with a scheme, a data/api
 * URL, or plain text is returned unchanged. Never upgrades a bare word.
 */
export function normalizeUrl(value: string): string {
	const v = value.trim()
	if (/^(https?:|data:|\/api\/|blob:|file:)/i.test(v)) return v
	if (BARE_HOST.test(v) && !/\s/.test(v)) return `https://${v}`
	return v
}

/** True when the value is (or normalizes to) a fetchable http(s) URL. */
export function isFetchableUrl(value: string): boolean {
	return /^https?:\/\/\S+$/i.test(normalizeUrl(value))
}

/** Guess how a value should be shown. */
export function detectContentKind(value: string): ContentKind {
	const v = value.trim()
	if (/^(data:image\/|\/api\/images\/)/.test(v) || /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|avif)(\?\S*)?$/i.test(v)) {
		return 'image'
	}
	if (/^https?:\/\/\S+$/.test(v)) return 'url'
	if (isMermaid(v)) return 'mermaid'
	if (/^[[{]/.test(v)) {
		try {
			JSON.parse(v)
			return 'json'
		} catch {
			// not JSON
		}
	}
	if (looksLikeMarkdown(v)) return 'markdown'
	return 'text'
}
