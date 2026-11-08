import { JsonValue, RecordsDiff, TLRecord } from 'tldraw'
import { FocusedShape } from '../format/FocusedShape'
import { AgentAction } from './AgentAction'
import { AgentRequestSource } from './AgentRequest'
import { ContextItem } from './ContextItem'
import { Streaming } from './Streaming'

export type ChatHistoryItem =
	| ChatHistoryActionItem
	| ChatHistoryPromptItem
	| ChatHistoryContinuationItem
	| ChatHistoryErrorItem
	| ChatHistoryTaskItem

/**
 * A prompt from a user, another agent, or the agent itself.
 */
export interface ChatHistoryPromptItem {
	type: 'prompt'
	promptSource: AgentRequestSource
	agentFacingMessage: string
	userFacingMessage: string | null
	contextItems: ContextItem[]
	selectedShapes: FocusedShape[]
}

/**
 * An action done by the agent.
 */
export interface ChatHistoryActionItem {
	type: 'action'
	action: Streaming<AgentAction>
	diff: RecordsDiff<TLRecord>
	acceptance: 'pending' | 'accepted' | 'rejected'
}

/**
 * A follow-up request from the agent, with data retrieved from the previous request.
 */
export interface ChatHistoryContinuationItem {
	type: 'continuation'
	data: JsonValue[]
}

/**
 * WP28 Part A: a request that failed before the model produced any action
 * (a dead model id, a provider that refused the request, an empty or
 * non-JSON reply, or a network error). Without this, a failed request left
 * the user's prompt bubble with nothing after it — "no proper reply" — because
 * the error only ever reached a toast, not the chat thread.
 */
export interface ChatHistoryErrorItem {
	type: 'error'
	message: string
}

/**
 * WP44: a task the agent panel ran outside the drawing agent (a text job, a build plan, a card
 * assist, a rewrite…). Pushed after a `prompt` item and updated by `id` as it runs; it persists
 * with the chat. The drawing agent sees it as one short text line (`taskHistoryLine`).
 */
export interface ChatHistoryTaskItem {
	type: 'task'
	id: string
	route: string // 'text-job' | 'build' | 'node-assist' | …
	label: string // "Summarize", "Build: Load sales.xlsx…"
	scopeLabel: string // frozen from the scope at send time
	scopeIds: string[]
	status: 'running' | 'done' | 'error' | 'applied' | 'discarded'
	text?: string // reply text or the result text placed on the canvas
	placedIds?: string[] // shapes the task added to the canvas
	plan?: unknown // AiPlan for build
	warnings?: string[]
	assist?: unknown // NodeAssistResult for node-assist
	error?: string
	/** build: the goal the plan was made for (a revision builds on it). */
	goal?: string
	/** The request that started the task, so Retry can run it again. */
	request?: unknown
}
