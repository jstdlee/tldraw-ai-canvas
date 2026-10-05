/** Find and replace preview. The canvas search panel uses this. */

export interface SearchQuery {
	text: string
	regexp: boolean
	caseSensitive: boolean
	component: string
	asset: string
}

export interface SearchHit {
	index: number
	length: number
}

export function compileSearch(query: SearchQuery): RegExp | null {
	if (!query.text) return null
	const flags = query.caseSensitive ? 'g' : 'gi'
	if (query.regexp) return new RegExp(query.text, flags)
	const escaped = query.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	return new RegExp(escaped, flags)
}

export function searchHits(hay: string, query: SearchQuery): SearchHit[] {
	const pattern = compileSearch(query)
	if (!pattern) return []
	const hits: SearchHit[] = []
	for (const match of hay.matchAll(pattern)) {
		if (match.index == null || match[0].length === 0) continue
		hits.push({ index: match.index, length: match[0].length })
		if (hits.length >= 50) break
	}
	return hits
}

export function previewReplace(hay: string, query: SearchQuery, replacement: string): { next: string; count: number } {
	const pattern = compileSearch(query)
	if (!pattern) return { next: hay, count: 0 }
	let count = 0
	const next = hay.replace(pattern, () => {
		count++
		return replacement
	})
	return { next, count }
}

export function assetOf(shapeType: string, nodeType?: string): string {
	if (shapeType === 'markdown') return 'md'
	if (shapeType === 'mermaid' || nodeType === 'code') return 'code'
	if (shapeType === 'image') return 'image'
	if (shapeType === 'text' || shapeType === 'note' || shapeType === 'geo') return 'text'
	if (shapeType === 'node') return 'node'
	if (shapeType === 'video' || nodeType === 'video') return 'video'
	return shapeType
}
