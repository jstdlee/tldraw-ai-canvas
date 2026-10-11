/** Pure helpers for the logic nodes (If, And/Or/Not, For each). */

type Value = string | number | null | undefined

/** "false", "no", "0", "off", empty and null are false; everything else is true. */
export function isTruthy(value: Value): boolean {
	if (value == null) return false
	if (typeof value === 'number') return value !== 0 && !Number.isNaN(value)
	const v = value.trim().toLowerCase()
	return !(v === '' || v === 'false' || v === 'no' || v === '0' || v === 'off' || v === 'null' || v === 'undefined')
}

function asNumber(v: string) {
	const n = Number(String(v).trim().replace(/,/g, ''))
	return Number.isFinite(n) ? n : NaN
}

export function evaluateCondition(subject: string, condition: string, operand: string): boolean {
	const s = subject ?? ''
	const o = operand ?? ''
	switch (condition) {
		case 'truthy':
			return isTruthy(s)
		case 'empty':
			return !isTruthy(s)
		case 'equals':
			return s.trim().toLowerCase() === o.trim().toLowerCase()
		case 'not_equals':
			return s.trim().toLowerCase() !== o.trim().toLowerCase()
		case 'contains':
			return s.toLowerCase().includes(o.toLowerCase())
		case 'starts':
			return s.trim().toLowerCase().startsWith(o.toLowerCase())
		case 'ends':
			return s.trim().toLowerCase().endsWith(o.toLowerCase())
		case 'regex': {
			const literal = o.match(/^\/(.+)\/([a-z]*)$/s)
			try {
				return (literal ? new RegExp(literal[1], literal[2]) : new RegExp(o, 'i')).test(s)
			} catch {
				return false
			}
		}
		case 'gt':
			return asNumber(s) > asNumber(o)
		case 'gte':
			return asNumber(s) >= asNumber(o)
		case 'lt':
			return asNumber(s) < asNumber(o)
		case 'lte':
			return asNumber(s) <= asNumber(o)
		case 'is_image':
			return /^(data:image\/|\/api\/images\/)|^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i.test(s.trim())
		case 'is_json':
			try {
				JSON.parse(s)
				return true
			} catch {
				return false
			}
		default:
			return isTruthy(s)
	}
}

/** Split a list for the For each node. Empty items are skipped. */
export function splitItems(input: string, mode: string, separator: string): string[] {
	const text = input ?? ''
	let items: string[]
	switch (mode) {
		case 'separator':
			items = text.split(separator === '' ? ',' : separator.replace(/\\n/g, '\n').replace(/\\t/g, '\t'))
			break
		case 'paragraphs':
			items = text.split(/\r?\n\s*\r?\n/)
			break
		case 'json': {
			const data = JSON.parse(text)
			if (!Array.isArray(data)) throw new Error('Input is not a JSON array')
			return data.map((d) => (typeof d === 'string' ? d : JSON.stringify(d)))
		}
		case 'regex': {
			const re = new RegExp(separator || '\\S+', 'g')
			return [...text.matchAll(re)].map((m) => m[1] ?? m[0])
		}
		default:
			items = text.split(/\r?\n/)
	}
	return items.map((s) => s.trim()).filter(Boolean)
}

/** WP21 Part B ("logic inside For each"): what a For each item contributes to the loop's
 * results list. `result` is what reached the loop body's feedback `result` port for this item
 * — null when nothing did (e.g. the item's path ended in a branch, such as an `If`'s `else`,
 * that was never wired back to `result`). `noResult` controls what happens to that item. */
export type NoResultMode = 'skip' | 'keep' | 'error'

export interface LoopItemOutcome {
	/** What to add to the results list, or null to leave this item out entirely. */
	value: string | null
	/** Set only for `noResult: 'error'` when this item reached no result: stops the loop. */
	error?: string
}

export function resolveLoopItemResult(
	result: string | null,
	item: string,
	noResult: NoResultMode
): LoopItemOutcome {
	if (result != null) return { value: result }
	switch (noResult) {
		case 'keep':
			return { value: item }
		case 'error':
			return { value: null, error: 'reached no result' }
		default:
			return { value: null }
	}
}
