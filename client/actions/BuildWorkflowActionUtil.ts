import { BuildWorkflowAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { getEditorScope, startTask } from '../agent/agentTasks'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

/**
 * WP44/WP48: the agent's `build-workflow` action. A request for cards ("load sales.xlsx and
 * chart it", "wire these up") runs Build with AI for the goal and adds a `build` task to the
 * thread; its plan is placed on the canvas as a preview (ghost cards and wires) to Apply.
 */
export const BuildWorkflowActionUtil = registerActionUtil(
	class BuildWorkflowActionUtil extends AgentActionUtil<BuildWorkflowAction> {
		static override type = 'build-workflow' as const

		override getInfo(action: Streaming<BuildWorkflowAction>) {
			return {
				description: action.goal ? `Planning a workflow: ${action.goal}` : 'Planning a workflow…',
				canGroup: () => false,
			}
		}

		override applyAction(action: Streaming<BuildWorkflowAction>) {
			if (!action.complete || !action.goal?.trim()) return
			const goal = action.goal.trim()
			const scope = getEditorScope(this.editor)
			// After the agent has added this action to the thread, so the plan shows below it.
			// Not awaited: the agent's turn ends now; the task shows its own progress.
			queueMicrotask(() => {
				startTask(this.agent, { route: 'build', label: `Build: ${goal}`, text: goal }, scope, { goal, withPrompt: false })
			})
		}
	}
)
