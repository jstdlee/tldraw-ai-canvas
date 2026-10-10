/**
 * Pure ranking logic for the on-canvas node search picker (WP8 section 6).
 * No DOM/editor dependencies, so it is unit-testable in Node.
 */

export interface PickerCandidate {
	type: string
	title: string
	description: string
	keywords: string[]
}

export interface PickRecord {
	count: number
	/** Epoch ms of the most recent pick. */
	last: number
}

export type PickerRecency = Record<string, PickRecord>

const RECENCY_KEY = 'oh-my-tldraw:picked'
const HALF_LIFE_DAYS = 14

/** Read the recency store from localStorage. Never throws (private mode, no storage, …). */
export function readPickerRecency(): PickerRecency {
	try {
		const raw = localStorage.getItem(RECENCY_KEY)
		if (!raw) return {}
		const parsed = JSON.parse(raw)
		return parsed && typeof parsed === 'object' ? (parsed as PickerRecency) : {}
	} catch {
		return {}
	}
}

/** Record a pick (bumps count, resets the recency clock). Never throws. */
export function recordPick(type: string, now = Date.now()) {
	try {
		const store = readPickerRecency()
		const prior = store[type]
		store[type] = { count: (prior?.count ?? 0) + 1, last: now }
		localStorage.setItem(RECENCY_KEY, JSON.stringify(store))
	} catch {
		// Private mode, or no localStorage: recency just isn't remembered.
	}
}

/** 0..1, higher for more and more recent picks. Decays with a 14-day half-life. */
export function recencyScore(record: PickRecord | undefined, now = Date.now()): number {
	if (!record || record.count <= 0) return 0
	const frequency = Math.min(1, Math.log2(1 + record.count) / 4)
	const daysSince = Math.max(0, (now - record.last) / (1000 * 60 * 60 * 24))
	const decay = Math.pow(0.5, daysSince / HALF_LIFE_DAYS)
	return frequency * decay
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

/**
 * score = 3·titlePrefix + 2·titleContains + 1.5·keywordHit + 1·descriptionContains
 *       + 0.8·recency + 0.5·exactTypeMatch, with a 0.5 fuzzy-subsequence fallback
 * when nothing else matched (an empty query always matches with score 0 plus recency).
 */
export function scoreCandidate(
	query: string,
	candidate: PickerCandidate,
	recency: PickerRecency,
	now = Date.now()
): number {
	const q = query.trim().toLowerCase()
	const title = candidate.title.toLowerCase()
	const recencyValue = recencyScore(recency[candidate.type], now)

	if (!q) return 0.8 * recencyValue

	const titlePrefix = title.startsWith(q)
	const titleContains = title.includes(q)
	const keywordHit = candidate.keywords.some((k) => {
		const kw = k.toLowerCase()
		return kw.includes(q) || q.includes(kw)
	})
	const descriptionContains = candidate.description.toLowerCase().includes(q)
	const exactTypeMatch = candidate.type.toLowerCase() === q

	let score =
		(titlePrefix ? 3 : 0) +
		(titleContains ? 2 : 0) +
		(keywordHit ? 1.5 : 0) +
		(descriptionContains ? 1 : 0) +
		0.8 * recencyValue +
		(exactTypeMatch ? 0.5 : 0)

	if (!titlePrefix && !titleContains && !keywordHit && !descriptionContains && !exactTypeMatch) {
		if (fuzzySubsequenceMatch(q, title)) score += 0.5
		else return 0
	}

	return score
}

export interface RankedCandidate {
	candidate: PickerCandidate
	score: number
}

/**
 * Rank candidates by local score, best first. With an empty query everything
 * scores from recency only (callers typically show "Recent" instead, see the
 * picker component), and candidates that don't match anything are dropped
 * when the query isn't empty.
 */
export function rankCandidates(
	query: string,
	candidates: PickerCandidate[],
	recency: PickerRecency,
	now = Date.now()
): RankedCandidate[] {
	const q = query.trim()
	const ranked = candidates
		.map((candidate) => ({ candidate, score: scoreCandidate(q, candidate, recency, now) }))
		.filter((entry) => q === '' || entry.score > 0)
	ranked.sort((a, b) => b.score - a.score)
	return ranked
}
