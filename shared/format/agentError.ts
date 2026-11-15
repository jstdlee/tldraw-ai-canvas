import { ChatHistoryErrorItem } from '../types/ChatHistoryItem'

/**
 * WP28 Part A: turn whatever a failed agent request threw into a chat
 * history item, so the chat thread shows *something* instead of leaving the
 * user's message with no reply at all. Pure and framework-free so it's easy
 * to unit test in Node.
 */
export function createAgentErrorHistoryItem(error: unknown): ChatHistoryErrorItem {
	return { type: 'error', message: getAgentErrorMessage(error) }
}

const FALLBACK = 'Something went wrong and the agent could not reply. Try again, or pick a different model.'

/**
 * WP48 bug 2: the readable text of any error value. Providers throw plain objects
 * (`{ error: { message } }`, `{ message, code }`, …); `String()` on those gives
 * "[object Object]". Returns '' when there is no text at all.
 */
export function errorText(error: unknown, depth = 0): string {
	if (error == null || depth > 4) return ''
	if (typeof error === 'string') return error === '[object Object]' ? '' : error
	if (typeof error === 'number' || typeof error === 'boolean') return String(error)
	if (typeof error !== 'object') return ''
	const record = error as Record<string, unknown>
	for (const key of ['message', 'error', 'detail', 'reason', 'statusText', 'cause']) {
		const text = errorText(record[key], depth + 1)
		if (text) return text
	}
	if (typeof record.responseBody === 'string' && record.responseBody.trim()) return record.responseBody.trim().slice(0, 300)
	if (error instanceof Error) return ''
	try {
		const json = JSON.stringify(error)
		return json && json !== '{}' ? json.slice(0, 300) : ''
	} catch {
		return ''
	}
}

/** Extract a short, human message from whatever an agent request threw. */
export function getAgentErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message && error.message !== '[object Object]') return error.message
	if (typeof error === 'string' && error) return error
	if (error && typeof error === 'object' && !(error instanceof Error)) {
		const record = error as Record<string, unknown>
		// Only the shapes providers really use; an unknown object gets the generic message.
		const text = errorText(record.message) || errorText(record.error)
		if (text) return text
	}
	return FALLBACK
}
