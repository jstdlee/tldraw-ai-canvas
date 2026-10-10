import { NODE_GROUP_LABELS } from './nodeGroups'

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

function searchText(def: LibraryEntry): string {
	const label = NODE_GROUP_LABELS[def.category] ?? def.category
	const extra = def.keywords !== undefined ? def.keywords : (LIBRARY_KEYWORDS[def.type] ?? '')
	return `${def.title}\n${def.type}\n${def.category}\n${label}\n${extra}`.toLowerCase()
}

/** Case-insensitive match on title, type id, and category label. An empty query returns every row. */
export function filterLibrary<T extends LibraryEntry>(defs: readonly T[], query: string): T[] {
	const q = query.trim().toLowerCase()
	if (!q) return [...defs]
	return defs.filter((def) => searchText(def).includes(q))
}
