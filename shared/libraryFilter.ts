import { NODE_GROUP_LABELS } from './nodeGroups'
import { CardDoc, searchCards } from './cardSearch'

/** One library row the sidebar can filter. `category` is the group id, such as `data`. */
export interface LibraryEntry {
	type: string
	title: string
	category: string
	/** Extra search words. When omitted, `LIBRARY_KEYWORDS` is used for known types. */
	keywords?: string
}

/**
 * Words the title does not say, but a person will type.
 * `pdf` is File in (any upload). `json` is the nodes that parse or show JSON.
 */
export const LIBRARY_KEYWORDS: Record<string, string> = {
	file_in: 'upload file url pdf txt csv image read',
	text_tool: 'json csv markdown regex template',
	text_ai: 'json summarize translate',
	output: 'json markdown mermaid image',
	code: 'javascript typescript python json',
	chart: 'bar line pie',
	image_gen: 'dall-e imagen flux stable diffusion openrouter txt2img',
}

function toDoc(def: LibraryEntry): CardDoc {
	const label = NODE_GROUP_LABELS[def.category] ?? def.category
	const extra = def.keywords !== undefined ? def.keywords : (LIBRARY_KEYWORDS[def.type] ?? '')
	return {
		id: def.type,
		type: def.type,
		title: def.title,
		group: def.category,
		description: '',
		keywords: [def.type, def.category, label, ...extra.split(/\s+/).filter(Boolean)],
	}
}

/**
 * Ranks every row against `query` with the shared card search engine
 * (`shared/cardSearch.ts`): title, type id, category label, and extra keywords. An
 * empty query returns every row, unranked, in its original order.
 */
export function filterLibrary<T extends LibraryEntry>(defs: readonly T[], query: string): T[] {
	const q = query.trim()
	if (!q) return [...defs]
	const byType = new Map(defs.map((def) => [def.type, def]))
	const ranked = searchCards(q, defs.map(toDoc))
	return ranked.map((entry) => byType.get(entry.doc.type)!).filter(Boolean)
}
