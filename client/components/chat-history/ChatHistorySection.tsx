import { SmallSpinner } from '../../../shared/icons/SmallSpinner'
import {
	ChatHistoryActionItem,
	ChatHistoryContinuationItem,
	ChatHistoryErrorItem,
	ChatHistoryItem,
	ChatHistoryPromptItem,
} from '../../../shared/types/ChatHistoryItem'
import { useAgent } from '../../agent/TldrawAgentAppProvider'
import { ChatHistoryError } from './ChatHistoryError'
import { ChatHistoryGroup, getActionHistoryGroups } from './ChatHistoryGroup'
import { ChatHistoryPrompt } from './ChatHistoryPrompt'

export interface ChatHistorySection {
	prompt: ChatHistoryPromptItem
	items: (ChatHistoryActionItem | ChatHistoryContinuationItem | ChatHistoryErrorItem)[]
}

export function ChatHistorySection({
	section,
	loading,
	id,
}: {
	section: ChatHistorySection
	loading: boolean
	/** WP28 Part C: lets the header's History popover scroll a past prompt into view. */
	id?: string
}) {
	const agent = useAgent()
	const actions = section.items.filter((item) => item.type === 'action')
	const errors = section.items.filter((item) => item.type === 'error')
	const groups = getActionHistoryGroups(actions, agent)
	return (
		<div className="chat-history-section" id={id}>
			<ChatHistoryPrompt item={section.prompt} editor={agent.editor} />
			{groups.map((group, i) => {
				return <ChatHistoryGroup key={'chat-history-group-' + i} group={group} />
			})}
			{errors.map((item, i) => (
				<ChatHistoryError key={'chat-history-error-' + i} item={item} />
			))}
			{loading && (
				<div className="chat-history-thinking">
					<SmallSpinner />
					<span>Thinking…</span>
				</div>
			)}
		</div>
	)
}

export function getAgentHistorySections(items: ChatHistoryItem[]): ChatHistorySection[] {
	const sections: ChatHistorySection[] = []

	for (const item of items) {
		if (item.type === 'prompt') {
			// Filter out 'self' prompts from the UI
			if (item.promptSource === 'self') continue
			sections.push({ prompt: item, items: [] })
			continue
		}

		// Only add to the last section if one exists
		if (sections.length > 0) {
			sections[sections.length - 1].items.push(item)
		}
	}

	return sections
}
