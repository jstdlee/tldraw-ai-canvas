/**
 * WP31 Part C: request/event shapes for `POST /api/agent/run`. Events are sent as SSE
 * (`data: <json>\n\n`), one event per line, ending with a `final` or `error` event.
 */

import { SearchProviderId } from '../../shared/search'

export interface AgentRunRequest {
	task: string
	/** Optional extra context (wired input, e.g. upstream node output). */
	context?: string
	/** A configured model key ("providerId/model"), an ad-hoc ref, or empty for the default agent model. */
	model?: string
	search?: SearchProviderId[]
	mcpServers?: string[]
	skills?: string[]
	systemPrompt?: string
	maxSteps?: number
}

export type AgentRunEvent =
	| { type: 'step_start'; step: number }
	| { type: 'tool_call'; step: number; toolCallId: string; name: string; argsPreview: string }
	| { type: 'tool_result'; step: number; toolCallId: string; name: string; resultPreview: string; isError: boolean }
	| { type: 'text_delta'; step: number; delta: string }
	| { type: 'final'; output: string; steps: AgentStepSummary[] }
	| { type: 'error'; message: string; steps: AgentStepSummary[] }

/** One row of the transcript the card stores in `stepsJson` (for the compact step list). */
export interface AgentStepSummary {
	step: number
	kind: 'tool_call' | 'text'
	name?: string
	argsPreview?: string
	resultPreview?: string
	isError?: boolean
	text?: string
	ms: number
}

export const DEFAULT_MAX_STEPS = 12
export const MAX_MAX_STEPS = 40
/** Hard wall-clock cap for one run, regardless of `maxSteps` (minutes). */
export const MAX_RUN_MS = 10 * 60_000

export function clampMaxSteps(n: number | undefined): number {
	const v = Math.round(n ?? DEFAULT_MAX_STEPS)
	return Math.min(MAX_MAX_STEPS, Math.max(1, Number.isFinite(v) ? v : DEFAULT_MAX_STEPS))
}
