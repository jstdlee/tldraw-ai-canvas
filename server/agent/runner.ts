/**
 * WP31 Part C: runs one agent task with `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`,
 * yielding `AgentRunEvent`s the route turns into SSE. Stops after `maxSteps` turns or
 * `MAX_RUN_MS`, whichever comes first, and honours the request's abort signal throughout.
 */

import { Agent, type AgentEvent } from '@mariozechner/pi-agent-core'
import type { AssistantMessage, Model, ToolResultMessage } from '@mariozechner/pi-ai'
import { SkillInfo } from '../../shared/skills'
import { AgentStepSummary, AgentRunEvent, clampMaxSteps } from './types'

const ARG_PREVIEW_MAX = 200
const RESULT_PREVIEW_MAX = 400

function preview(value: unknown, max: number): string {
	const text = typeof value === 'string' ? value : JSON.stringify(value)
	if (!text) return ''
	return text.length > max ? text.slice(0, max) + '…' : text
}

function textOf(message: AssistantMessage | undefined): string {
	if (!message) return ''
	return message.content
		.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
		.map((b) => b.text)
		.join('')
}

export interface RunAgentOptions {
	model: Model<any>
	apiKey?: string
	systemPrompt: string
	task: string
	context?: string
	tools: import('@mariozechner/pi-agent-core').AgentTool<any>[]
	maxSteps?: number
	signal?: AbortSignal
	maxRunMs: number
}

/** Known-skill note appended once per run so the model knows it can ask for more detail. */
export function appendSkillsHint(systemPrompt: string, skills: SkillInfo[]): string {
	if (skills.length === 0) return systemPrompt
	return systemPrompt
}

export async function* runAgent(opts: RunAgentOptions): AsyncGenerator<AgentRunEvent> {
	const maxSteps = clampMaxSteps(opts.maxSteps)
	const steps: AgentStepSummary[] = []
	let step = 0
	let turns = 0
	let stepStartedAt = Date.now()
	let stoppedReason: 'steps' | 'time' | 'external' | null = null

	const agent = new Agent({
		initialState: { systemPrompt: opts.systemPrompt, model: opts.model, tools: opts.tools },
		getApiKey: () => opts.apiKey,
	})

	const hardTimer = setTimeout(() => {
		stoppedReason = stoppedReason ?? 'time'
		agent.abort()
	}, opts.maxRunMs)
	hardTimer.unref?.()
	const onExternalAbort = () => {
		stoppedReason = stoppedReason ?? 'external'
		agent.abort()
	}
	opts.signal?.addEventListener('abort', onExternalAbort, { once: true })
	if (opts.signal?.aborted) onExternalAbort()

	// Collects events from the agent's own subscribe() callback onto a queue this generator
	// drains, so the generator can `yield` them in order (subscribe() itself can't yield).
	const queue: AgentRunEvent[] = []
	let resolveNext: (() => void) | null = null
	const push = (event: AgentRunEvent) => {
		queue.push(event)
		resolveNext?.()
		resolveNext = null
	}

	let finished = false
	let finalText = ''
	// GAPS-04: distinguishes a genuine provider/model error from the "Request was aborted"
	// (or similarly worded) noise that `agent.state.errorMessage` picks up when WE cancel an
	// in-flight request ourselves to enforce maxSteps/maxRunMs — that's expected, not an error
	// to surface. `AssistantMessage.stopReason` says which one it was for the last message.
	let lastStopReason: string | undefined

	const unsubscribe = agent.subscribe(async (event: AgentEvent) => {
		if (event.type === 'turn_start') {
			step++
			stepStartedAt = Date.now()
			push({ type: 'step_start', step })
		} else if (event.type === 'tool_execution_start') {
			push({ type: 'tool_call', step, toolCallId: event.toolCallId, name: event.toolName, argsPreview: preview(event.args, ARG_PREVIEW_MAX) })
		} else if (event.type === 'tool_execution_end') {
			const resultText =
				Array.isArray(event.result?.content) &&
				event.result.content.map((b: { type: string; text?: string }) => (b.type === 'text' ? b.text : '')).join('\n')
			const resultPreview = preview(resultText || event.result, RESULT_PREVIEW_MAX)
			push({ type: 'tool_result', step, toolCallId: event.toolCallId, name: event.toolName, resultPreview, isError: !!event.isError })
			steps.push({ step, kind: 'tool_call', name: event.toolName, resultPreview, isError: !!event.isError, ms: Date.now() - stepStartedAt })
		} else if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
			push({ type: 'text_delta', step, delta: event.assistantMessageEvent.delta })
		} else if (event.type === 'message_end' && event.message.role === 'assistant') {
			const message = event.message as AssistantMessage
			lastStopReason = message.stopReason
			const text = textOf(message)
			if (text) {
				finalText = text
				steps.push({ step, kind: 'text', text, ms: Date.now() - stepStartedAt })
			}
		} else if (event.type === 'turn_end') {
			turns++
			if (turns >= maxSteps) {
				stoppedReason = stoppedReason ?? 'steps'
				agent.abort()
			}
		} else if (event.type === 'agent_end') {
			finished = true
			resolveNext?.()
			resolveNext = null
		}
	})

	const promptMessage = opts.context ? `${opts.task}\n\nContext:\n${opts.context}` : opts.task
	const runPromise = agent.prompt(promptMessage).catch(() => {
		// Surfaced via agent.state.errorMessage below; agent_end still fires.
	})

	try {
		while (!finished || queue.length > 0) {
			if (queue.length === 0) {
				await new Promise<void>((resolve) => {
					resolveNext = resolve
				})
				continue
			}
			yield queue.shift()!
		}
		await runPromise
		if (stoppedReason === 'external') {
			yield { type: 'error', message: 'Stopped', steps }
			return
		}
		// GAPS-04: a step-limit/time-limit stop used to skip straight to the "(no answer)"
		// success path, hiding whatever error the last allowed step actually hit. Report it
		// first, whatever stopped the run — but not when the "error" is just our own abort
		// (enforcing maxSteps/maxRunMs) cutting off an in-flight request; that's expected.
		if (agent.state.errorMessage && lastStopReason !== 'aborted') {
			yield { type: 'error', message: agent.state.errorMessage, steps }
			return
		}
		if (stoppedReason === 'steps' || stoppedReason === 'time') {
			// No error, but also no answer: this is not a successful run — downstream cards
			// must not treat "(no answer)" as real data.
			if (!finalText) {
				const limit = stoppedReason === 'steps' ? `the step limit (${maxSteps})` : 'the time limit'
				yield { type: 'error', message: `Agent hit ${limit} before it answered.`, steps }
				return
			}
			const note = stoppedReason === 'steps' ? '\n\n(Stopped: reached the step limit.)' : '\n\n(Stopped: reached the time limit.)'
			yield { type: 'final', output: finalText + note, steps }
			return
		}
		yield { type: 'final', output: finalText || '(no answer)', steps }
	} finally {
		clearTimeout(hardTimer)
		opts.signal?.removeEventListener('abort', onExternalAbort)
		unsubscribe()
	}
}

export type { ToolResultMessage }
