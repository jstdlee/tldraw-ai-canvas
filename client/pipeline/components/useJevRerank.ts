import { useEffect, useMemo, useState } from 'react'
import { blendWithJev, RankedCard } from '../../../shared/cardSearch'

/**
 * The optional JEV re-rank (shared/cardSearch.ts's `blendWithJev`), as one hook so the
 * wire-drop picker (OnCanvasNodePicker) and both command palettes (ShellChrome) blend the
 * same way instead of each copying the debounce/fetch/abort dance.
 *
 * Eligibility: only for a real phrase (>= 3 words, e.g. "turn monthly sales into a bar
 * chart") or a query of >= 3 characters with >= 3 local results — never for a bare
 * keystroke. Local results always show first; the JEV call only ever re-orders them
 * after it lands, debounced 350ms, aborted after 2.5s, and ignored if the query moved on.
 * "Smart ranking" is one on/off switch shared by every caller (same localStorage key).
 */

const SMART_RANKING_KEY = 'oh-my-tldraw:picker-smart-ranking'
const JEV_DEBOUNCE_MS = 350
const JEV_TIMEOUT_MS = 2500
const JEV_MIN_QUERY_LENGTH = 3
const JEV_MIN_CANDIDATES = 3
const JEV_PHRASE_WORDS = 3
const JEV_TOP_N = 8

export function readSmartRanking(): boolean {
	try {
		return localStorage.getItem(SMART_RANKING_KEY) !== 'off'
	} catch {
		return true
	}
}

export function writeSmartRanking(on: boolean) {
	try {
		localStorage.setItem(SMART_RANKING_KEY, on ? 'on' : 'off')
	} catch {
		// Private mode, or no localStorage: the choice just isn't remembered.
	}
}

export interface JevRerankResult {
	/** Local ranking, blended 0.6/0.4 with JEV's order once (and only while) JEV is used. */
	ranked: RankedCard[]
	/** Whether the current result is actually JEV-blended (for the ✦ "ranked" mark). */
	usedJev: boolean
	smartRanking: boolean
	setSmartRanking: (on: boolean) => void
}

/**
 * `contextLabel` is one line of free text describing what's being picked for — e.g. the
 * selected card's title, or the wire's source card and its output preview — sent to JEV
 * alongside the query so it can judge "which card does the user want next" in context.
 */
export function useJevRerank(query: string, localRanked: RankedCard[], contextLabel: string): JevRerankResult {
	const [smartRanking, setSmartRanking] = useState(readSmartRanking)
	const [jevOrder, setJevOrder] = useState<{ query: string; probs: Record<string, number> } | null>(null)

	useEffect(() => {
		const q = query.trim()
		const words = q.split(/\s+/).filter(Boolean)
		const isPhrase = words.length >= JEV_PHRASE_WORDS
		const longEnough = q.length >= JEV_MIN_QUERY_LENGTH && localRanked.length >= JEV_MIN_CANDIDATES
		if (!smartRanking || !(isPhrase || longEnough)) return

		const controller = new AbortController()
		const timeout = window.setTimeout(() => {
			const top = localRanked.slice(0, JEV_TOP_N)
			const timer = window.setTimeout(() => controller.abort(), JEV_TIMEOUT_MS)
			void fetch('/api/jev', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: controller.signal,
				body: JSON.stringify({
					type: 'choice',
					question: `Which card does the user want to insert? Query: "${q}"`,
					context: contextLabel,
					// Short labels without colons: the server splits "label: description" at the first
					// colon, and card ids such as "chart:bar" would otherwise collide.
					options: top.map((entry, i) => `c${i + 1}: ${entry.doc.title} — ${entry.doc.description}`),
				}),
			})
				.then((response) => (response.ok ? response.json() : null))
				.then((result: { probabilities?: Record<string, number> } | null) => {
					if (!result?.probabilities) return
					// Stale response (query changed meanwhile): ignore it.
					if (query.trim() !== q) return
					const probs: Record<string, number> = {}
					for (const [label, p] of Object.entries(result.probabilities)) {
						const index = Number(label.replace(/^c/, '')) - 1
						const entry = top[index]
						if (entry && Number.isFinite(p)) probs[entry.doc.id] = p
					}
					if (Object.keys(probs).length) setJevOrder({ query: q, probs })
				})
				.catch(() => {
					// Timeout or network error: keep the local order silently.
				})
				.finally(() => window.clearTimeout(timer))
		}, JEV_DEBOUNCE_MS)
		return () => {
			window.clearTimeout(timeout)
			controller.abort()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [query, localRanked, smartRanking, contextLabel])

	const usedJev = smartRanking && !!jevOrder && jevOrder.query === query.trim()

	const ranked = useMemo(
		() => (usedJev ? blendWithJev(localRanked, jevOrder!.probs) : localRanked),
		[usedJev, localRanked, jevOrder]
	)

	return { ranked, usedJev, smartRanking, setSmartRanking: (on) => { setSmartRanking(on); writeSmartRanking(on) } }
}
