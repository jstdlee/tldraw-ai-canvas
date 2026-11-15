import { AskUserAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { pushQuestion } from '../agent/agentTasks'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

/**
 * WP48: the agent's one clarifying question. It shows in the thread (and in the AI bar, if open)
 * with its options as chips; a chip or typed words answer it in a new turn.
 */
export const AskUserActionUtil = registerActionUtil(
	class AskUserActionUtil extends AgentActionUtil<AskUserAction> {
		static override type = 'ask-user' as const

		override getInfo() {
			// The question task shows it; the action itself has no row of its own.
			return null
		}

		override applyAction(action: Streaming<AskUserAction>) {
			if (!action.complete || !action.question?.trim()) return
			const question = action.question.trim()
			const options = Array.isArray(action.options) ? action.options.filter((o): o is string => typeof o === 'string') : []
			queueMicrotask(() => pushQuestion(this.agent, question, options))
		}
	}
)
