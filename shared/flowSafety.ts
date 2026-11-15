/**
 * WP49: the pure parts of the flow safety cards (Try / catch, Ask user, Set / Get variable,
 * Notify). No tldraw import, so all of it is testable in Node (tests/flowSafety.test.ts).
 */

// ---------------------------------------------------------------------------
// Try / catch: retries
// ---------------------------------------------------------------------------

export const TRY_MAX_RETRIES = 5
export const TRY_DEFAULT_WAIT_SEC = 1
export const TRY_MAX_WAIT_SEC = 600

/** Retries: a whole number 0–5 (anything else is clamped; not a number: 0). */
export function clampRetries(value: unknown): number {
	const n = Math.floor(Number(value))
	if (!Number.isFinite(n) || n < 0) return 0
	return Math.min(TRY_MAX_RETRIES, n)
}

/** Wait between retries in seconds, 0–600 (not a number: the default, 1 s). */
export function clampWaitSec(value: unknown): number {
	if (value == null || value === '') return TRY_DEFAULT_WAIT_SEC
	const n = Number(value)
	if (!Number.isFinite(n)) return TRY_DEFAULT_WAIT_SEC
	return Math.max(0, Math.min(TRY_MAX_WAIT_SEC, n))
}

/** The waits (ms) before each retry: retry 1 waits after attempt 1, and so on. */
export function retryDelaysMs(retries: number, waitSec: number): number[] {
	return Array.from({ length: clampRetries(retries) }, () => Math.round(clampWaitSec(waitSec) * 1000))
}

export type AttemptOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

export interface RetryResult<T> {
	ok: boolean
	value?: T
	/** The last attempt's error, when every attempt failed. */
	error?: string
	/** How many attempts ran (1 + retries used). */
	attempts: number
}

/**
 * Run `attempt` until it succeeds or the retries are used up, waiting `waitSec` between
 * attempts. `sleep` is injected (abortable in the app, instant in tests); when it throws (Stop),
 * the error goes up to the caller unchanged.
 */
export async function runWithRetries<T>(options: {
	retries: number
	waitSec: number
	attempt: (n: number) => Promise<AttemptOutcome<T>>
	sleep: (ms: number) => Promise<void>
	/** Called before each retry (not before the first attempt). */
	onRetry?: (n: number, lastError: string) => void
}): Promise<RetryResult<T>> {
	const delays = retryDelaysMs(options.retries, options.waitSec)
	let lastError = ''
	for (let n = 1; n <= delays.length + 1; n++) {
		if (n > 1) {
			options.onRetry?.(n, lastError)
			await options.sleep(delays[n - 2])
		}
		const outcome = await options.attempt(n)
		if (outcome.ok) return { ok: true, value: outcome.value, attempts: n }
		lastError = outcome.error
	}
	return { ok: false, error: lastError, attempts: delays.length + 1 }
}

// ---------------------------------------------------------------------------
// Ask user
// ---------------------------------------------------------------------------

export const ASK_ANSWER_TYPES = [
	{ id: 'approve', label: 'Approve / reject' },
	{ id: 'choose', label: 'Choose one of options' },
	{ id: 'text', label: 'Free text' },
] as const

export type AskAnswerType = (typeof ASK_ANSWER_TYPES)[number]['id']

export function askAnswerType(value: unknown): AskAnswerType {
	return value === 'choose' || value === 'text' ? value : 'approve'
}

/** Options for "Choose one": one per line, trimmed, empty lines and repeats dropped. */
export function parseAskOptions(text: string | null | undefined): string[] {
	const seen = new Set<string>()
	const options: string[] = []
	for (const line of (text ?? '').split(/\r?\n/)) {
		const option = line.trim()
		if (!option || seen.has(option)) continue
		seen.add(option)
		options.push(option)
	}
	return options
}

/** Timeout in minutes, 0 (wait forever) to one week. */
export function clampTimeoutMin(value: unknown): number {
	const n = Number(value)
	if (!Number.isFinite(n) || n <= 0) return 0
	return Math.min(7 * 24 * 60, n)
}

/** What the user did: approve, reject, pick an option, or send text. */
export type AskReply =
	| { kind: 'approve' }
	| { kind: 'reject' }
	| { kind: 'choose'; value: string }
	| { kind: 'text'; value: string }

/**
 * The card's two outputs for one reply. `null` means STOP (the card maps it). Approve passes the
 * input on ("approved" when nothing is wired); reject sends the input (or "rejected") to
 * `rejected` only. A choice or a text goes to `answer`.
 */
export function askOutputs(reply: AskReply, input: string): { answer: string | null; rejected: string | null } {
	switch (reply.kind) {
		case 'approve':
			return { answer: input !== '' ? input : 'approved', rejected: null }
		case 'reject':
			return { answer: null, rejected: input !== '' ? input : 'rejected' }
		case 'choose':
		case 'text':
			return { answer: reply.value, rejected: null }
	}
}

/** A reply from free-form text (e.g. a wired answer or a test): checks it against the answer
 * type, and for "choose" against the options (case-insensitive). Throws with a short message. */
export function parseAskReply(type: AskAnswerType, text: string, options: string[]): AskReply {
	const value = text.trim()
	if (type === 'approve') {
		if (/^(approve|approved|yes|y|ok|true)$/i.test(value)) return { kind: 'approve' }
		if (/^(reject|rejected|no|n|false)$/i.test(value)) return { kind: 'reject' }
		throw new Error(`"${value}" is not approve or reject`)
	}
	if (/^(reject|rejected)$/i.test(value)) return { kind: 'reject' }
	if (type === 'choose') {
		const match = options.find((option) => option.toLowerCase() === value.toLowerCase())
		if (!match) throw new Error(`"${value}" is not one of the options: ${options.join(', ')}`)
		return { kind: 'choose', value: match }
	}
	return { kind: 'text', value: text }
}

/** `{{input}}` (any spacing) replaced with the input text. */
export function fillInput(template: string, input: string): string {
	return (template ?? '').replace(/\{\{\s*input\s*\}\}/g, input)
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

/** Variable names are trimmed; matching is exact (case-sensitive). */
export function variableName(value: unknown): string {
	return typeof value === 'string' ? value.trim() : ''
}

export interface VariableCardState {
	id: string
	type: string
	name: string
	/** Ran or settled (STOP) in this run. */
	settled: boolean
}

/**
 * Which Set variable cards a Get variable card must still wait for in this run: every Set of the
 * same name that has not settled yet, except the ones downstream of the Get itself (they need
 * its value first, so waiting for them would deadlock).
 */
export function pendingSetters(getter: { id: string; name: string }, cards: VariableCardState[], downstreamOfGetter: Set<string>): string[] {
	const name = variableName(getter.name)
	if (!name) return []
	return cards
		.filter((card) => card.type === 'set_variable' && card.id !== getter.id && variableName(card.name) === name)
		.filter((card) => !card.settled && !downstreamOfGetter.has(card.id))
		.map((card) => card.id)
}

/** Variables as stored in the document meta: only string values survive. */
export function readVariables(meta: unknown): Record<string, string> {
	const raw = meta && typeof meta === 'object' ? (meta as Record<string, unknown>).variables : undefined
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
	const out: Record<string, string> = {}
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value === 'string') out[key] = value
	}
	return out
}

/** A short one-line preview of a value for lists and toasts. */
export function previewValue(value: string, max = 60): string {
	const one = value.replace(/\s+/g, ' ').trim()
	return one.length > max ? one.slice(0, max - 1) + '…' : one
}
