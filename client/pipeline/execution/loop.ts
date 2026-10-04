import { Editor, TLShapeId } from 'tldraw'
import { getNodePortConnections } from '../nodes/nodePorts'
import { PipelineValue, STOP_EXECUTION } from '../nodes/types/shared'
import { ExecutionGraph } from './ExecutionGraph'

/** All nodes reachable downstream from one output port of a node (not the node itself). */
export function downstreamFrom(editor: Editor, nodeId: TLShapeId, portId: string): Set<TLShapeId> {
	const found = new Set<TLShapeId>()
	const start = getNodePortConnections(editor, nodeId)
		.filter((c) => c.terminal === 'start' && c.ownPortId === portId)
		.map((c) => c.connectedShapeId)
	const toVisit = [...start]
	while (toVisit.length) {
		const id = toVisit.pop()!
		if (id === nodeId || found.has(id)) continue
		found.add(id)
		for (const c of getNodePortConnections(editor, id)) {
			if (c.terminal === 'start') toVisit.push(c.connectedShapeId)
		}
	}
	return found
}

/**
 * Run a loop body once: feed `value` into everything wired to `itemPort`, run
 * the body, and return what reaches the node's `resultPort` (or null).
 */
export async function runLoopBody(
	editor: Editor,
	nodeId: TLShapeId,
	itemPort: string,
	resultPort: string,
	value: PipelineValue
): Promise<string | null> {
	const connections = getNodePortConnections(editor, nodeId)
	const itemLinks = connections.filter((c) => c.terminal === 'start' && c.ownPortId === itemPort)
	const resultLink = connections.find((c) => c.terminal === 'end' && c.ownPortId === resultPort)
	if (!itemLinks.length) return value == null ? null : String(value)

	const body = downstreamFrom(editor, nodeId, itemPort)
	const overrides = new Map<string, PipelineValue>(
		itemLinks.map((c) => [`${c.connectedShapeId}|${c.connectedPortId}`, value])
	)
	const graph = new ExecutionGraph(editor, new Set(itemLinks.map((c) => c.connectedShapeId)), {
		allowed: body,
		overrides,
	})
	await graph.execute()
	if (!resultLink) return value == null ? null : String(value)
	const out = graph.getOutputs(resultLink.connectedShapeId)?.[resultLink.connectedPortId]
	return out == null || out === STOP_EXECUTION ? null : String(out)
}
