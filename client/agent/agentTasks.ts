/**
 * WP44/WP48: runs the agent's tasks. A request (quick action or free text) plus the scope (what
 * is selected) is routed by `routeAgentTask` (shared/agentRouting.ts). Free text always goes to
 * the one agent (`TldrawAgent`), which picks a capability: drawing actions, build-workflow,
 * fill-card, edit-text, ask-user or a plain message. Quick-action chips keep their direct
 * routes. Everything but the drawing turn runs here as a `task` item in the agent's chat
 * thread, updated by id as it runs.
 *
 * WP48 preview: every canvas change (a drawing turn, a build plan, a card fill, a text edit) is
 * applied at once outside undo, marked on the canvas and recorded as a diff on its task
 * (`status: 'preview'`). Apply makes it one undo step; Discard reverts it exactly.
 */

import { Editor, react, RecordsDiff, TLRecord, TLShape, TLShapeId } from 'tldraw'
import { AiPlan } from '../../shared/aiPlan'
import {
	documentOnly,
	isDiffEmpty,
	PreviewDiff,
	previewSummary,
	rebaseDiff,
	reverseDiff,
	squashDiffs,
	turnHasReply,
	TurnItem,
} from '../../shared/aiPreview'
import { AgentScope, AgentScopeShape, getAgentScope } from '../../shared/agentScope'
import { AgentRoute, AgentTaskRequest, revisionGoal, routeAgentTask } from '../../shared/agentRouting'
import { createAgentErrorHistoryItem } from '../../shared/format/agentError'
import { NODE_SPECS } from '../../shared/nodeSpecs'
import { ChatHistoryItem, ChatHistoryTaskItem } from '../../shared/types/ChatHistoryItem'
import { runExplain, runImageJob, runTextJob, sendImageToPipeline } from '../clips/canvasFeatures'
import { rewriteTargetsOf, rewriteTexts, runRewrite, setShapeText } from '../clips/rewrite'
import { shapeText } from '../clips/shapeText'
import { applyAiPlan, buildWithAI, loadAllowedTypes } from '../pipeline/aiBuild'
import { applyNodeAssistChanges, NodeAssistResult, runNodeAssist } from '../pipeline/assist'
import { startExecution } from '../pipeline/execution/executionState'
import { getNodeRun } from '../pipeline/execution/nodeRunState'
import { formatSelectionAsList, selectionHasRichText } from '../text/listFormat'
import { $adjustTarget as $adjustTargetRef } from './aiBarState'
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

/** The scope of some shapes (not the selection): the agent's capability actions use this. */
export function getShapesScope(editor: Editor, ids: TLShapeId[]): AgentScope {
	const shapes = ids.map((id) => editor.getShape(id)).filter((s): s is TLShape => !!s)
	return getAgentScope(shapes.map((shape) => describeScopeShape(editor, shape)))
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

/** The last task in the thread, if no message was sent after it. */
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

/** True while the agent is working: its drawing turn, or any task still in flight. */
export function isAgentBusy(agent: TldrawAgent): boolean {
	if (agent.requests.isGenerating()) return true
	return agent.chat.getHistory().some((item) => item.type === 'task' && item.status === 'running' && controllers.has(item.id))
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
 * needs its one extra answer (the panel prefills the input or opens a sheet). `adjust` is a
 * preview task the request revises (WP48 Adjust): it is discarded first and the new request
 * builds on it.
 */
export function runAgentRequest(
	agent: TldrawAgent,
	scope: AgentScope,
	request: AgentTaskRequest,
	opts: { adjust?: string | null } = {}
): RunResult {
	const route = routeAgentTask(scope, request)
	if (!route) return { status: 'needs-input' }

	const target = opts.adjust ? getTask(agent, opts.adjust) : null
	if (target && target.status === 'preview' && !('action' in request)) {
		discardPreview(agent, target.id, { revised: true })
		if (target.route === 'build' && target.goal) {
			// A plan keeps its goal and its previous plan: the model adjusts it.
			const goal = revisionGoal(target.goal, route.text, target.plan)
			startTask(agent, { route: 'build', label: route.label, text: route.text, revision: true }, scope, { goal, withPrompt: true })
			return { status: 'started' }
		}
		const ids = target.scopeIds.filter((id) => agent.editor.getShape(id as TLShapeId)) as TLShapeId[]
		if (ids.length) agent.editor.select(...ids)
		void runAgentTurn(agent, {
			agentMessage:
				`Revise your previous change (it was undone). The previous request was: "${target.label}". ` +
				`Change it like this: ${route.text}`,
			userMessage: route.label,
		})
		return { status: 'started' }
	}

	// Typed words while the agent's question is open answer it.
	const question = route.route === 'agent' && !('action' in request) ? getOpenQuestion(agent) : null
	if (question) {
		answerQuestion(agent, question.id, route.text)
		return { status: 'started' }
	}

	if (route.route === 'agent') {
		void runAgentTurn(agent, { agentMessage: route.text, userMessage: route.label })
		return { status: 'started' }
	}

	startTask(agent, route, scope, { goal: route.route === 'build' ? route.text : undefined, withPrompt: true })
	return { status: 'started' }
}

/** Resolves when the agent is not generating any more. */
function whenAgentIdle(agent: TldrawAgent): Promise<void> {
	return new Promise((resolve) => {
		let stop: (() => void) | null = null
		let done = false
		stop = react('agent idle', () => {
			if (done || agent.requests.isGenerating()) return
			done = true
			queueMicrotask(() => {
				stop?.()
				resolve()
			})
		})
	})
}

/**
 * WP48: one free-text turn of the one agent. When it ends, its canvas changes become one
 * preview task; a turn that showed the user nothing at all ends with "Nothing to change."
 */
export async function runAgentTurn(agent: TldrawAgent, { agentMessage, userMessage }: { agentMessage: string; userMessage: string }) {
	const editor = agent.editor
	const scope = getEditorScope(editor)
	const start = agent.chat.getHistory().length
	try {
		agent.interrupt({
			input: {
				agentMessages: [agentMessage],
				userMessages: [userMessage],
				bounds: editor.getViewportPageBounds(),
				source: 'user',
				contextItems: agent.context.getItems(),
			},
		})
		await whenAgentIdle(agent)
	} catch (error) {
		agent.chat.push(createAgentErrorHistoryItem(error))
	}
	// Capability actions start their tasks in a microtask: let them be pushed first.
	await Promise.resolve()
	finishAgentTurn(agent, start, scope)
}

function finishAgentTurn(agent: TldrawAgent, start: number, scope: AgentScope) {
	const history = agent.chat.getHistory()
	// A reset (New chat) during the turn: nothing of this turn is left to report on.
	if (history.length < start) return
	const items = history.slice(start)
	const diffs = items.flatMap((item) => (item.type === 'action' && item.action.complete ? [item.diff as PreviewDiff] : []))
	const diff = documentOnly(squashDiffs(diffs))
	if (!isDiffEmpty(diff)) {
		agent.chat.push({
			type: 'task',
			id: newId(),
			route: 'agent',
			label: 'Canvas changes',
			scopeLabel: scope.label,
			scopeIds: scope.ids,
			status: 'preview',
			text: previewSummary(diff),
			previewDiff: diff,
			placedIds: Object.keys(diff.added).filter((id) => id.startsWith('shape:')),
		})
		return
	}
	const turnItems: TurnItem[] = items.map((item) =>
		item.type === 'action'
			? {
					type: 'action',
					actionType: item.action._type,
					complete: item.action.complete,
					hasDiff: !isDiffEmpty(documentOnly(item.diff as PreviewDiff)),
				}
			: { type: item.type }
	)
	// Only answer when the turn had a prompt of its own (a cancelled request ends silently).
	const hasPrompt = items.some((item) => item.type === 'prompt' && item.promptSource !== 'self')
	if (hasPrompt && !turnHasReply(turnItems)) {
		agent.chat.push({
			type: 'task',
			id: newId(),
			route: 'agent',
			label: 'Nothing to change',
			scopeLabel: scope.label,
			scopeIds: scope.ids,
			status: 'done',
			text: 'Nothing to change.',
		})
	}
}

/**
 * Push a task (after a `prompt` item with the user's words, unless `withPrompt` is false) and
 * run it. The agent's capability actions (build-workflow, fill-card, edit-text) start their
 * tasks this way.
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
		if (signal.aborted || !controllers.has(id)) {
			// Stopped after the change was made: take it back.
			if (patch.previewDiff) revertDiff(agent, patch.previewDiff as PreviewDiff)
			return
		}
		updateTask(agent, id, { status: 'done', ...patch })
	} catch (cause) {
		if (signal.aborted || !controllers.has(id)) return
		const message = cause instanceof Error ? cause.message : String(cause)
		updateTask(agent, id, { status: 'error', error: message || 'Something went wrong.' })
	} finally {
		if (controllers.get(id) === controller) controllers.delete(id)
	}
}

/** WP44 bug 3 / WP48: plan rows keep card names and "before" values once the plan is on the canvas. */
function planSnapshot(editor: Editor, plan: AiPlan) {
	const names: Record<string, string> = {}
	const before: Record<string, Record<string, unknown>> = {}
	const nameOf = (ref: string) => {
		const added = plan.add.find((node) => node.ref === ref)
		if (added) return added.label || NODE_SPECS[added.type]?.title || added.type
		const shape = editor.getShape(ref as TLShapeId)
		if (shape?.type === 'node') return cardTitle(shape)
		return null
	}
	const refs = [
		...plan.add.map((n) => n.ref),
		...plan.update.map((u) => u.id),
		...plan.wires.flatMap((w) => [w.from, w.to]),
		...plan.unwire.map((u) => u.to),
	]
	for (const ref of refs) {
		const name = nameOf(ref)
		if (name) names[ref] = name
	}
	for (const update of plan.update) {
		const shape = editor.getShape(update.id as TLShapeId)
		if (shape?.type === 'node') before[update.id] = { ...((shape.props as { node: Record<string, unknown> }).node ?? {}) }
	}
	return { names, before }
}

function planHasChanges(plan: AiPlan): boolean {
	return !!(plan.add.length || plan.update.length || plan.wires.length || plan.unwire.length)
}

/** Put a build plan on the canvas as a preview. */
function previewPlan(agent: TldrawAgent, plan: AiPlan, scopeIds: string[], arrange: boolean) {
	const editor = agent.editor
	const selectedIds = scopeIds.filter((shapeId) => editor.getShape(shapeId as TLShapeId)?.type === 'node') as TLShapeId[]
	let touched: TLShapeId[] = []
	const diff = recordPreview(agent, () => {
		touched = applyAiPlan(editor, { ...plan, arrange: arrange ? 'tidy' : 'none' }, { runAfter: false, selectedIds })
	})
	return { diff, touched }
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
			const base = { text: result.say, assist: result, warnings: result.errors }
			if (!result.changes.length || signal.aborted) return base
			const diff = recordPreview(agent, () => applyNodeAssistChanges(editor, cardId, result.changes))
			return isDiffEmpty(diff) ? base : { ...base, status: 'preview', previewDiff: diff, placedIds: [cardId] }
		}
		case 'edit-text': {
			const targets = rewriteTargetsOf(editor, ids)
			if (!targets.length) throw new Error('Select shapes with text first.')
			const texts = await rewriteTexts(editor, targets, route.text, signal)
			if (signal.aborted) return {}
			const diff = recordPreview(agent, () => {
				for (const { id, text } of texts) setShapeText(editor, id, text)
			})
			const text = `Rewrote ${texts.length} text${texts.length === 1 ? '' : 's'}: ${route.text}`
			return isDiffEmpty(diff) ? { text: 'Nothing to change.' } : { status: 'preview', text, previewDiff: diff, placedIds: targets }
		}
		case 'build': {
			const result = await buildWithAI(editor, goal ?? route.text, { allowedTypes: loadAllowedTypes(), signal })
			const plan = result.plan
			const base = { text: plan.summary, plan, warnings: result.warnings }
			if (!planHasChanges(plan) || signal.aborted) return base
			const snapshot = planSnapshot(editor, plan)
			const arranged = plan.arrange !== 'none'
			const { diff, touched } = previewPlan(agent, plan, scope.ids, arranged)
			if (isDiffEmpty(diff)) return base
			return {
				...base,
				status: 'preview',
				previewDiff: diff,
				placedIds: touched,
				planNames: snapshot.names,
				planBefore: snapshot.before,
				arranged,
			}
		}
		case 'agent':
		case 'ask-user':
			throw new Error('The agent does not run as a task.')
	}
}

// ---------------------------------------------------------------------------
// Preview: record, Apply, Discard
// ---------------------------------------------------------------------------

/** True while this module itself changes the store (Apply, Discard): not a user edit. */
let previewBusy = false

export function isPreviewBusy() {
	return previewBusy
}

/**
 * Run `fn` (an AI change) outside undo and return what it changed in the document. While it
 * runs the agent counts as acting, so the user action tracker ignores it.
 */
export function recordPreview(agent: TldrawAgent, fn: () => void): PreviewDiff {
	const editor = agent.editor
	const wasActing = agent.getIsActingOnEditor()
	agent.setIsActingOnEditor(true)
	try {
		const diff = editor.store.extractingChanges(() => {
			editor.run(fn, { history: 'ignore', ignoreShapeLock: true })
		})
		return documentOnly(diff as unknown as PreviewDiff)
	} finally {
		agent.setIsActingOnEditor(wasActing)
	}
}

function currentRecord(editor: Editor) {
	return (id: string) => editor.store.get(id as TLRecord['id']) as unknown as PreviewDiff['added'][string] | undefined
}

function asRecordsDiff(diff: PreviewDiff): RecordsDiff<TLRecord> {
	return diff as unknown as RecordsDiff<TLRecord>
}

/** Undo a preview's change on the canvas, outside undo history. */
function revertDiff(agent: TldrawAgent, diff: PreviewDiff) {
	const editor = agent.editor
	const rebased = rebaseDiff(diff, currentRecord(editor))
	previewBusy = true
	const wasActing = agent.getIsActingOnEditor()
	agent.setIsActingOnEditor(true)
	try {
		editor.run(() => editor.store.applyDiff(asRecordsDiff(reverseDiff(rebased))), { history: 'ignore', ignoreShapeLock: true })
	} finally {
		agent.setIsActingOnEditor(wasActing)
		previewBusy = false
	}
}

/** The tasks whose change is on the canvas, waiting for Apply or Discard. */
export function getOpenPreviews(agent: TldrawAgent): ChatHistoryTaskItem[] {
	return agent.chat.getHistory().filter((item): item is ChatHistoryTaskItem => item.type === 'task' && item.status === 'preview')
}

/**
 * Apply: the preview's change becomes one undo step. It is already on the canvas (outside
 * undo); it is taken back and put again in one go, recorded after a history mark.
 */
export function applyPreview(agent: TldrawAgent, id: string, opts: { runAfter?: boolean } = {}) {
	const task = getTask(agent, id)
	if (!task || task.status !== 'preview' || !task.previewDiff) return
	const editor = agent.editor
	const rebased = rebaseDiff(task.previewDiff as PreviewDiff, currentRecord(editor))
	previewBusy = true
	const wasActing = agent.getIsActingOnEditor()
	agent.setIsActingOnEditor(true)
	try {
		editor.run(() => editor.store.applyDiff(asRecordsDiff(reverseDiff(rebased))), { history: 'ignore', ignoreShapeLock: true })
		editor.markHistoryStoppingPoint('ai apply')
		editor.run(() => editor.store.applyDiff(asRecordsDiff(rebased)), { ignoreShapeLock: true })
	} finally {
		agent.setIsActingOnEditor(wasActing)
		previewBusy = false
	}
	if ($adjustTargetRef.get() === id) $adjustTargetRef.set(null)
	updateTask(agent, id, { status: 'applied' })
	if (opts.runAfter) {
		const nodes = (task.placedIds ?? []).filter((shapeId) => editor.getShape(shapeId as TLShapeId)?.type === 'node') as TLShapeId[]
		if (nodes.length) void startExecution(editor, new Set(nodes))
	}
}

/** Discard: revert the preview's change exactly. `revised`: Adjust replaced it with a new request. */
export function discardPreview(agent: TldrawAgent, id: string, opts: { revised?: boolean } = {}) {
	const task = getTask(agent, id)
	if (!task) return
	if (task.status === 'preview' && task.previewDiff) revertDiff(agent, task.previewDiff as PreviewDiff)
	if ($adjustTargetRef.get() === id) $adjustTargetRef.set(null)
	updateTask(agent, id, { status: 'discarded', ...(opts.revised ? { warnings: [...(task.warnings ?? []), 'Revised below.'] } : {}) })
}

/** The user edited a previewed shape: that counts as Apply (no undo step of its own). */
export function commitPreview(agent: TldrawAgent, id: string) {
	const task = getTask(agent, id)
	if (!task || task.status !== 'preview') return
	if ($adjustTargetRef.get() === id) $adjustTargetRef.set(null)
	updateTask(agent, id, { status: 'applied' })
}

export function applyAllPreviews(agent: TldrawAgent) {
	for (const task of getOpenPreviews(agent)) applyPreview(agent, task.id)
}

export function discardAllPreviews(agent: TldrawAgent) {
	// Newest first, so changes stacked on the same shapes unwind in order.
	for (const task of getOpenPreviews(agent).reverse()) discardPreview(agent, task.id)
}

/** Build preview: "Arrange cards" was switched; put the plan back with the new choice. */
export function rearrangeBuildPreview(agent: TldrawAgent, id: string, arrange: boolean) {
	const task = getTask(agent, id)
	if (!task || task.status !== 'preview' || !task.plan || !task.previewDiff) return
	revertDiff(agent, task.previewDiff as PreviewDiff)
	const { diff, touched } = previewPlan(agent, task.plan as AiPlan, task.scopeIds, arrange)
	updateTask(agent, id, { previewDiff: diff, placedIds: touched, arranged: arrange })
}

// ---------------------------------------------------------------------------
// Older threads (saved before WP48): a plan or assist still 'done' is applied directly.
// ---------------------------------------------------------------------------

export function applyBuildTask(agent: TldrawAgent, id: string, opts: { arrange: boolean; runAfter: boolean }) {
	const task = getTask(agent, id)
	if (!task?.plan) return
	const editor = agent.editor
	const plan = task.plan as AiPlan
	const snapshot = planSnapshot(editor, plan)
	const selectedIds = task.scopeIds.filter((shapeId) => editor.getShape(shapeId as TLShapeId)?.type === 'node') as TLShapeId[]
	const touched = applyAiPlan(editor, { ...plan, arrange: opts.arrange ? 'tidy' : 'none' }, { runAfter: opts.runAfter, selectedIds })
	updateTask(agent, id, { status: 'applied', placedIds: touched, planNames: snapshot.names, planBefore: snapshot.before })
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
	const task = getTask(agent, id)
	if (task?.status === 'preview') return discardPreview(agent, id)
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

// ---------------------------------------------------------------------------
// ask-user
// ---------------------------------------------------------------------------

/** WP48: the agent asked one question: show it in the thread with its answers as chips. */
export function pushQuestion(agent: TldrawAgent, question: string, options: string[]) {
	const scope = getEditorScope(agent.editor)
	agent.chat.push({
		type: 'task',
		id: newId(),
		route: 'ask-user',
		label: 'Question',
		scopeLabel: scope.label,
		scopeIds: scope.ids,
		status: 'done',
		text: question,
		options: options.map((o) => o.trim()).filter(Boolean).slice(0, 6),
	})
}

/** The question the agent asked last, if no message was sent after it. */
export function getOpenQuestion(agent: TldrawAgent): ChatHistoryTaskItem | null {
	const last = findLastTask(agent.chat.getHistory())
	return last?.route === 'ask-user' && last.status === 'done' ? last : null
}

/** Answer the agent's question (a chip or typed words): a new turn, scoped like the question. */
export function answerQuestion(agent: TldrawAgent, id: string, answer: string) {
	const task = getTask(agent, id)
	if (!task) return
	updateTask(agent, id, { status: 'applied', answer })
	const editor = agent.editor
	const ids = task.scopeIds.filter((shapeId) => editor.getShape(shapeId as TLShapeId)) as TLShapeId[]
	if (ids.length) editor.select(...ids)
	void runAgentTurn(agent, {
		agentMessage: `You asked: "${task.text ?? ''}". The user answered: ${answer}. Now do the change.`,
		userMessage: answer,
	})
}

// ---------------------------------------------------------------------------
// Editing a previewed shape counts as Apply
// ---------------------------------------------------------------------------

const INTERACTIONS = ['select.translating', 'select.resizing', 'select.rotating', 'select.dragging_handle', 'select.cropping']

/**
 * WP48: while a preview is open, the user editing one of its shapes (typing in it, dragging or
 * resizing it, changing a card field) counts as Apply. AI changes and our own Apply / Discard
 * are not user edits. Returns the cleanup.
 */
export function installPreviewWatcher(agent: TldrawAgent): () => void {
	const editor = agent.editor
	return editor.sideEffects.registerAfterChangeHandler('shape', (_prev, next, source) => {
		if (source !== 'user' || previewBusy || agent.getIsActingOnEditor()) return
		const open = getOpenPreviews(agent)
		if (!open.length) return
		const id = next.id
		const editing = editor.getEditingShapeId() === id
		const dragging = editor.isInAny(...INTERACTIONS) && editor.getSelectedShapeIds().includes(id)
		const active = typeof document !== 'undefined' ? document.activeElement : null
		const inCard = !!active?.closest?.(`.tl-shape[data-shape-id="${CSS.escape(id)}"]`)
		if (!editing && !dragging && !inCard) return
		for (const task of open) {
			const diff = task.previewDiff as PreviewDiff | undefined
			if (diff && (diff.added[id] || diff.updated[id])) commitPreview(agent, task.id)
		}
	})
}
