import { describe, expect, it } from 'vitest'
import {
	fuzzySubsequenceMatch,
	PickerCandidate,
	rankCandidates,
	recencyScore,
	scoreCandidate,
} from '../shared/pickerRank'

const summarize: PickerCandidate = {
	type: 'summarize',
	title: 'Summarize',
	description: 'Summarizes text, a URL, an image or a video with an LLM.',
	keywords: ['ai', 'summary', 'tldr', 'bullets', 'llm'],
}

const textAi: PickerCandidate = {
	type: 'text_ai',
	title: 'AI text',
	description: 'Rewrites, translates, summarizes or otherwise edits text with an LLM.',
	keywords: ['ai', 'llm', 'rewrite', 'translate', 'edit', 'instruction'],
}

const chat: PickerCandidate = {
	type: 'chat',
	title: 'Chat message',
	description: 'One turn of a branching chat conversation with an LLM.',
	keywords: ['ai', 'chat', 'conversation', 'message', 'llm'],
}

// WP18: scoreCandidate/rankCandidates are now thin wrappers over the shared card
// search engine (shared/cardSearch.ts, tested on its own in tests/cardSearch.test.ts).
// These tests check the relative behaviour a caller depends on, not the exact
// coefficients of the old standalone formula.
describe('scoreCandidate', () => {
	it('scores a title-prefix match higher than a contains-only match', () => {
		const prefix = scoreCandidate('sum', summarize, {})
		// "Summarize" starts with "sum"; text_ai's title does not, only its description does.
		const containsOnly = scoreCandidate('sum', textAi, {})
		expect(prefix).toBeGreaterThan(containsOnly)
	})

	it('gives a keyword hit a real score even with no title or description match', () => {
		const score = scoreCandidate('tldr', summarize, {})
		expect(score).toBeGreaterThan(0)
	})

	it('scores an empty query as zero plus recency only', () => {
		expect(scoreCandidate('', summarize, {})).toBe(0)
		const now = Date.now()
		const withRecency = scoreCandidate('', summarize, { summarize: { count: 3, last: now } }, now)
		expect(withRecency).toBeGreaterThan(0)
	})

	it('drops unrelated candidates to zero', () => {
		expect(scoreCandidate('zzzzz-no-match', summarize, {})).toBe(0)
	})

	it('gives a near-miss (typo-ish) query some credit via trigram similarity', () => {
		// "cht" shares no whole word with "chat message" but shares character trigrams with it.
		const score = scoreCandidate('cht', chat, {})
		expect(score).toBeGreaterThan(0)
	})
})

describe('recencyScore', () => {
	it('is zero with no record', () => {
		expect(recencyScore(undefined)).toBe(0)
	})

	it('decays over time (half-life of 14 days)', () => {
		const now = Date.now()
		const fresh = recencyScore({ count: 4, last: now }, now)
		const twoWeeksAgo = recencyScore({ count: 4, last: now - 14 * 24 * 60 * 60 * 1000 }, now)
		expect(twoWeeksAgo).toBeCloseTo(fresh / 2, 5)
	})

	it('increases with more picks, capped at 1', () => {
		const now = Date.now()
		const few = recencyScore({ count: 1, last: now }, now)
		const many = recencyScore({ count: 50, last: now }, now)
		expect(many).toBeGreaterThan(few)
		expect(many).toBeLessThanOrEqual(1)
	})
})

describe('fuzzySubsequenceMatch', () => {
	it('matches in-order characters', () => {
		expect(fuzzySubsequenceMatch('cm', 'chat message')).toBe(true)
	})

	it('rejects out-of-order characters', () => {
		expect(fuzzySubsequenceMatch('mc', 'chat message')).toBe(false)
	})

	it('treats an empty query as always matching', () => {
		expect(fuzzySubsequenceMatch('', 'anything')).toBe(true)
	})
})

describe('rankCandidates', () => {
	const candidates = [summarize, textAi, chat]

	it('ranks the best title match first', () => {
		const ranked = rankCandidates('summ', candidates, {})
		expect(ranked[0].candidate.type).toBe('summarize')
	})

	it('drops candidates that do not match a non-empty query', () => {
		const ranked = rankCandidates('xyz-nothing-like-this', candidates, {})
		expect(ranked).toHaveLength(0)
	})

	it('keeps every candidate for an empty query, ranked by recency', () => {
		const now = Date.now()
		const ranked = rankCandidates('', candidates, { chat: { count: 5, last: now } }, now)
		expect(ranked).toHaveLength(3)
		expect(ranked[0].candidate.type).toBe('chat')
	})
})
