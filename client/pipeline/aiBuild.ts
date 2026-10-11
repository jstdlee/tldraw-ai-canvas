/**
 * "Build with AI": gather the selection (or nothing) as scope, ask the model
 * for a plan over the whole node catalogue, validate it, and apply it on request.
 */

import { atom, createBindingId, createShapeId, Editor, TLShapeId } from 'tldraw'
import { AiPlan, CanvasNodeInfo, parseAiPlan, validatePlan } from '../../shared/aiPlan'
import { NODE_SPECS, specPrompt } from '../../shared/nodeSpecs'
import { LayoutBox, layoutPlan } from '../../shared/planLayout'
import { shapeText } from '../clips/shapeText'
import { describeCanvasNode } from './aiContext'
import { apiGenerateText } from './api/pipelineApi'
import { NODE_WIDTH_PX } from './constants'
import { startExecution } from './execution/executionState'
import { createNodeAt } from './placeNode'
import { getNodeDefinition, NodeType } from './nodes/nodeTypes'
import { NodeShape } from './nodes/NodeShapeUtil'

export const $buildOpen = atom<boolean>('build panel open', false)
export const $buildGoalDraft = atom<string>('build goal draft', '')

export function openBuildPanel(goal?: string) {
	if (goal) $buildGoalDraft.set(goal)
	$buildOpen.set(true)
}

export function closeBuildPanel() {
	$buildOpen.set(false)
}

const ALLOWED_TYPES_KEY = 'oh-my-tldraw:ai-types'

function allAddableTypes(): string[] {
	return Object.keys(NODE_SPECS).filter((type) => !NODE_SPECS[type].hidden)
}

export function loadAllowedTypes(): string[] {
	try {
		const raw = localStorage.getItem(ALLOWED_TYPES_KEY)
		if (raw) {
			const parsed = JSON.parse(raw)
			if (Array.isArray(parsed) && parsed.length && parsed.every((t) => typeof t === 'string')) {
				const addable = new Set(allAddableTypes())
				return parsed.filter((t) => addable.has(t))
			}
		}
	} catch {
		// Fall through to the default (everything addable).
	}
	return allAddableTypes()
}

export function saveAllowedTypes(types: string[]) {
	try {
		localStorage.setItem(ALLOWED_TYPES_KEY, JSON.stringify(types))
	} catch {
		// Private browsing or a full quota: the choice just does not persist.
	}
}

export interface BuildScope {
	nodeShapes: NodeShape[]
	notes: string[]
	/** Other nodes on the page, shown for reuse only when nothing is selected. */
	allNodes: { id: string; type: string; label: string }[]
}

export function gatherBuildScope(editor: Editor): BuildScope {
	const selected = editor.getSelectedShapes()
	const nodeShapes = selected.filter((s): s is NodeShape => s.type === 'node')
	const otherShapes = selected.filter((s) => s.type !== 'node')
	const notes = otherShapes.map((s) => shapeText(editor, s).trim()).filter(Boolean)
	const allNodes =
		nodeShapes.length === 0 && otherShapes.length === 0
			? editor
					.getCurrentPageShapes()
					.filter((s): s is NodeShape => s.type === 'node')
					.slice(0, 60)
					.map((s) => {
						const node = s.props.node as unknown as { type: string }
						return { id: s.id, type: node.type, label: s.props.label || node.type }
					})
			: []
	return { nodeShapes, notes, allNodes }
}

const BUILD_SYSTEM_INTRO = `You are a workflow builder for this canvas. You work only with cards (nodes) and card wires — never propose a tldraw arrow, shape, text box, or note; that is a different tool's job.

Rules:
- Use only node types from the catalogue below; never invent a type, a field, an enum value, or a port.
- For every selected card: reuse it, set its real field names/enum values in "update" (do not recreate it), wire it to other cards using ports from the catalogue, and fill in anything the goal needs.
- Add a new card only for something missing; prefer the fewest cards that get the job done.
- Fully configure every card you add or update: set every field it needs to run, not just some of them.
- Wire every input a node needs; never leave a required input unwired. Use "unwire" first to remove an existing wire into a port before putting a new one there.
- DataPipe ("table") is one operation per node: chain several DataPipe nodes for several steps.
- Put anything only a person can do (uploading a file, entering an API key, approving a result) into "notes", never as a node field.
- Set "arrange":"tidy" (the default) so the involved cards — new ones and the selected ones you update/wire — get laid out left to right by dependency; use "none" only when you are not changing any wiring or layout-relevant card.

Reply with JSON only, in this shape:
{"summary":"one sentence","add":[{"ref":"n1","type":"prompt","props":{"text":"…"},"label":"optional title"}],"update":[{"id":"<existing node id>","props":{"…":"…"},"label":"optional"}],"wires":[{"from":"n1","fromPort":"output","to":"n2","toPort":"input"}],"unwire":[{"to":"<existing node id>","toPort":"<port id>"}],"notes":["anything only a person can do"],"arrange":"tidy"}

Example 1 — goal "fetch https://example.com and summarise it", nothing selected:
{"summary":"Fetch the page, then summarise it","add":[{"ref":"fetch","type":"http","props":{"method":"GET","url":"https://example.com"}},{"ref":"sum","type":"summarize","props":{"length":"short","format":"bullets"}}],"update":[],"wires":[{"from":"fetch","fromPort":"output","to":"sum","toPort":"input"}],"unwire":[],"notes":[],"arrange":"tidy"}

Example 2 — goal "filter rows where score > 3 and chart score by name", selected: a Prompt (csv text), a DataPipe ("table", op currently "select"), and a Chart:
{"summary":"Filter the table to score > 3, then chart score by name","add":[],"update":[{"id":"pipe1","props":{"op":"filter","column":"score","as":">","with":"3"}},{"id":"chart1","props":{"kind":"bar","xCol":"name","yCol":"score"}}],"wires":[{"from":"prompt1","fromPort":"output","to":"pipe1","toPort":"data"},{"from":"pipe1","fromPort":"output","to":"chart1","toPort":"data"}],"unwire":[],"notes":[],"arrange":"tidy"}`

function buildUserPrompt(goal: string, scope: BuildScope, selectedInfos: ReturnType<typeof describeCanvasNode>[]): string {
	const lines = [
		`Goal: ${goal.trim()}`,
		'',
		'Selected cards (reuse these if they fit the goal — set their fields in "update", wire their free ports, do not recreate them):',
		JSON.stringify(
			selectedInfos.map((info) => ({
				id: info.id,
				type: info.type,
				label: info.label,
				props: info.props,
				wiredInputs: info.wiredInputs,
				freeInputs: info.inputs.filter((id) => !info.wiredInputs.includes(id)),
				outputs: info.outputs,
			})),
			null,
			2
		),
	]
	if (scope.allNodes.length) {
		lines.push('', 'Other nodes already on the canvas (reuse by id if the goal mentions them):', JSON.stringify(scope.allNodes, null, 2))
	}
	if (scope.notes.length) {
		lines.push('', 'Notes on the canvas:', scope.notes.join('\n---\n'))
	}
	return lines.join('\n')
}

export interface BuildWithAiResult {
	plan: AiPlan
	warnings: string[]
}

/** Ask the model for a plan, validate it (repairing once on errors), and return it for preview. */
export async function buildWithAI(
	editor: Editor,
	goal: string,
	opts: { allowedTypes?: string[]; model?: string } = {}
): Promise<BuildWithAiResult> {
	if (!goal.trim()) throw new Error('Describe what you want to build')
	const scope = gatherBuildScope(editor)
	const selectedInfos = scope.nodeShapes.map((shape) => describeCanvasNode(editor, shape))
	const existingInfos: CanvasNodeInfo[] = editor
		.getCurrentPageShapes()
		.filter((s): s is NodeShape => s.type === 'node')
		.map((shape) => describeCanvasNode(editor, shape))

	const system = `${BUILD_SYSTEM_INTRO}\n\n${specPrompt(opts.allowedTypes)}`
	const userBase = buildUserPrompt(goal, scope, selectedInfos)
	const call = (prompt: string) =>
		apiGenerateText({ system, prompt, model: opts.model, capability: 'agent', temperature: 0.2, maxTokens: 6000 })

	const first = await call(userBase)
	let plan = parseAiPlan(first.text)
	let result = validatePlan(plan, existingInfos, NODE_SPECS, opts.allowedTypes)

	if (result.errors.length) {
		const repairPrompt = `${userBase}\n\nYour plan had these problems:\n${result.errors
			.map((e) => `- ${e}`)
			.join('\n')}\n\nReturn the full corrected plan as JSON, in the same shape.`
		const second = await call(repairPrompt)
		plan = parseAiPlan(second.text)
		result = validatePlan(plan, existingInfos, NODE_SPECS, opts.allowedTypes)
	}

	return { plan: result.plan, warnings: result.errors }
}

/** WP22 B2: remove the one existing wire (if any) feeding `toId.toPort`. */
function unwireInput(editor: Editor, toId: TLShapeId, portId: string) {
	const binding = editor.getBindingsToShape(toId, 'connection').find((b) => {
		const props = b.props as { terminal?: string; portId?: string }
		return props.terminal === 'end' && props.portId === portId
	})
	if (binding) editor.deleteShape(binding.fromId)
}

function approxNodeSize(editor: Editor, type: string): { w: number; h: number } {
	try {
		return { w: getNodeDefinition(editor, type as NodeType['type']).defaultWidthPx ?? NODE_WIDTH_PX, h: 200 }
	} catch {
		return { w: NODE_WIDTH_PX, h: 200 }
	}
}

/** Create/update/wire a validated plan on the canvas, as one history step.
 * `selectedIds` (WP22 B2): the cards selected when the plan was built — "arrange: tidy" moves
 * these (and any other existing card the plan updates or wires) into the layout too, alongside
 * whatever it adds. Other existing cards never move. */
export function applyAiPlan(
	editor: Editor,
	plan: AiPlan,
	opts: { runAfter?: boolean; selectedIds?: TLShapeId[] } = {}
): TLShapeId[] {
	const touched: TLShapeId[] = []
	editor.markHistoryStoppingPoint('ai build')
	editor.run(() => {
		const ids = new Map<string, TLShapeId>()
		const existingBoxes: LayoutBox[] = []
		for (const shape of editor.getCurrentPageShapes()) {
			if (shape.type !== 'node') continue
			const bounds = editor.getShapePageBounds(shape.id)
			if (!bounds) continue
			existingBoxes.push({ id: shape.id, x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height })
		}
		const existingIds = new Set(existingBoxes.map((box) => box.id))
		const movable = new Set<string>()
		if (plan.arrange === 'tidy') {
			for (const id of opts.selectedIds ?? []) if (existingIds.has(id)) movable.add(id)
			for (const update of plan.update) if (existingIds.has(update.id)) movable.add(update.id)
			for (const wire of plan.wires) {
				if (existingIds.has(wire.from)) movable.add(wire.from)
				if (existingIds.has(wire.to)) movable.add(wire.to)
			}
		}
		const positions = layoutPlan(plan, existingBoxes, (type) => approxNodeSize(editor, type), 48, movable)

		// Unwire first, so a wire into the same port later in this plan lands cleanly.
		for (const item of plan.unwire) {
			const toId = ids.get(item.to) ?? (editor.getShape(item.to as TLShapeId) ? (item.to as TLShapeId) : undefined)
			if (toId) unwireInput(editor, toId, item.toPort)
		}

		for (const add of plan.add) {
			let base: NodeType
			try {
				base = getNodeDefinition(editor, add.type as NodeType['type']).getDefault()
			} catch {
				continue
			}
			const node = { ...base, ...add.props, type: add.type } as NodeType
			const approx = approxNodeSize(editor, add.type)
			const pos = positions[add.ref]
			const near = pos ? { x: pos.x + approx.w / 2, y: pos.y + approx.h / 2 } : ('viewport' as const)
			const id = createNodeAt(editor, node, { near, select: false })
			if (add.label) editor.updateShape({ id, type: 'node', props: { label: add.label } })
			ids.set(add.ref, id)
			touched.push(id)
		}

		for (const update of plan.update) {
			const shapeId = update.id as TLShapeId
			const shape = editor.getShape(shapeId)
			if (!shape || shape.type !== 'node') continue
			touched.push(shapeId)
			const nodeShape = shape as NodeShape
			const hasProps = Object.keys(update.props).length > 0
			editor.updateShape<NodeShape>({
				id: shapeId,
				type: 'node',
				props: {
					...(hasProps ? { node: { ...nodeShape.props.node, ...update.props } as NodeShape['props']['node'], isOutOfDate: true } : {}),
					...(update.label ? { label: update.label } : {}),
				},
			})
		}

		// "arrange: tidy" (WP22 B2): move the movable existing cards layoutPlan placed, too.
		for (const id of movable) {
			const pos = positions[id]
			const shape = editor.getShape(id as TLShapeId)
			if (!pos || !shape || shape.type !== 'node') continue
			editor.updateShape({ id: shape.id, type: 'node', x: pos.x, y: pos.y })
			touched.push(shape.id)
		}

		for (const wire of plan.wires) {
			const fromId = ids.get(wire.from) ?? (editor.getShape(wire.from as TLShapeId) ? (wire.from as TLShapeId) : undefined)
			const toId = ids.get(wire.to) ?? (editor.getShape(wire.to as TLShapeId) ? (wire.to as TLShapeId) : undefined)
			if (!fromId || !toId) continue
			const connectionId = createShapeId()
			editor.createShape({
				id: connectionId,
				type: 'connection',
				props: { start: { x: 0, y: 0 }, end: { x: 80, y: 0 } },
			})
			editor.createBinding({
				id: createBindingId(),
				type: 'connection',
				fromId: connectionId,
				toId: fromId,
				props: { terminal: 'start', portId: wire.fromPort, order: 0 },
			})
			editor.createBinding({
				id: createBindingId(),
				type: 'connection',
				fromId: connectionId,
				toId: toId,
				props: { terminal: 'end', portId: wire.toPort, order: 1 },
			})
		}

		if (touched.length) {
			editor.select(...touched)
			const bounds = editor.getSelectionPageBounds()
			if (bounds && !editor.getViewportPageBounds().contains(bounds)) {
				editor.zoomToSelection({ animation: { duration: 200 } })
			}
		}
	})
	if (opts.runAfter && touched.length) void startExecution(editor, new Set(touched))
	return touched
}
