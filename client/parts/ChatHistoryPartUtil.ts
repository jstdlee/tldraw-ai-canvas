import { structuredClone } from 'tldraw'
import { ChatHistoryPart } from '../../shared/schema/PromptPartDefinitions'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { AgentHelpers } from '../AgentHelpers'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const ChatHistoryPartUtil = registerPromptPartUtil(
	class ChatHistoryPartUtil extends PromptPartUtil<ChatHistoryPart> {
		static override type = 'chatHistory' as const

		override async getPart(_request: AgentRequest, helpers: AgentHelpers) {
			// WP44: a task item keeps only what its one history line needs (no plan / assist objects).
			const history = structuredClone(this.agent.chat.getHistory()).map((item) =>
				item.type === 'task'
					? {
							type: 'task' as const,
							id: item.id,
							route: item.route,
							label: item.label,
							scopeLabel: item.scopeLabel,
							scopeIds: [],
							status: item.status,
							text: item.text?.slice(0, 300),
							error: item.error,
						}
					: item
			)

			for (const historyItem of history) {
				if (historyItem.type !== 'prompt') continue

				// Offset and round the context items of each history item
				const contextItems = historyItem.contextItems.map((contextItem) => {
					const offsetContextItem = helpers.applyOffsetToContextItem(contextItem)
					return helpers.roundContextItem(offsetContextItem)
				})

				historyItem.contextItems = contextItems
			}

			return {
				type: 'chatHistory' as const,
				history,
			}
		}
	}
)
