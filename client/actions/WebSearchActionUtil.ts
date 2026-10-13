/**
 * WP31 Part E: the canvas agent's `web-search` action. Only offered when a search provider
 * is configured (see `client/modes/AgentModeDefinitions.ts`'s filter on `$searchConfig`).
 * Runs the search once the action is complete, and posts a compact "message" chat item with
 * the results — the agent sees it on its next turn the same way it sees its own messages.
 */
import { WebSearchAction } from '../../shared/schema/AgentActionSchemas'
import { formatSearchMarkdown } from '../../shared/search'
import { Streaming } from '../../shared/types/Streaming'
import { firstConfiguredSearchProvider } from '../ai/aiConfig'
import { apiSearch } from '../pipeline/api/pipelineApi'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

export const WebSearchActionUtil = registerActionUtil(
	class WebSearchActionUtil extends AgentActionUtil<WebSearchAction> {
		static override type = 'web-search' as const

		override getInfo(action: Streaming<WebSearchAction>) {
			return {
				description: action.query ? `Searching the web: "${action.query}"` : 'Searching the web…',
				canGroup: () => false,
			}
		}

		override async applyAction(action: Streaming<WebSearchAction>) {
			if (!action.complete || !action.query?.trim()) return
			const provider = firstConfiguredSearchProvider()
			if (!provider) return
			try {
				const result = await apiSearch({ provider, query: action.query, count: 5 })
				const markdown = formatSearchMarkdown(result.results) || '(no results)'
				this.agent.chat.push({
					type: 'action',
					action: { _type: 'message', text: `Web search results for "${action.query}":\n\n${markdown}`, complete: true, time: 0 },
					diff: { added: {}, updated: {}, removed: {} },
					acceptance: 'accepted',
				})
			} catch (e) {
				this.agent.chat.push({
					type: 'action',
					action: { _type: 'message', text: `Web search failed: ${(e as Error).message}`, complete: true, time: 0 },
					diff: { added: {}, updated: {}, removed: {} },
					acceptance: 'accepted',
				})
			}
		}
	}
)
