/**
 * A fast, deterministic hash of a JSON-able value, used to cache a card's
 * run (WP14 Part B): the same card type + settings + inputs hashes the
 * same, so a repeat Run can be skipped.
 *
 * FNV-1a (64-bit arithmetic, kept in a 53-bit-safe integer so it prints as
 * a plain JS number in base 36). Not for security, only for "did anything
 * that matters change".
 */

const FNV_OFFSET = 14695981039346656037n
const FNV_PRIME = 1099511628211n
const MASK64 = (1n << 64n) - 1n
const MASK53 = (1n << 53n) - 1n

/** JSON.stringify with object keys sorted, so key order never changes the hash. */
function stableStringify(value: unknown): string {
	return JSON.stringify(value, (_key, v) => {
		if (v === undefined) return null
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			const sorted: Record<string, unknown> = {}
			for (const key of Object.keys(v).sort()) sorted[key] = (v as Record<string, unknown>)[key]
			return sorted
		}
		return v
	})
}

/** A short, stable hash string for `value` (its sorted-key JSON form). */
export function runHash(value: unknown): string {
	const json = stableStringify(value)
	let hash = FNV_OFFSET
	for (let i = 0; i < json.length; i++) {
		hash ^= BigInt(json.charCodeAt(i))
		hash = (hash * FNV_PRIME) & MASK64
	}
	return (hash & MASK53).toString(36)
}
