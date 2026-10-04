import { createShapeId, Editor, TLShape, TLShapeId } from 'tldraw'
import { createOrUpdateConnectionBinding, getConnectionBindings } from './connection/ConnectionBindingUtil'
import { ConnectionShape } from './connection/ConnectionShapeUtil'
import { getNodePortConnections, getNodePorts } from './nodes/nodePorts'
import { NodeShape } from './nodes/NodeShapeUtil'
import { getNodeDefinition } from './nodes/nodeTypes'
import type { SubgraphNode, SubgraphPort } from './nodes/types/SubgraphNode'
import { storeBlob } from './imageOps'

/**
 * Pack: turn a selection into one "packed" node (like a ComfyUI group node).
 * Inner shapes stay in the document but are hidden (meta.packedIn); wires from
 * outside are moved onto the packed node's ports. Unpack reverses it.
 */

export function isPacked(shape: TLShape) {
	return typeof shape.meta?.packedIn === 'string'
}

/**
 * Show shapes whose packed node no longer exists (e.g. it was deleted), so
 * nothing stays invisible by accident.
 */
export function releaseOrphanedPackedShapes(editor: Editor) {
	const orphans = editor
		.getCurrentPageShapes()
		.filter((s) => isPacked(s) && !editor.getShape(s.meta.packedIn as TLShapeId))
	if (!orphans.length) return
	editor.updateShapes(orphans.map((s) => ({ id: s.id, type: s.type, meta: { ...s.meta, packedIn: null } })))
}

/** Keep that true while editing: deleting a packed node releases its shapes. */
export function watchPackedNodes(editor: Editor) {
	releaseOrphanedPackedShapes(editor)
	return editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
		if (shape.type === 'node' && (shape.props as { node?: { type?: string } }).node?.type === 'subgraph') {
			queueMicrotask(() => releaseOrphanedPackedShapes(editor))
		}
	})
}

function portLabel(editor: Editor, node: NodeShape, portId: string) {
	const title = getNodeDefinition(editor, node.props.node).heading ?? getNodeDefinition(editor, node.props.node).title
	return portId === 'output' || portId === 'input' ? title : `${title} · ${portId}`
}

export async function packSelection(editor: Editor): Promise<TLShapeId | null> {
	const selected = editor.getSelectedShapes().filter((s) => !isPacked(s))
	const nodeIds = new Set(selected.filter((s) => s.type === 'node').map((s) => s.id))
	if (nodeIds.size < 1) return null

	// Wires between selected nodes go inside; wires that cross the boundary get re-routed.
	const inner = new Set<TLShapeId>(selected.map((s) => s.id))
	for (const id of nodeIds) {
		for (const c of getNodePortConnections(editor, id)) {
			if (nodeIds.has(c.connectedShapeId)) inner.add(c.connectionId)
		}
	}

	const inputs: SubgraphPort[] = []
	const outputs: SubgraphPort[] = []
	const rewires: { connectionId: TLShapeId; terminal: 'start' | 'end'; portId: string }[] = []

	for (const id of nodeIds) {
		const node = editor.getShape<NodeShape>(id)!
		const ports = getNodePorts(editor, node)
		for (const c of getNodePortConnections(editor, id)) {
			if (nodeIds.has(c.connectedShapeId)) continue
			const list = c.terminal === 'end' ? inputs : outputs
			let port = list.find((p) => p.nodeId === id && p.portId === c.ownPortId)
			if (!port) {
				port = {
					id: c.terminal === 'end' ? `in${inputs.length}` : outputs.length === 0 ? 'output' : `out${outputs.length}`,
					label: portLabel(editor, node, c.ownPortId),
					dataType: ports[c.ownPortId]?.dataType ?? 'any',
					nodeId: id,
					portId: c.ownPortId,
				}
				list.push(port)
			}
			rewires.push({ connectionId: c.connectionId, terminal: c.terminal, portId: port.id })
		}
	}

	// Nothing wired out yet: expose the outputs of the last nodes in the chain.
	if (outputs.length === 0) {
		for (const id of nodeIds) {
			const hasInnerDependents = getNodePortConnections(editor, id).some(
				(c) => c.terminal === 'start' && nodeIds.has(c.connectedShapeId)
			)
			const node = editor.getShape<NodeShape>(id)!
			const out = Object.values(getNodePorts(editor, node)).find((p) => p.terminal === 'start')
			if (!hasInnerDependents && out && outputs.length < 3) {
				outputs.push({
					id: outputs.length === 0 ? 'output' : `out${outputs.length}`,
					label: portLabel(editor, node, out.id),
					dataType: out.dataType,
					nodeId: id,
					portId: out.id,
				})
			}
		}
	}

	const ids = [...inner]
	const bounds = editor.getSelectionPageBounds()!
	let thumbnail: string | null = null
	try {
		const { blob } = await editor.toImage(ids, { format: 'png', background: true, scale: 0.5, padding: 8 })
		thumbnail = await storeBlob(blob)
	} catch {
		// A pack without a picture still works.
	}

	const proxyId = createShapeId()
	const node: SubgraphNode = {
		type: 'subgraph',
		title: `Packed (${nodeIds.size} nodes)`,
		innerIds: ids,
		inputs,
		outputs,
		thumbnail,
		lastOutputs: null,
		error: null,
	}
	editor.run(() => {
		editor.markHistoryStoppingPoint('pack')
		editor.createShape({ id: proxyId, type: 'node', x: bounds.minX, y: bounds.minY, props: { node, isOutOfDate: true } })
		for (const r of rewires) {
			const binding = getConnectionBindings(editor, r.connectionId)[r.terminal]
			createOrUpdateConnectionBinding(editor, r.connectionId, proxyId, {
				portId: r.portId,
				terminal: r.terminal,
				order: binding?.props.order,
			})
		}
		editor.updateShapes(
			ids.map((id) => {
				const shape = editor.getShape(id)!
				return { id, type: shape.type, meta: { ...shape.meta, packedIn: proxyId } }
			})
		)
		editor.select(proxyId)
	})
	return proxyId
}

export function unpack(editor: Editor, proxyId: TLShapeId) {
	const proxy = editor.getShape<NodeShape>(proxyId)
	if (!proxy || proxy.props.node.type !== 'subgraph') return
	const node = proxy.props.node as SubgraphNode
	const byPort = new Map([...node.inputs, ...node.outputs].map((p) => [p.id, p]))
	editor.run(() => {
		editor.markHistoryStoppingPoint('unpack')
		// Unhide first so wires can bind to the inner nodes again.
		const ids = node.innerIds.filter((id) => editor.getShape(id as TLShapeId)) as TLShapeId[]
		editor.updateShapes(
			ids.map((id) => {
				const shape = editor.getShape(id)!
				// meta updates merge, so the key must be set to null (not left out).
				return { id, type: shape.type, meta: { ...shape.meta, packedIn: null } }
			})
		)
		for (const c of getNodePortConnections(editor, proxyId)) {
			const target = byPort.get(c.ownPortId)
			if (!target || !editor.getShape(target.nodeId as TLShapeId)) continue
			const binding = getConnectionBindings(editor, c.connectionId as ConnectionShape['id'])[c.terminal]
			createOrUpdateConnectionBinding(editor, c.connectionId, target.nodeId as TLShapeId, {
				portId: target.portId,
				terminal: c.terminal,
				order: binding?.props.order,
			})
		}
		editor.deleteShape(proxyId)
		editor.select(...ids)
	})
}
