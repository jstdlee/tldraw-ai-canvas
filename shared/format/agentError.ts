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

/** Extract a short, human message from whatever an agent request threw. */
export function getAgentErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message
	if (typeof error === 'string' && error) return error
	return 'Something went wrong and the agent could not reply. Try again, or pick a different model.'
}
