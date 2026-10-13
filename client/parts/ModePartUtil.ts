import { ModePart } from '../../shared/schema/PromptPartDefinitions'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { firstConfiguredSearchProvider, loadSearchProviders } from '../ai/aiConfig'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const ModePartUtil = registerPromptPartUtil(
	class ModePartUtil extends PromptPartUtil<ModePart> {
		static override type = 'mode' as const

		override getPart(_request: AgentRequest): ModePart {
			const modeDefinition = this.agent.mode.getCurrentModeDefinition()

			if (!modeDefinition.active) {
				throw new Error(`Cannot get mode part for inactive mode: ${modeDefinition.type}`)
			}

			// WP31 Part E: the agent only gets a `web-search` action when a search provider
			// (Exa/Tavily/Brave) is configured. Kick off the (cached) load and, until it
			// resolves, leave the action out rather than offer one that would fail.
			loadSearchProviders()
			const searchConfigured = !!firstConfiguredSearchProvider()
			const actionTypes = searchConfigured
				? modeDefinition.actions
				: modeDefinition.actions.filter((type) => type !== 'web-search')

			return {
				type: 'mode',
				modeType: modeDefinition.type,
				partTypes: modeDefinition.parts,
				actionTypes,
			}
		}
	}
)
