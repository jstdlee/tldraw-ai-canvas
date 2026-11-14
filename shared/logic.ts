/** Pure helpers for the logic nodes (If, And/Or/Not, For each). */

type Value = string | number | null | undefined

/** "false", "no", "0", "off", empty and null are false; everything else is true. WP45: a number
 * written as text is false when it is zero ("0.0", "-0", "0e3"), and an empty JSON list or
 * object ("[]", "{}") counts as empty, so a Code card's empty result tests as false. */
export function isTruthy(value: Value): boolean {
	if (value == null) return false
	if (typeof value === 'number') return value !== 0 && !Number.isNaN(value)
	const v = value.trim().toLowerCase()
	if (v === '' || v === 'false' || v === 'no' || v === '0' || v === 'off' || v === 'null' || v === 'undefined') return false
	if (v === '[]' || v === '{}') return false
	const n = asNumber(v)
	if (!Number.isNaN(n) && n === 0) return false
	return true
}

/** A number from text ("1,200" reads as 1200); NaN for empty or non-numeric text. WP45: empty
 * text used to read as 0 (Number('') is 0), so an empty value passed "is less than 5". */
function asNumber(v: string) {
	const text = String(v ?? '').trim().replace(/,/g, '')
	if (text === '') return NaN
	const n = Number(text)
	return Number.isFinite(n) ? n : NaN
}

/** Equal as numbers when both sides are numbers ("5" equals "5.0"), else as text (any case). */
function sameValue(a: string, b: string): boolean {
	const x = asNumber(a)
	const y = asNumber(b)
	if (!Number.isNaN(x) && !Number.isNaN(y)) return x === y
	return a.trim().toLowerCase() === b.trim().toLowerCase()
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
			return sameValue(s, o)
		case 'not_equals':
			return !sameValue(s, o)
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
		case 'between': {
			// WP27 Part D: operand is "min,max" (either order); both ends included.
			const [loRaw, hiRaw] = o.split(',')
			const a = asNumber(loRaw ?? '')
			const b = asNumber(hiRaw ?? '')
			if (Number.isNaN(a) || Number.isNaN(b)) return false
			const n = asNumber(s)
			const lo = Math.min(a, b)
			const hi = Math.max(a, b)
			return n >= lo && n <= hi
		}
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

/** Most items a For each range may produce, so a typo (1 to 1e9) cannot hang the canvas. */
export const MAX_RANGE_ITEMS = 10000

/** For each "number range": integers from `from` to `to`, both included, by `step`. A missing
 * step counts up or down toward `to`. */
export function rangeItems(from: unknown, to: unknown, step?: unknown): string[] {
	const start = Number(from)
	const end = Number(to)
	if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error('Range "from" and "to" must be whole numbers')
	const rawStep = step == null || step === '' ? (end >= start ? 1 : -1) : Number(step)
	if (!Number.isInteger(rawStep) || rawStep === 0) throw new Error('Range "step" must be a whole number, not 0')
	if ((end - start) * rawStep < 0) return []
	const count = Math.floor((end - start) / rawStep) + 1
	if (count > MAX_RANGE_ITEMS) throw new Error(`Range has ${count} items; the limit is ${MAX_RANGE_ITEMS}`)
	return Array.from({ length: count }, (_, i) => String(start + i * rawStep))
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

// ---------------------------------------------------------------------------
// WP35 Part C: For each over table rows — collecting results independently of how the list
// was split (GAPS-14: "JSON array items" used to always win over "Join with").
// ---------------------------------------------------------------------------

export type CollectMode = 'lines' | 'joined' | 'json' | 'table'

/** The collect mode an *old* saved For each behaves as (no `collect` field at all): split
 * "json" always produced a JSON array ignoring "Join with"; everything else joined with it.
 * `effectiveCollect` below applies this so an existing canvas's output never silently changes. */
export function legacyCollectMode(split: string): 'joined' | 'json' {
	return split === 'json' ? 'json' : 'joined'
}

/** A literal "\n"/"\t" typed in the "Join with" field becomes the real character. */
export function resolveJoiner(joiner: string): string {
	return joiner.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

/** Joins a loop's per-item results (nulls — an item with no result, "skip" mode — dropped) for
 * the non-table collect modes. `table` is handled by the caller (`addResultColumn` below), since
 * it needs the original table, not just this flat list. */
export function collectResults(aligned: (string | null)[], mode: 'lines' | 'joined' | 'json', joiner: string): string {
	const flat = aligned.filter((v): v is string => v != null)
	if (mode === 'json') return JSON.stringify(flat)
	if (mode === 'lines') return flat.join('\n')
	return flat.join(resolveJoiner(joiner))
}

/** Adds (or overwrites) one column to a table from a loop's per-row results, index-aligned with
 * `rows` — a missing result (`null`) becomes an empty cell, and every original row is kept (the
 * point of this mode: "row ↔ result kept, no result → empty cell"). Only as many rows as
 * `aligned` has entries for are included, so a stopped/partial loop still produces a table of
 * whatever ran so far. */
export function addResultColumn(
	headers: string[],
	rows: string[][],
	resultColumn: string,
	aligned: (string | null)[]
): { headers: string[]; rows: string[][] } {
	const name = resultColumn.trim() || 'result'
	const existingIndex = headers.indexOf(name)
	const nextHeaders = existingIndex >= 0 ? headers : [...headers, name]
	const nextRows = rows.slice(0, aligned.length).map((row, i) => {
		const cell = aligned[i] ?? ''
		if (existingIndex >= 0) {
			const copy = row.slice()
			copy[existingIndex] = cell
			return copy
		}
		return [...row, cell]
	})
	return { headers: nextHeaders, rows: nextRows }
}

/** A column name turned into a stable `row:<slug>` port id — the same slugging rule
 * `shared/decisionRoute.ts` uses for option ports, kept local so this file has no dependency on
 * that one. */
function slugColumnName(name: string): string {
	const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
	return s || 'col'
}

export interface RowColumnPort {
	id: string
	label: string
}

/** For each "table rows": one `row:<column>` output port per column, deduped (two columns that
 * slug the same get `_2`, `_3`, …), in the table's own column order. */
export function rowColumnPorts(headers: string[]): RowColumnPort[] {
	const seen = new Set<string>()
	return headers.map((label) => {
		const base = slugColumnName(label)
		let id = `row:${base}`
		let n = 2
		while (seen.has(id)) id = `row:${base}_${n++}`
		seen.add(id)
		return { id, label }
	})
}

// ---------------------------------------------------------------------------
// WP45: While — run the loop body again while a condition holds.
// ---------------------------------------------------------------------------

export const WHILE_DEFAULT_MAX = 100
/** Hard cap on While's "Max iterations", the same limit as a For each number range. */
export const WHILE_HARD_MAX = MAX_RANGE_ITEMS

/** "Max iterations" as a whole number from 1 to WHILE_HARD_MAX (default 100). */
export function clampMaxIterations(value: unknown): number {
	const n = Math.floor(Number(value))
	if (!Number.isFinite(n) || n < 1) return value == null || value === '' ? WHILE_DEFAULT_MAX : 1
	return Math.min(WHILE_HARD_MAX, n)
}

/** Why a While loop ended. */
export type WhileEnd = 'condition' | 'max' | 'no_result'

export interface WhileOutcome {
	/** The value when the loop ended: the start value, or the last body result. */
	value: string
	/** How many times the body ran. */
	count: number
	end: WhileEnd
}

export interface WhileLoopOptions {
	initial: string
	/** True while the loop should go on; tested before each pass, on the current value. */
	test: (value: string) => boolean
	max: number
	/** Runs the body once. Returns what reached "result", or null when nothing did. Throws to
	 * stop the loop with an error (a failed body card, or Stop). */
	body: (value: string, iteration: number) => Promise<string | null>
	/** What a pass with no result does: end the loop ("stop", like `break`) or fail. */
	noResult?: 'stop' | 'error'
}

/** The While loop itself, with the body injected (the card passes the shared loop-body runner),
 * so the rules are testable in Node. */
export async function runWhileLoop(options: WhileLoopOptions): Promise<WhileOutcome> {
	let value = options.initial
	let count = 0
	for (;;) {
		if (!options.test(value)) return { value, count, end: 'condition' }
		if (count >= options.max) return { value, count, end: 'max' }
		const result = await options.body(value, count + 1)
		count++
		if (result == null) {
			if (options.noResult === 'error') throw new Error(`Iteration ${count} reached no result`)
			return { value, count, end: 'no_result' }
		}
		value = result
	}
}
