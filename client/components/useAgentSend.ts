import { useCallback, useState } from 'react'
import { useValue } from 'tldraw'
import type { AgentTaskRequest } from '../../shared/agentRouting'
import {
	applyAllPreviews,
	discardAllPreviews,
	getEditorScope,
	getOpenPreviews,
	getTask,
	runAgentRequest,
	RunResult,
} from '../agent/agentTasks'
import { $adjustTarget } from '../agent/aiBarState'
import { useAgent } from '../agent/TldrawAgentAppProvider'

export type SendResult = RunResult | { status: 'confirm' }

/**
 * WP48: how the AI bar and the dock send a request. Only one preview at a time: with a change
 * still waiting, a new request first asks "Apply the current change first?" (Apply / Discard).
 * Adjust (a preview task in `$adjustTarget`) makes the next free text revise that preview.
 */
export function useAgentSend() {
	const agent = useAgent()
	const [confirm, setConfirm] = useState<AgentTaskRequest | null>(null)
	const adjustId = useValue('ai adjust target', () => $adjustTarget.get(), [])
	const adjustTask = useValue(
		'ai adjust task',
		() => {
			const task = adjustId ? getTask(agent, adjustId) : null
			return task?.status === 'preview' ? { id: task.id, label: task.label } : null
		},
		[agent, adjustId]
	)

	const run = useCallback(
		(request: AgentTaskRequest): RunResult => {
			const adjust = !('action' in request) ? $adjustTarget.get() : null
			if (adjust) $adjustTarget.set(null)
			return runAgentRequest(agent, getEditorScope(agent.editor), request, { adjust })
		},
		[agent]
	)

	const send = useCallback(
		(request: AgentTaskRequest): SendResult => {
			const adjust = !('action' in request) ? $adjustTarget.get() : null
			const waiting = getOpenPreviews(agent).filter((task) => task.id !== adjust)
			if (waiting.length && !adjust) {
				setConfirm(request)
				return { status: 'confirm' }
			}
			return run(request)
		},
		[agent, run]
	)

	/** The answer to "Apply the current change first?": then the held request runs. */
	const resolveConfirm = useCallback(
		(choice: 'apply' | 'discard' | 'cancel'): SendResult | null => {
			const request = confirm
			setConfirm(null)
			if (!request || choice === 'cancel') return null
			if (choice === 'apply') applyAllPreviews(agent)
			else discardAllPreviews(agent)
			return run(request)
		},
		[agent, confirm, run]
	)

	return { send, confirm, resolveConfirm, adjustTask, cancelAdjust: () => $adjustTarget.set(null) }
}
