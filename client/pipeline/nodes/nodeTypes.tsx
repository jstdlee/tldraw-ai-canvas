import { Editor, useEditor } from 'tldraw'
import {
	NODE_FOOTER_HEIGHT_PX,
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_BOTTOM_PADDING_PX,
	NODE_ROW_HEADER_GAP_PX,
} from '../constants'
import { PortId, ShapePort } from '../ports/Port'
import type { NodeShape } from './NodeShapeUtil'
import {
	getNodeDefinition as getNodeDefinitionFromStore,
	getNodeDefinitions as getNodeDefinitionsFromStore,
} from './definitionStore'
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

export function getNodeTypePorts(editor: Editor, shape: NodeShape): Record<string, ShapePort> {
	const ports = getNodeDefinition(editor, shape.props.node).getPorts(shape, shape.props.node)
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
	return await getNodeDefinition(editor, shape.props.node).execute(shape, shape.props.node, inputs)
}

export function getNodeOutputInfo(
	editor: Editor,
	shape: NodeShape,
	inputs: InfoValues
): InfoValues {
	return getNodeDefinition(editor, shape.props.node).getOutputInfo(shape, shape.props.node, inputs)
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
