import { isMermaid, looksLikeMarkdown } from './clipText'

export type ContentKind = 'image' | 'url' | 'mermaid' | 'markdown' | 'json' | 'text'

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
