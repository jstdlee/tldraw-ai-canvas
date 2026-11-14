import { Editor, TLShapeId } from 'tldraw'
import type { PipelineValue } from '../nodes/types/shared'

/**
 * WP45: the values a running loop is feeding into its body right now, keyed
 * `${loopNodeId}|${portId}` (e.g. a For each's current `item`). A nested loop runs its own
 * body in a fresh child graph that does not contain the outer loop card, so a body card that
 * reads the OUTER loop's `item` would otherwise see that card's idle output (STOP) and never
 * run. The engine reads these live values first. Kept in its own file so ExecutionGraph and
 * loop.ts can both import it without a cycle.
 */
const live = new WeakMap<Editor, Map<string, PipelineValue>>()

function mapFor(editor: Editor) {
	let map = live.get(editor)
	if (!map) {
		map = new Map()
		live.set(editor, map)
	}
	return map
}

export function liveLoopValue(editor: Editor, nodeId: TLShapeId, portId: string): PipelineValue | undefined {
	return live.get(editor)?.get(`${nodeId}|${portId}`)
}

/** Publish a loop's current port values while `run` runs, then remove them. */
export async function withLiveLoopValues<T>(
	editor: Editor,
	nodeId: TLShapeId,
	values: Record<string, PipelineValue>,
	run: () => Promise<T>
): Promise<T> {
	const map = mapFor(editor)
	const keys = Object.keys(values).map((port) => `${nodeId}|${port}`)
	const previous = keys.map((key) => map.get(key))
	Object.entries(values).forEach(([port, value]) => map.set(`${nodeId}|${port}`, value))
	try {
		return await run()
	} finally {
		keys.forEach((key, i) => {
			if (previous[i] === undefined) map.delete(key)
			else map.set(key, previous[i]!)
		})
	}
}
