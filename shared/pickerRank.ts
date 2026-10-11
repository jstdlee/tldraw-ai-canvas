/**
 * Pure ranking logic for the on-canvas node search picker (WP8 section 6).
 * No DOM/editor dependencies, so it is unit-testable in Node.
 *
 * WP18: the actual scoring (BM25 + trigram + prefix + recency + port compatibility) now
 * lives in `shared/cardSearch.ts`, the one search engine shared by the library, the
 * wire-drop picker, the command palette and the Build-with-AI chips. `scoreCandidate`/
 * `rankCandidates` below are kept as thin wrappers over it so this narrower shape keeps
 * working for existing callers and tests. The recency store itself lives in
 * `shared/recency.ts` (re-exported here) so `cardSearch.ts` can use it without a cycle.
 */

import { CardDoc, searchCards } from './cardSearch'

export { readPickerRecency, recordPick, recencyScore } from './recency'
export type { PickRecord, PickerRecency } from './recency'

export interface PickerCandidate {
	type: string
	title: string
	description: string
	keywords: string[]
}

export interface RankedCandidate {
	candidate: PickerCandidate
	score: number
}

/** Subsequence match: every character of `query` appears in `text`, in order. */
export function fuzzySubsequenceMatch(query: string, text: string): boolean {
	if (!query) return true
	let qi = 0
	for (let ti = 0; ti < text.length && qi < query.length; ti++) {
		if (text[ti] === query[qi]) qi++
	}
	return qi === query.length
}

function toDoc(candidate: PickerCandidate): CardDoc {
	return {
		id: candidate.type,
		type: candidate.type,
		title: candidate.title,
		group: '',
		description: candidate.description,
		keywords: candidate.keywords,
	}
}

/** The candidate's relevance to `query` under the shared card search engine. */
export function scoreCandidate(
	query: string,
	candidate: PickerCandidate,
	recency: import('./recency').PickerRecency,
	now = Date.now()
): number {
	const [ranked] = searchCards(query, [toDoc(candidate)], { recency, now })
	return ranked?.score ?? 0
}

/**
 * Rank candidates by relevance, best first. An empty query ranks everything by
 * recency (see `searchCards`), and non-matching candidates are dropped for a
 * non-empty query.
 */
export function rankCandidates(
	query: string,
	candidates: PickerCandidate[],
	recency: import('./recency').PickerRecency,
	now = Date.now()
): RankedCandidate[] {
	const byId = new Map(candidates.map((c) => [c.type, c]))
	const ranked = searchCards(query, candidates.map(toDoc), { recency, now })
	return ranked.map((entry) => ({ candidate: byId.get(entry.doc.type)!, score: entry.score }))
}
