import { TLShapeId } from 'tldraw'
import { FillCardAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { getShapesScope, startTask } from '../agent/agentTasks'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

/**
 * WP48: the agent's `fill-card` action. The card's own specialist (runNodeAssist) sets its
 * fields; the change shows as a preview in a task below the agent's turn.
 */
export const FillCardActionUtil = registerActionUtil(
	class FillCardActionUtil extends AgentActionUtil<FillCardAction> {
		static override type = 'fill-card' as const

		override getInfo(action: Streaming<FillCardAction>) {
			return {
				icon: 'pencil' as const,
				description: action.request ? `Setting up a card: ${action.request}` : 'Setting up a card…',
				canGroup: () => false,
			}
		}

		override sanitizeAction(action: Streaming<FillCardAction>, helpers: AgentHelpers) {
			if (!action.complete) return action
			const id = helpers.ensureShapeIdExists(action.cardId)
			if (!id) return null
			const shape = this.editor.getShape(`shape:${id}` as TLShapeId)
			if (shape?.type !== 'node') return null
			action.cardId = id
			return action
		}

		override applyAction(action: Streaming<FillCardAction>) {
			if (!action.complete || !action.request?.trim()) return
			const cardId = `shape:${action.cardId}` as TLShapeId
			const request = action.request.trim()
			const scope = getShapesScope(this.editor, [cardId])
			// After the agent has added this action to the thread, so the task shows below it.
			queueMicrotask(() => {
				startTask(this.agent, { route: 'node-assist', label: `Fill: ${request}`, text: request }, scope, { withPrompt: false })
			})
		}
	}
)
