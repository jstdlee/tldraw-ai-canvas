import { ChatHistoryErrorItem } from '../../../shared/types/ChatHistoryItem'

/**
 * WP28 Part A: shown when a request failed before the model produced any
 * action, so the chat thread always has a visible reply to the user's
 * message instead of silence.
 */
export function ChatHistoryError({ item }: { item: ChatHistoryErrorItem }) {
	return (
		<div className="chat-history-error" role="alert">
			<span className="chat-history-error-text">{item.message}</span>
		</div>
	)
}
