import { BuildWorkflowAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { getEditorScope, startTask } from '../agent/agentTasks'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

/**
 * WP44: the drawing agent's `build-workflow` action. A free-text request for a pipeline
 * ("load sales.xlsx and chart it") becomes cards: it runs Build with AI for the goal and adds
 * a `build` task to the thread, with the plan for the user to Apply (it is never applied here).
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
