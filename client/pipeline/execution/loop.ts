import { Editor, TLShapeId } from 'tldraw'
import { getNodePortConnections } from '../nodes/nodePorts'
import { PipelineValue, STOP_EXECUTION } from '../nodes/types/shared'
import { ExecutionGraph } from './ExecutionGraph'
import { currentRunSignal } from './executionState'
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
 * Run a loop body once, feeding one value into each of several item ports at the same time
 * (WP35: "For each over table rows" feeds the whole row into `item` and each column's own cell
 * into its `row:<column>` port, in the same iteration), and report what reaches the node's
 * `resultPort` (or null). A body node that failed is reported, never silently passed the item
 * through. `runLoopBody` below is the single-port case every other For each mode uses.
 */
export async function runLoopBodyPorts(
	editor: Editor,
	nodeId: TLShapeId,
	itemPorts: Record<string, PipelineValue>,
	resultPort: string
): Promise<LoopItemResult> {
	// Stop may land between the loop's own generation check and this call; the body's own
	// cards would see the same signal already aborted and stop there, but checking here too
	// avoids starting a body graph at all for an item that will not get to run anything.
	if (currentRunSignal(editor)?.aborted) return { value: null }
	const connections = getNodePortConnections(editor, nodeId)
	const resultLink = connections.find((c) => c.terminal === 'end' && c.ownPortId === resultPort)
	const primaryValue = Object.values(itemPorts)[0] ?? null

	const overrides = new Map<string, PipelineValue>()
	const roots = new Set<TLShapeId>()
	for (const [port, value] of Object.entries(itemPorts)) {
		for (const c of connections) {
			if (c.terminal !== 'start' || c.ownPortId !== port) continue
			overrides.set(`${c.connectedShapeId}|${c.connectedPortId}`, value)
			roots.add(c.connectedShapeId)
		}
	}
	if (!roots.size) return { value: primaryValue == null ? null : String(primaryValue) }

	const body = new Set<TLShapeId>()
	for (const port of Object.keys(itemPorts)) for (const id of downstreamFrom(editor, nodeId, port)) body.add(id)
	const graph = new ExecutionGraph(editor, roots, { allowed: body, overrides })
	await graph.execute()
	// A failed body node stops the loop: report the first error it left behind.
	const runs = nodeRunState.get(editor)
	for (const id of body) {
		const run = runs[id]
		if (run?.status === 'error') return { value: null, error: run.message ?? 'A node in the loop failed' }
	}
	if (!resultLink) return { value: primaryValue == null ? null : String(primaryValue) }
	const out = graph.getOutputs(resultLink.connectedShapeId)?.[resultLink.connectedPortId]
	return { value: out == null || out === STOP_EXECUTION ? null : String(out) }
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
	return runLoopBodyPorts(editor, nodeId, { [itemPort]: value }, resultPort)
}
