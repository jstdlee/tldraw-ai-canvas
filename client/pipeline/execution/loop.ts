import { Editor, TLShapeId } from 'tldraw'
import { getNodePortConnections } from '../nodes/nodePorts'
import { PipelineValue, STOP_EXECUTION } from '../nodes/types/shared'
import { ExecutionGraph } from './ExecutionGraph'
import { nodeRunState } from './nodeRunState'

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

/** The nodes that form the loop body for one output port (used to clear stale run state). */
export function loopBodyNodes(editor: Editor, nodeId: TLShapeId, itemPort: string): Set<TLShapeId> {
	return downstreamFrom(editor, nodeId, itemPort)
}

export interface LoopItemResult {
	/** What reached the result port (null when nothing did). */
	value: string | null
	/** A body node's error message, when one failed this item. */
	error?: string
}

/**
 * Run a loop body once: feed `value` into everything wired to `itemPort`, run
 * the body, and report what reaches the node's `resultPort` (or null). A body
 * node that failed is reported, never silently passed the item through.
 */
export async function runLoopBody(
	editor: Editor,
	nodeId: TLShapeId,
	itemPort: string,
	resultPort: string,
	value: PipelineValue
): Promise<LoopItemResult> {
	const connections = getNodePortConnections(editor, nodeId)
	const itemLinks = connections.filter((c) => c.terminal === 'start' && c.ownPortId === itemPort)
	const resultLink = connections.find((c) => c.terminal === 'end' && c.ownPortId === resultPort)
	if (!itemLinks.length) return { value: value == null ? null : String(value) }

	const body = downstreamFrom(editor, nodeId, itemPort)
	const overrides = new Map<string, PipelineValue>(
		itemLinks.map((c) => [`${c.connectedShapeId}|${c.connectedPortId}`, value])
	)
	const graph = new ExecutionGraph(editor, new Set(itemLinks.map((c) => c.connectedShapeId)), {
		allowed: body,
		overrides,
	})
	await graph.execute()
	// A failed body node stops the loop: report the first error it left behind.
	const runs = nodeRunState.get(editor)
	for (const id of body) {
		const run = runs[id]
		if (run?.status === 'error') return { value: null, error: run.message ?? 'A node in the loop failed' }
	}
	if (!resultLink) return { value: value == null ? null : String(value) }
	const out = graph.getOutputs(resultLink.connectedShapeId)?.[resultLink.connectedPortId]
	return { value: out == null || out === STOP_EXECUTION ? null : String(out) }
}
