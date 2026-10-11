import { Editor, TLShapeId } from 'tldraw'
import { getNodeOutputPortInfo, getNodePortConnections, getNodePorts } from '../nodes/nodePorts'
import { UpstreamGraph, upstreamOrder } from '../../../shared/upstreamOrder'

/**
 * Every out-of-date card upstream of `targetIds` (not including the targets
 * themselves), earliest dependency first. A card's own `isOutOfDate` flag
 * and the cascaded `isOutOfDate` on its output ports (`nodePorts.tsx`)
 * already capture "stale, or an ancestor is stale" without re-walking the
 * whole canvas by hand, so this only has to ask each ancestor once.
 */
export function staleUpstreamOrder(editor: Editor, targetIds: Iterable<TLShapeId>): TLShapeId[] {
	const graph: UpstreamGraph = {}

	function build(id: TLShapeId) {
		if (graph[id]) return
		const shape = editor.getShape(id)
		if (!shape || !editor.isShapeOfType(shape, 'node')) return
		const ports = getNodePorts(editor, id)
		const dependsOn = getNodePortConnections(editor, id)
			.filter((c) => c.terminal === 'end' && !ports[c.ownPortId]?.feedback)
			.map((c) => c.connectedShapeId)
		const outputs = getNodeOutputPortInfo(editor, id)
		// A card that never ran has no output yet: it counts as stale too (new cards start
		// with isOutOfDate false).
		const values = Object.values(outputs)
		const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0)
		const neverRan = values.length > 0 && values.every((o) => empty(o.value))
		const outOfDate = !!shape.props.isOutOfDate || neverRan || values.some((o) => o.isOutOfDate)
		// Set before recursing: a cycle (e.g. an unguarded loop-back) then just stops here.
		graph[id] = { dependsOn, outOfDate }
		for (const dep of dependsOn) build(dep)
	}

	const order: TLShapeId[] = []
	const seen = new Set<TLShapeId>()
	for (const target of targetIds) {
		build(target)
		for (const id of upstreamOrder(graph, target)) {
			if (seen.has(id as TLShapeId)) continue
			seen.add(id as TLShapeId)
			order.push(id as TLShapeId)
		}
	}
	return order
}
