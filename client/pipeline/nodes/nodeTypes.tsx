import { Editor, useEditor } from 'tldraw'
import { wirableFieldsFor, fieldPortId, fieldPortDataType } from '../../../shared/fieldOverrides'
import { layoutPorts, PortCandidate } from '../../../shared/fieldPortLayout'
import {
	NODE_FOOTER_HEIGHT_PX,
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_BOTTOM_PADDING_PX,
	NODE_ROW_HEADER_GAP_PX,
} from '../constants'
import { getFieldPortAnchors } from '../ports/fieldAnchors'
import { PortId, ShapePort } from '../ports/Port'
import { applyFieldOverrides, applyFieldOverridesInfo } from './fieldOverrides'
import { hiddenDedicatedPortIds, hiddenFieldKeys } from './fieldVisibility'
import type { NodeShape } from './NodeShapeUtil'
import {
	getNodeDefinition as getNodeDefinitionFromStore,
	getNodeDefinitions as getNodeDefinitionsFromStore,
} from './definitionStore'
import { isInputWired } from './portWiring'
import type { NodeType } from './registry'
import { ExecutionResult, InfoValues, NodeDefinition } from './types/shared'

// The node type registry itself (every node definition, and the `NodeType` validator union
// built from them) lives in `registry.ts`, which is the file that imports every `types/*.tsx`
// file. This module only takes a *type-only* import of `NodeType` from there (erased at build,
// so it cannot close a runtime cycle), plus the lookup functions from the leaf module
// `definitionStore.ts`. That keeps this file, and everything that imports it (`nodePorts.tsx`,
// `subgraph.ts`, individual node type files, …), out of the cycle back through `registry.ts` —
// see `registry.ts`'s own comment for why that matters for Vite hot reload.
export type { NodeType } from './registry'

export function getNodeDefinitions(editor: Editor): Record<string, NodeDefinition<NodeType>> {
	return getNodeDefinitionsFromStore<NodeType>(editor)
}

export function getNodeDefinition(
	editor: Editor,
	node: NodeType | NodeType['type']
): NodeDefinition<NodeType> {
	return getNodeDefinitionFromStore<NodeType>(editor, node)
}

/** Whether an unconnected output should be spilled onto the canvas, given the node's spill mode. */
export function shouldSpillOutput(editor: Editor, shape: NodeShape): boolean {
	const mode = shape.props.spill ?? 'auto'
	if (mode === 'always') return true
	if (mode === 'never') return false
	return !getNodeDefinition(editor, shape.props.node).showsOutput
}

/** The node's own width, before the user resized it. */
export function getNodeBaseWidthPx(editor: Editor, shape: NodeShape): number {
	return getNodeDefinition(editor, shape.props.node).getWidthPx(shape, shape.props.node)
}

export function getNodeWidthPx(editor: Editor, shape: NodeShape): number {
	const base = getNodeBaseWidthPx(editor, shape)
	return shape.props.w ? Math.max(shape.props.w, 200) : base
}

export function getNodeBodyHeightPx(editor: Editor, shape: NodeShape): number {
	if (shape.props.collapsed) return 0
	return (
		getNodeDefinition(editor, shape.props.node).getBodyHeightPx(shape, shape.props.node) +
		(shape.props.extraH ?? 0)
	)
}

export function getNodeHeightPx(editor: Editor, shape: NodeShape): number {
	if (shape.props.collapsed) return NODE_HEADER_HEIGHT_PX + NODE_FOOTER_HEIGHT_PX
	return (
		NODE_HEADER_HEIGHT_PX +
		NODE_ROW_HEADER_GAP_PX +
		getNodeBodyHeightPx(editor, shape) +
		NODE_ROW_BOTTOM_PADDING_PX +
		NODE_FOOTER_HEIGHT_PX
	)
}

// Dev-only: shape:field pairs already warned about missing a field-port anchor (see below).
const warnedMissingFieldAnchors = new Set<string>()

export function getNodeTypePorts(editor: Editor, shape: NodeShape): Record<string, ShapePort> {
	const node = shape.props.node
	const dedicated = getNodeDefinition(editor, node).getPorts(shape, node)
	const anchors = getFieldPortAnchors(editor, shape.id)
	const headerY = NODE_HEADER_HEIGHT_PX / 2

	// WP17 follow-up: every input port — dedicated ones too — takes its y from its row's
	// measured anchor when one is registered; the hand-coded y from getPorts() is only the
	// fallback before that row has ever mounted. A port whose row isn't part of the current
	// render (a conditional field, or a conditionally-unused dedicated port like DataPipe's
	// "extra") is dropped, unless it's already wired — then it's kept near the header so the
	// wire doesn't dangle.
	const hiddenDedicated = hiddenDedicatedPortIds(node)
	const hiddenFields = hiddenFieldKeys(node)
	const wirable = wirableFieldsFor(node as { type: string } & Record<string, unknown>)

	const candidates: PortCandidate[] = [
		...Object.values(dedicated).map((port): PortCandidate => {
			if (port.terminal !== 'end' || !hiddenDedicated.has(port.id)) return port
			return { ...port, hidden: true, wired: isInputWired(editor, shape.id, port.id) }
		}),
		...wirable.map((field): PortCandidate => {
			const id = fieldPortId(field.key)
			const base: PortCandidate = {
				id,
				x: 0,
				y: headerY,
				terminal: 'end',
				dataType: fieldPortDataType(field.kind),
				anchorKey: field.key,
			}
			if (!hiddenFields.has(field.key)) return base
			return { ...base, hidden: true, wired: isInputWired(editor, shape.id, id) }
		}),
	]
	const ports = layoutPorts(candidates, anchors, headerY) as Record<string, ShapePort>

	// Dev check: a rendered (non-hidden) port — dedicated or field — with no measured anchor
	// means its row never registered one (missing PortRow/NodeInputRow/WireField, or a
	// useFieldPortAnchor ref). Warns once per shape+key so the console stays readable.
	if (import.meta.env?.DEV && !shape.props.collapsed) {
		// Rows register their anchors in a layout effect after the first render, so check
		// again a moment later and only warn if the anchor is still missing.
		const warnOnce = (key: string, message: string) => {
			const warnKey = `${shape.id}:${key}`
			if (warnedMissingFieldAnchors.has(warnKey)) return
			warnedMissingFieldAnchors.add(warnKey)
			setTimeout(() => {
				const current = editor.getShape(shape.id)
				if (!current || (current as NodeShape).props.collapsed) return
				if (getFieldPortAnchors(editor, shape.id)?.[key] !== undefined) {
					warnedMissingFieldAnchors.delete(warnKey)
					return
				}
				console.warn(message)
			}, 2000)
		}
		for (const port of Object.values(dedicated)) {
			if (port.terminal !== 'end' || hiddenDedicated.has(port.id)) continue
			// `system`/`params` (llmSettings.tsx): while "Model settings" is closed, these two
			// stack on the toggle row by hand-coded math (llmSettingsPorts), not an anchor — a
			// deliberate alternative to a PortRow, not a gap.
			if (port.id === 'system' || port.id === 'params') continue
			// Placed by hand on purpose: DataPipe's data port sits on the first row, and the
			// Generate image prompt port on the first line of the prompt box.
			if ((node.type === 'table' && port.id === 'data') || (node.type === 'image_gen' && port.id === 'prompt')) continue
			if (anchors?.[port.id] === undefined) {
				warnOnce(
					port.id,
					`[WP17] "${port.id}" on a "${node.type}" card has no port anchor — its row never ` +
						`registered one (PortRow/NodeInputRow, or a useFieldPortAnchor ref).`
				)
			}
		}
		for (const field of wirable) {
			if (hiddenFields.has(field.key)) continue
			if (anchors?.[field.key] === undefined) {
				warnOnce(
					field.key,
					`[WP17] "${field.key}" on a "${node.type}" card has no field-port anchor — ` +
						`its port is stuck on the header row. Wrap its control in WireField/WireFieldHeader.`
				)
			}
		}
	}
	const baseW = getNodeBaseWidthPx(editor, shape)
	const w = getNodeWidthPx(editor, shape)
	const list = Object.values(ports)
	if (shape.props.collapsed) {
		// Collapsed: spread the ports over the header + footer strip, inputs left, outputs right.
		const h = NODE_HEADER_HEIGHT_PX + NODE_FOOTER_HEIGHT_PX
		const place = (side: ShapePort[], x: number) =>
			side.map((p, i) => [p.id, { ...p, x, y: (h * (i + 1)) / (side.length + 1) }] as const)
		return Object.fromEntries([
			...place(list.filter((p) => p.terminal === 'end'), 0),
			...place(list.filter((p) => p.terminal === 'start'), w),
		])
	}
	if (w === baseW) return ports
	// Resized: keep output ports on the right edge.
	return Object.fromEntries(
		list.map((p) => [p.id, p.x >= baseW - 1 ? { ...p, x: w } : p])
	)
}

export async function executeNode(
	editor: Editor,
	shape: NodeShape,
	inputs: Record<string, string | number | null | (string | number | null)[]>
): Promise<ExecutionResult> {
	// WP17: wired field ports override the node's own fields before it runs.
	const node = applyFieldOverrides(shape, inputs)
	return await getNodeDefinition(editor, node).execute(shape, node, inputs)
}

export function getNodeOutputInfo(
	editor: Editor,
	shape: NodeShape,
	inputs: InfoValues
): InfoValues {
	const node = applyFieldOverridesInfo(shape, inputs)
	return getNodeDefinition(editor, node).getOutputInfo(shape, node, inputs)
}

export function onNodePortConnect(editor: Editor, shape: NodeShape, port: PortId) {
	getNodeDefinition(editor, shape.props.node).onPortConnect?.(shape, shape.props.node, port)
}

export function onNodePortDisconnect(editor: Editor, shape: NodeShape, port: PortId) {
	getNodeDefinition(editor, shape.props.node).onPortDisconnect?.(shape, shape.props.node, port)
}

export function NodeBody({ shape }: { shape: NodeShape }) {
	const editor = useEditor()
	const node = shape.props.node
	if (shape.props.collapsed) return null
	const { Component } = getNodeDefinition(editor, node)
	return (
		<div className="NodeBody" style={{ height: getNodeBodyHeightPx(editor, shape) }}>
			<Component shape={shape} node={node} />
		</div>
	)
}
