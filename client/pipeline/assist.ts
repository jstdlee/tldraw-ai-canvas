import { atom, Editor, TLShapeId } from 'tldraw'
import { validateProps } from '../../shared/aiPlan'
import { extractJsonObject } from '../../shared/nodeAssist'
import { NodeSpec, NODE_SPECS, nodeSpecText } from '../../shared/nodeSpecs'
import { describeCanvasNode, nodeAssistContext } from './aiContext'
import { apiGenerateText } from './api/pipelineApi'
import { NodeShape } from './nodes/NodeShapeUtil'

/** Per-node AI card: which node it is open for. */
export const $assist = atom<{ shapeId: TLShapeId } | null>('node assist', null)

/** Answer text for a selection that is not a node (kept for other Ask/Explain dialogs). */
export const $aiNote = atom<string | null>('ai note', null)

/**
 * Draft text per node, so closing the AI-star card and reopening it brings back
 * what you were typing. Keyed by shape id.
 */
export const $assistDrafts = atom<Record<string, string>>('assist drafts', {})

export function assistDraft(shapeId: TLShapeId): string {
	return $assistDrafts.get()[shapeId] ?? ''
}

export function setAssistDraft(shapeId: TLShapeId, text: string) {
	$assistDrafts.update((drafts) => {
		const next = { ...drafts }
		if (text) next[shapeId] = text
		else delete next[shapeId]
		return next
	})
}

export function openFillAssist(shapeId: TLShapeId, options?: { error?: string }) {
	const error = options?.error?.trim()
	if (error) setAssistDraft(shapeId, `Fix this error: ${error}`)
	$assist.set({ shapeId })
}

export function closeFillAssist() {
	$assist.set(null)
}

export interface NodeAssistChange {
	key: string
	label: string
	before: unknown
	after: unknown
}

export interface NodeAssistNeed {
	type: string
	why: string
}

export interface NodeAssistResult {
	say: string
	changes: NodeAssistChange[]
	needs: NodeAssistNeed[]
	errors: string[]
}

function asRecord(value: unknown): Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function parseNodeAssistReply(text: string): { say: string; props: Record<string, unknown>; needs: NodeAssistNeed[] } {
	const record = asRecord(extractJsonObject(text))
	const say = typeof record.say === 'string' ? record.say : ''
	const props = asRecord(record.props)
	const needs = (Array.isArray(record.needs) ? record.needs : []).flatMap((item) => {
		const r = asRecord(item)
		return typeof r.type === 'string' ? [{ type: r.type, why: typeof r.why === 'string' ? r.why : '' }] : []
	})
	return { say, props, needs }
}

function buildSystemPrompt(spec: NodeSpec): string {
	const rules = spec.assistant.rules?.length ? `\nRules:\n${spec.assistant.rules.map((r) => `- ${r}`).join('\n')}` : ''
	return [
		spec.assistant.role,
		rules,
		'',
		nodeSpecText(spec.type),
		'',
		'Reply with JSON only, in this shape:',
		'{"say":"one or two sentences","props":{"<field>":<value>},"needs":[{"type":"<node type>","why":"…"}]}',
		'props holds only the fields you are changing, using the field kinds, enum values and ports above.',
		'needs lists upstream/downstream node types this node cannot do alone on its own; it may be empty.',
		'Never invent a field or an enum value that is not listed above.',
	]
		.filter(Boolean)
		.join('\n')
}

function describeNodeForPrompt(editor: Editor, shape: NodeShape) {
	const ctx = describeCanvasNode(editor, shape)
	return JSON.stringify(
		{
			props: ctx.props,
			wiredInputs: ctx.wiredInputs,
			inputSamples: ctx.inputSamples,
			outputSample: ctx.outputSample,
			error: ctx.error,
		},
		null,
		2
	)
}

/** The node's own AI specialist: reads the node's spec + current state, proposes field changes. Does not apply them. */
export async function runNodeAssist(
	editor: Editor,
	shapeId: TLShapeId,
	request: string,
	opts: { model?: string } = {}
): Promise<NodeAssistResult> {
	const shape = editor.getShape(shapeId)
	if (!shape || shape.type !== 'node') throw new Error('Select a node')
	const nodeShape = shape as NodeShape
	const node = nodeShape.props.node as unknown as Record<string, unknown>
	const type = String(node.type)
	const spec = NODE_SPECS[type]
	if (!spec) throw new Error(`No AI specialist for node type "${type}"`)

	const system = buildSystemPrompt(spec)
	const extra = nodeAssistContext(editor, nodeShape)
	const userBase = [
		request,
		'',
		'This node now:',
		describeNodeForPrompt(editor, nodeShape),
		extra ? `\n${extra}` : '',
	]
		.filter(Boolean)
		.join('\n')

	const call = (prompt: string) =>
		apiGenerateText({ system, prompt, model: opts.model, capability: 'chat', temperature: 0.2 })

	const first = await call(userBase)
	let reply = parseNodeAssistReply(first.text)
	let errors: string[] = []
	let cleanProps = validateProps(type, reply.props, NODE_SPECS, errors, 'props')

	if (errors.length) {
		const retryPrompt = `${userBase}\n\nYour last reply had these problems:\n${errors
			.map((e) => `- ${e}`)
			.join('\n')}\nReturn corrected JSON in the same shape, fixing only those problems.`
		const second = await call(retryPrompt)
		reply = parseNodeAssistReply(second.text)
		const retryErrors: string[] = []
		cleanProps = validateProps(type, reply.props, NODE_SPECS, retryErrors, 'props')
		errors = retryErrors
	}

	const fieldsByKey = new Map(spec.fields.map((f) => [f.key, f]))
	const changes: NodeAssistChange[] = Object.entries(cleanProps)
		.filter(([key, value]) => node[key] !== value)
		.map(([key, value]) => ({ key, label: fieldsByKey.get(key)?.label ?? key, before: node[key] ?? null, after: value }))

	const needs = reply.needs.filter((need) => NODE_SPECS[need.type] && !NODE_SPECS[need.type].hidden)

	return { say: reply.say, changes, needs, errors }
}

/** Apply changes proposed by runNodeAssist, as one history step. */
export function applyNodeAssistChanges(editor: Editor, shapeId: TLShapeId, changes: NodeAssistChange[]) {
	if (!changes.length) return
	const shape = editor.getShape(shapeId)
	if (!shape || shape.type !== 'node') return
	const nodeShape = shape as NodeShape
	editor.markHistoryStoppingPoint('ai node')
	const patch = Object.fromEntries(changes.map((c) => [c.key, c.after]))
	editor.updateShape<NodeShape>({
		id: shapeId,
		type: 'node',
		props: { node: { ...nodeShape.props.node, ...patch } as NodeShape['props']['node'], isOutOfDate: true },
	})
}
