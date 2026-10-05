import { createBindingId, createShapeId, Editor, TLShapeId, VecModel } from 'tldraw'
import { CanvasExample } from '../../shared/examples'
import { getNodeDefinition } from './nodes/nodeTypes'
import { NodeType } from './nodes/nodeTypes'

/** Stamp an example workflow at a page point. */
export function loadExample(editor: Editor, example: CanvasExample, origin: VecModel) {
	const ids = new Map<string, TLShapeId>()
	editor.markHistoryStoppingPoint('load example')
	editor.run(() => {
		for (const node of example.nodes) {
			const id = createShapeId()
			ids.set(node.id, id)
			let props: NodeType
			try {
				const base = getNodeDefinition(editor, node.type as NodeType['type']).getDefault()
				props = { ...base, ...(node.props ?? {}), type: node.type } as NodeType
			} catch {
				continue
			}
			editor.createShape({
				id,
				type: 'node',
				x: origin.x + node.x,
				y: origin.y + node.y,
				props: { node: props },
			})
		}
		for (const wire of example.wires) {
			const fromId = ids.get(wire.from)
			const toId = ids.get(wire.to)
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
		editor.select(...[...ids.values()])
	})
}
