/**
 * WP44: the agent panel's routing. One input, many AI features: a quick action chip or free
 * text, read against the scope (what is selected), picks the route that runs the task. Pure
 * so it can be unit-tested (tests/agentRouting.test.ts).
 */

import type { AgentScope } from './agentScope'

export type AgentRouteId =
	| 'text-job'
	| 'image-job'
	| 'explain'
	| 'rewrite'
	| 'list-format'
	| 'send-to-pipeline'
	| 'node-assist'
	| 'build'
	| 'agent'

export type QuickActionId =
	// canvas
	| 'draw-flowchart'
	| 'build-workflow'
	| 'what-can-you-do'
	// card
	| 'card-chip'
	| 'explain-card'
	| 'fix-error'
	// cards
	| 'wire-up'
	| 'explain-flow'
	// text
	| 'summarize'
	| 'translate'
	| 'improve'
	| 'brainstorm'
	| 'rewrite'
	| 'checklist'
	// image
	| 'describe'
	| 'ocr'
	| 'send-to-pipeline'
	// mixed
	| 'explain'

/** A request to the panel: a quick action (with its one extra answer, if it needs one) or free text. */
export type AgentTaskRequest = { action: QuickActionId; text?: string; label?: string } | { text: string }

export type TextJob = 'summarize' | 'translate' | 'improve' | 'brainstorm'
export type ImageJob = 'describe' | 'ocr'

export interface AgentRoute {
	route: AgentRouteId
	/** What the user sees in the thread: the chip label, or the user's own words. */
	label: string
	/** The words the route works with: agent message, build goal, assist request, language, rewrite instructions. */
	text: string
	job?: TextJob | ImageJob
	/** build only: revise the last plan instead of starting a new one. */
	revision?: boolean
}

/** The last task in the thread, when no message was sent after it. */
export interface LastTaskInfo {
	route: string
	status: string
}

export interface QuickAction {
	id: QuickActionId
	label: string
	/** card-chip only: the chip text the card's specialist gets. */
	text?: string
	/** The chip needs one more answer before it runs. 'input': prefill the input; 'sheet': open a sheet. */
	needs?: 'input' | 'sheet'
	/** The input's prefill and placeholder when `needs` is 'input'. */
	prefill?: string
	placeholder?: string
}

const QUICK: Record<Exclude<QuickActionId, 'card-chip'>, QuickAction> = {
	'draw-flowchart': { id: 'draw-flowchart', label: 'Draw a flowchart' },
	'build-workflow': {
		id: 'build-workflow',
		label: 'Build a workflow',
		needs: 'input',
		prefill: '',
		placeholder: 'What should the workflow do? e.g. load sales.xlsx and chart it',
	},
	'what-can-you-do': { id: 'what-can-you-do', label: 'What can you do?' },
	'explain-card': { id: 'explain-card', label: 'Explain this card' },
	'fix-error': { id: 'fix-error', label: 'Fix error' },
	'wire-up': { id: 'wire-up', label: 'Wire these up' },
	'explain-flow': { id: 'explain-flow', label: 'Explain this flow' },
	summarize: { id: 'summarize', label: 'Summarize' },
	translate: { id: 'translate', label: 'Translate…', needs: 'input', prefill: 'English', placeholder: 'Translate into which language?' },
	improve: { id: 'improve', label: 'Improve writing' },
	brainstorm: { id: 'brainstorm', label: 'Brainstorm' },
	rewrite: { id: 'rewrite', label: 'Rewrite…', needs: 'sheet' },
	checklist: { id: 'checklist', label: 'Make a checklist' },
	describe: { id: 'describe', label: 'Describe' },
	ocr: { id: 'ocr', label: 'Extract text' },
	'send-to-pipeline': { id: 'send-to-pipeline', label: 'Send to pipeline' },
	explain: { id: 'explain', label: 'Explain' },
}

export function quickAction(id: QuickActionId): QuickAction {
	return id === 'card-chip' ? { id, label: 'Ask this card' } : QUICK[id]
}

/** The quick action chips for a scope. `card` describes the one selected card (scope 'card'). */
export function getQuickActions(scope: Pick<AgentScope, 'kind'>, card?: { chips: string[]; hasError: boolean }): QuickAction[] {
	switch (scope.kind) {
		case 'canvas':
			return [QUICK['draw-flowchart'], QUICK['build-workflow'], QUICK['what-can-you-do']]
		case 'card': {
			const chips: QuickAction[] = (card?.chips ?? []).map((chip) => {
				// "Find and replace…" asks for more: put it in the input instead of running it.
				const more = chip.endsWith('…')
				return {
					id: 'card-chip' as const,
					label: chip,
					text: chip,
					...(more ? { needs: 'input' as const, prefill: chip.slice(0, -1).trimEnd() + ' ' } : {}),
				}
			})
			return [...(card?.hasError ? [QUICK['fix-error']] : []), ...chips, QUICK['explain-card']]
		}
		case 'cards':
			return [QUICK['wire-up'], QUICK['explain-flow']]
		case 'text':
			return [QUICK.summarize, QUICK.translate, QUICK.improve, QUICK.brainstorm, QUICK.rewrite, QUICK.checklist]
		case 'image':
			return [QUICK.describe, QUICK.ocr, QUICK['send-to-pipeline']]
		case 'mixed':
			return [QUICK.explain, QUICK.summarize]
	}
}

const AGENT_MESSAGES: Partial<Record<QuickActionId, string>> = {
	'draw-flowchart': 'Draw a simple flowchart with 3 steps',
	'what-can-you-do': 'What can you help me with here?',
}

const WIRE_UP_GOAL = 'Wire these cards up and fill in their settings so they work together as one workflow.'

/**
 * Pick the route for a request. Returns null when a quick action still needs its one extra
 * answer (Translate… without a language, Rewrite… without instructions, Build a workflow
 * without a goal): the panel then asks for it (prefilled input or a sheet).
 */
export function routeAgentTask(
	scope: Pick<AgentScope, 'kind'>,
	request: AgentTaskRequest,
	context: { lastTask?: LastTaskInfo | null } = {}
): AgentRoute | null {
	if ('action' in request) {
		const action = request.action
		const extra = request.text?.trim() ?? ''
		const label = action === 'card-chip' ? extra || 'Ask this card' : quickAction(action).label
		switch (action) {
			case 'draw-flowchart':
			case 'what-can-you-do':
				return { route: 'agent', label, text: AGENT_MESSAGES[action]! }
			case 'build-workflow':
				return extra ? { route: 'build', label: `Build: ${extra}`, text: extra } : null
			case 'wire-up':
				return { route: 'build', label, text: extra || WIRE_UP_GOAL }
			case 'card-chip':
				return extra ? { route: 'node-assist', label, text: extra } : null
			case 'fix-error':
				return { route: 'node-assist', label, text: extra ? `Fix this error: ${extra}` : 'Fix the error this card shows.' }
			case 'explain-card':
			case 'explain-flow':
			case 'explain':
				return { route: 'explain', label, text: '' }
			case 'summarize':
			case 'improve':
			case 'brainstorm':
				return { route: 'text-job', label, text: '', job: action }
			case 'translate':
				return extra ? { route: 'text-job', label: `Translate → ${extra}`, text: extra, job: 'translate' } : null
			case 'rewrite':
				// `label` is the rewrite's short name (preset labels), also used on the variant's arrow.
				return extra ? { route: 'rewrite', label: request.label?.trim() || 'Rewrite', text: extra } : null
			case 'checklist':
				return { route: 'list-format', label, text: '' }
			case 'describe':
			case 'ocr':
				return { route: 'image-job', label, text: '', job: action }
			case 'send-to-pipeline':
				return { route: 'send-to-pipeline', label, text: '' }
		}
	}

	const text = request.text.trim()
	if (!text) return null
	// A plan that is still waiting for Apply: the next words revise it.
	if (context.lastTask?.route === 'build' && context.lastTask.status === 'done') {
		return { route: 'build', label: text, text, revision: true }
	}
	if (scope.kind === 'card') return { route: 'node-assist', label: text, text }
	if (scope.kind === 'cards') return { route: 'build', label: text, text }
	return { route: 'agent', label: text, text }
}

/** The build prompt for a revision: the original goal, the change, and the previous plan to adjust. */
export function revisionGoal(goal: string, revision: string, previousPlan: unknown): string {
	return `${goal}\n\nRevision: ${revision.trim()}\n\nPrevious plan (adjust it, do not start over unless asked):\n${JSON.stringify(previousPlan)}`
}

/** One short line for the drawing agent's chat history, in place of a whole task item. */
export function taskHistoryLine(task: { label: string; scopeLabel: string; status: string; text?: string; error?: string }): string {
	const body = task.status === 'error' ? task.error ?? '' : task.text ?? ''
	const head = `[Task ${task.label} on ${task.scopeLabel}: ${task.status}]`
	const snippet = body.trim().slice(0, 300)
	return snippet ? `${head} ${snippet}` : head
}
