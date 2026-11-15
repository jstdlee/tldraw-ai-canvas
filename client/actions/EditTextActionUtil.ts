import { TLShapeId } from 'tldraw'
import { EditTextAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { getShapesScope, startTask } from '../agent/agentTasks'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

/** WP48: the agent's `edit-text` action: new wording in place, shown as a preview. */
export const EditTextActionUtil = registerActionUtil(
	class EditTextActionUtil extends AgentActionUtil<EditTextAction> {
		static override type = 'edit-text' as const

		override getInfo(action: Streaming<EditTextAction>) {
			return {
				icon: 'pencil' as const,
				description: action.instruction ? `Rewriting text: ${action.instruction}` : 'Rewriting text…',
				canGroup: () => false,
			}
		}

		override sanitizeAction(action: Streaming<EditTextAction>, helpers: AgentHelpers) {
			if (!action.complete) return action
			const ids = helpers.ensureShapeIdsExist(action.shapeIds ?? [])
			if (!ids.length) return null
			action.shapeIds = ids
			return action
		}

		override applyAction(action: Streaming<EditTextAction>) {
			if (!action.complete || !action.instruction?.trim() || !action.shapeIds?.length) return
			const ids = action.shapeIds.map((id) => `shape:${id}` as TLShapeId)
			const instruction = action.instruction.trim()
			const scope = getShapesScope(this.editor, ids)
			queueMicrotask(() => {
				startTask(this.agent, { route: 'edit-text', label: `Edit text: ${instruction}`, text: instruction }, scope, { withPrompt: false })
			})
		}
	}
)
