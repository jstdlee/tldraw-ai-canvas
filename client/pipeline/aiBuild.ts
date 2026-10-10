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

const BUILD_SYSTEM_INTRO = `You are a workflow builder for this canvas. You add, wire and configure nodes from a fixed catalogue so the canvas does what the user asked.

Rules:
- Use only node types from the catalogue below; never invent a type, a field, an enum value, or a port.
- Reuse the selected or listed existing nodes when they already fit the goal; do not recreate them.
- Prefer the fewest nodes that get the job done.
- Fully configure every new node: set every field it needs to run, not just some of them.
- Wire every input a node needs; never leave a required input unwired.
- DataPipe ("table") is one operation per node: chain several DataPipe nodes for several steps.
- Put anything only a person can do (uploading a file, entering an API key, approving a result) into "notes", never as a node field.

Reply with JSON only, in this shape:
{"summary":"one sentence","add":[{"ref":"n1","type":"prompt","props":{"text":"…"},"label":"optional title"}],"update":[{"id":"<existing node id>","props":{"…":"…"},"label":"optional"}],"wires":[{"from":"n1","fromPort":"output","to":"n2","toPort":"input"}],"notes":["anything only a person can do"]}

Example — goal "fetch https://example.com and summarise it":
{"summary":"Fetch the page, then summarise it","add":[{"ref":"fetch","type":"http","props":{"method":"GET","url":"https://example.com"}},{"ref":"sum","type":"summarize","props":{"length":"short","format":"bullets"}}],"update":[],"wires":[{"from":"fetch","fromPort":"output","to":"sum","toPort":"input"}],"notes":[]}`

function buildUserPrompt(goal: string, scope: BuildScope, selectedInfos: ReturnType<typeof describeCanvasNode>[]): string {
	const lines = [
		`Goal: ${goal.trim()}`,
		'',
		'Selected nodes (reuse these if they fit the goal):',
		JSON.stringify(
			selectedInfos.map((info) => ({
				id: info.id,
				type: info.type,
				label: info.label,
				props: info.props,
				wiredInputs: info.wiredInputs,
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

function approxNodeSize(editor: Editor, type: string): { w: number; h: number } {
	try {
		return { w: getNodeDefinition(editor, type as NodeType['type']).defaultWidthPx ?? NODE_WIDTH_PX, h: 200 }
	} catch {
		return { w: NODE_WIDTH_PX, h: 200 }
	}
}

/** Create/update/wire a validated plan on the canvas, as one history step. */
export function applyAiPlan(editor: Editor, plan: AiPlan, opts: { runAfter?: boolean } = {}): TLShapeId[] {
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
		const positions = layoutPlan(plan, existingBoxes, (type) => approxNodeSize(editor, type))

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
