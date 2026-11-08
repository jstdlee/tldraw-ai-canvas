/**
 * WP44: runs the agent panel's tasks. A request (quick action or free text) plus the scope (what
 * is selected) is routed by `routeAgentTask` (shared/agentRouting.ts); everything but the
 * drawing agent runs here as a `task` item in the agent's chat thread, updated by id as it runs.
 */

import { Editor, TLShape, TLShapeId } from 'tldraw'
import { AiPlan } from '../../shared/aiPlan'
import { AgentScope, AgentScopeShape, getAgentScope } from '../../shared/agentScope'
import { AgentRoute, AgentTaskRequest, LastTaskInfo, revisionGoal, routeAgentTask } from '../../shared/agentRouting'
import { NODE_SPECS } from '../../shared/nodeSpecs'
import { ChatHistoryItem, ChatHistoryTaskItem } from '../../shared/types/ChatHistoryItem'
import { runExplain, runImageJob, runTextJob, sendImageToPipeline } from '../clips/canvasFeatures'
import { rewriteTargetsOf, runRewrite } from '../clips/rewrite'
import { shapeText } from '../clips/shapeText'
import { applyAiPlan, buildWithAI, loadAllowedTypes } from '../pipeline/aiBuild'
import { applyNodeAssistChanges, NodeAssistResult, runNodeAssist } from '../pipeline/assist'
import { getNodeRun } from '../pipeline/execution/nodeRunState'
import { formatSelectionAsList, selectionHasRichText } from '../text/listFormat'
import type { TldrawAgent } from './TldrawAgent'

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

function cardTitle(shape: TLShape): string {
	const props = shape.props as { label?: string; node?: { type?: string; title?: string } }
	const type = props.node?.type ?? ''
	if (props.label) return props.label
	if (type === 'subgraph' && props.node?.title) return props.node.title
	return NODE_SPECS[type]?.title ?? type
}

export function describeScopeShape(editor: Editor, shape: TLShape): AgentScopeShape {
	if (shape.type === 'node') return { id: shape.id, kind: 'card', title: cardTitle(shape) }
	if (shape.type === 'image') return { id: shape.id, kind: 'image' }
	if (shape.type !== 'arrow' && shapeText(editor, shape).trim()) return { id: shape.id, kind: 'text' }
	return { id: shape.id, kind: 'other' }
}

/** The scope of the current selection. Reactive when read inside `useValue`. */
export function getEditorScope(editor: Editor): AgentScope {
	return getAgentScope(editor.getSelectedShapes().map((shape) => describeScopeShape(editor, shape)))
}

/** The error a card shows (its run error, or its stored node.error), or ''. Same rule as the card's banner. */
export function cardErrorMessage(editor: Editor, id: TLShapeId): string {
	const shape = editor.getShape(id)
	if (!shape || shape.type !== 'node') return ''
	const run = getNodeRun(editor, id)
	const runMessage = (run?.status === 'error' || run?.status === 'missing') && run.message?.trim() ? run.message : ''
	const stored = (shape.props as { node?: { error?: unknown } }).node?.error
	return runMessage || (typeof stored === 'string' ? stored.trim() : '')
}

// ---------------------------------------------------------------------------
// Thread helpers
// ---------------------------------------------------------------------------

function newId(): string {
	return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `task-${Date.now()}-${Math.random()}`
}

/** The last task in the thread, if no message was sent after it (a revision builds on it). */
export function findLastTask(history: ChatHistoryItem[]): ChatHistoryTaskItem | null {
	for (let i = history.length - 1; i >= 0; i--) {
		const item = history[i]
		if (item.type === 'task') return item
		if (item.type === 'prompt' && item.promptSource !== 'self') {
			// The task's own prompt sits right before it; any other prompt after it ends its turn.
			if (history[i + 1]?.type === 'task') continue
			return null
		}
	}
	return null
}

export function getTask(agent: TldrawAgent, id: string): ChatHistoryTaskItem | null {
	const item = agent.chat.getHistory().find((i) => i.type === 'task' && i.id === id)
	return item?.type === 'task' ? item : null
}

export function updateTask(agent: TldrawAgent, id: string, patch: Partial<ChatHistoryTaskItem>) {
	agent.chat.update((history) => history.map((item) => (item.type === 'task' && item.id === id ? { ...item, ...patch } : item)))
}

const controllers = new Map<string, AbortController>()

/** True while the task's request is in flight in this page (a reload ends it). */
export function isTaskLive(id: string): boolean {
	return controllers.has(id)
}

export function stopTask(agent: TldrawAgent, id: string) {
	const controller = controllers.get(id)
	if (!controller) return
	controllers.delete(id)
	controller.abort()
	updateTask(agent, id, { status: 'error', error: 'Stopped.' })
}

/** What a task needs to run (again): stored on the task item so Retry works. */
interface TaskRun {
	route: AgentRoute
	scope: AgentScope
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export type RunResult = { status: 'started' } | { status: 'needs-input' }

/**
 * Route and run one request against `scope`. Returns 'needs-input' when a quick action still
 * needs its one extra answer (the panel prefills the input or opens a sheet).
 */
export function runAgentRequest(agent: TldrawAgent, scope: AgentScope, request: AgentTaskRequest): RunResult {
	const lastTask = findLastTask(agent.chat.getHistory())
	const last: LastTaskInfo | null = lastTask ? { route: lastTask.route, status: lastTask.status } : null
	const route = routeAgentTask(scope, request, { lastTask: last })
	if (!route) return { status: 'needs-input' }

	if (route.route === 'agent') {
		agent.interrupt({
			input: {
				agentMessages: [route.text],
				userMessages: [route.label],
				bounds: agent.editor.getViewportPageBounds(),
				source: 'user',
				contextItems: agent.context.getItems(),
			},
		})
		return { status: 'started' }
	}

	let goal: string | undefined
	if (route.route === 'build') {
		goal = route.revision && lastTask?.goal ? revisionGoal(lastTask.goal, route.text, lastTask.plan) : route.text
	}
	startTask(agent, route, scope, { goal, withPrompt: true })
	return { status: 'started' }
}

/**
 * Push a task (after a `prompt` item with the user's words, unless `withPrompt` is false) and
 * run it. The drawing agent's `build-workflow` action starts its build task this way.
 */
export function startTask(
	agent: TldrawAgent,
	route: AgentRoute,
	scope: AgentScope,
	opts: { goal?: string; withPrompt: boolean }
): string {
	const id = newId()
	const items: ChatHistoryItem[] = []
	if (opts.withPrompt) {
		items.push({
			type: 'prompt',
			promptSource: 'user',
			agentFacingMessage: route.label,
			userFacingMessage: route.label,
			contextItems: [],
			selectedShapes: [],
		})
	}
	items.push({
		type: 'task',
		id,
		route: route.route,
		label: route.route === 'build' && !route.label.startsWith('Build') ? `Build: ${route.label}` : route.label,
		scopeLabel: scope.label,
		scopeIds: scope.ids,
		status: 'running',
		goal: opts.goal,
		request: { route, scope } satisfies TaskRun,
	})
	agent.chat.push(...items)
	void executeTask(agent, id, { route, scope }, opts.goal)
	return id
}

/** Run a failed or stopped task again, in place. */
export function retryTask(agent: TldrawAgent, id: string) {
	const task = getTask(agent, id)
	const run = task?.request as TaskRun | undefined
	if (!task || !run?.route || !run.scope) return
	const editor = agent.editor
	const ids = run.scope.ids.filter((shapeId) => editor.getShape(shapeId as TLShapeId)) as TLShapeId[]
	if (ids.length) editor.select(...ids)
	updateTask(agent, id, { status: 'running', error: undefined, text: undefined })
	void executeTask(agent, id, run, task.goal)
}

async function executeTask(agent: TldrawAgent, id: string, run: TaskRun, goal?: string) {
	const controller = new AbortController()
	controllers.set(id, controller)
	const { signal } = controller
	try {
		const patch = await runRoute(agent, run, goal, signal)
		if (signal.aborted || !controllers.has(id)) return
		updateTask(agent, id, { status: 'done', ...patch })
	} catch (cause) {
		if (signal.aborted || !controllers.has(id)) return
		const message = cause instanceof Error ? cause.message : String(cause)
		updateTask(agent, id, { status: 'error', error: message || 'Something went wrong.' })
	} finally {
		if (controllers.get(id) === controller) controllers.delete(id)
	}
}

async function runRoute(
	agent: TldrawAgent,
	{ route, scope }: TaskRun,
	goal: string | undefined,
	signal: AbortSignal
): Promise<Partial<ChatHistoryTaskItem>> {
	const editor = agent.editor
	const ids = scope.ids as TLShapeId[]
	switch (route.route) {
		case 'text-job': {
			const job = (route.job ?? 'summarize') as 'summarize' | 'translate' | 'improve' | 'brainstorm'
			const result = await runTextJob(editor, ids, job, { language: route.text, signal })
			return { text: result.text, placedIds: [result.placedId] }
		}
		case 'image-job': {
			const result = await runImageJob(editor, ids, (route.job ?? 'describe') as 'describe' | 'ocr', { signal })
			return { text: result.text, placedIds: [result.placedId] }
		}
		case 'explain': {
			const result = await runExplain(editor, ids, { signal })
			return { text: result.text, placedIds: [result.placedId] }
		}
		case 'rewrite': {
			const targets = rewriteTargetsOf(editor, ids)
			if (!targets.length) throw new Error('Select shapes with text first.')
			const made = await runRewrite(editor, targets, route.text, route.label, signal)
			return { text: `${made.length} variant${made.length === 1 ? '' : 's'} added to the right.`, placedIds: made }
		}
		case 'list-format': {
			const live = ids.filter((shapeId) => editor.getShape(shapeId))
			if (live.length) editor.select(...live)
			if (!selectionHasRichText(editor)) throw new Error('Select text, note or shape labels first.')
			formatSelectionAsList(editor, 'task')
			return { text: 'Made a checklist from the selected text.' }
		}
		case 'send-to-pipeline': {
			const imageId = ids.find((shapeId) => editor.getShape(shapeId)?.type === 'image')
			if (!imageId) throw new Error('Select an image first.')
			editor.select(imageId)
			const nodeId = await sendImageToPipeline(editor)
			if (!nodeId) throw new Error('Select an image first.')
			return { text: 'Added a Load image card with this image.', placedIds: [nodeId] }
		}
		case 'node-assist': {
			const cardId = ids.find((shapeId) => editor.getShape(shapeId)?.type === 'node')
			if (!cardId) throw new Error('Select a card first.')
			const result = await runNodeAssist(editor, cardId, route.text, { signal })
			return { text: result.say, assist: result, warnings: result.errors }
		}
		case 'build': {
			const result = await buildWithAI(editor, goal ?? route.text, { allowedTypes: loadAllowedTypes(), signal })
			return { text: result.plan.summary, plan: result.plan, warnings: result.warnings }
		}
		case 'agent':
			throw new Error('The drawing agent does not run as a task.')
	}
}

// ---------------------------------------------------------------------------
// Apply / discard
// ---------------------------------------------------------------------------

export function applyBuildTask(agent: TldrawAgent, id: string, opts: { arrange: boolean; runAfter: boolean }) {
	const task = getTask(agent, id)
	if (!task?.plan) return
	const editor = agent.editor
	const plan = task.plan as AiPlan
	const selectedIds = task.scopeIds.filter((shapeId) => editor.getShape(shapeId as TLShapeId)?.type === 'node') as TLShapeId[]
	const touched = applyAiPlan(editor, { ...plan, arrange: opts.arrange ? 'tidy' : 'none' }, { runAfter: opts.runAfter, selectedIds })
	updateTask(agent, id, { status: 'applied', placedIds: touched })
}

export function applyAssistTask(agent: TldrawAgent, id: string) {
	const task = getTask(agent, id)
	const assist = task?.assist as NodeAssistResult | undefined
	const cardId = task?.scopeIds.find((shapeId) => agent.editor.getShape(shapeId as TLShapeId)?.type === 'node')
	if (!task || !assist || !cardId) return
	applyNodeAssistChanges(agent.editor, cardId as TLShapeId, assist.changes)
	updateTask(agent, id, { status: 'applied', placedIds: [cardId] })
}

export function discardTask(agent: TldrawAgent, id: string) {
	updateTask(agent, id, { status: 'discarded' })
}

/** node-assist "Build it": a build task for what the card cannot do alone, in the same thread. */
export function buildNeed(agent: TldrawAgent, cardId: string, need: { type: string; why: string }) {
	const editor = agent.editor
	const shape = editor.getShape(cardId as TLShapeId)
	if (shape) editor.select(shape.id)
	const goal = `Add a ${NODE_SPECS[need.type]?.title ?? need.type} node${need.why ? `: ${need.why}` : ''}`
	runAgentRequest(agent, getEditorScope(editor), { action: 'build-workflow', text: goal })
}

/** Select the shapes a task placed and bring them into view. */
export function showOnCanvas(editor: Editor, ids: string[]) {
	const live = ids.filter((id) => editor.getShape(id as TLShapeId)) as TLShapeId[]
	if (!live.length) return
	editor.select(...live)
	editor.zoomToSelection({ animation: { duration: 200 } })
}
