/**
 * The "recently picked" store shared by the wire-drop picker, the library, and the
 * command palette (via `shared/cardSearch.ts`). Split out of `shared/pickerRank.ts`
 * (which re-exports all of this) so `cardSearch.ts` can depend on it without a cycle.
 */

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

/** Record a pick (bumps count, resets the recency clock). Never throws. Keyed by card id (see cardSearch.ts), which is the node type for a plain card. */
export function recordPick(id: string, now = Date.now()) {
	try {
		const store = readPickerRecency()
		const prior = store[id]
		store[id] = { count: (prior?.count ?? 0) + 1, last: now }
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
