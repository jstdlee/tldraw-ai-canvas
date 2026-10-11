/**
 * Pure graph helper for WP14 Part A (Run pulls stale upstream cards).
 *
 * Each node already knows whether it is out of date (its own `isOutOfDate`
 * flag, or an out-of-date input cascaded in by the caller). This walks
 * upstream from a target and returns the out-of-date ancestors in
 * dependency order (run the earliest dependency first). An ancestor that is
 * already up to date is left alone: its stored output is used, and the
 * search does not continue past it.
 */

export interface UpstreamGraphNode {
	/** Ids of the nodes that directly feed this node's inputs. */
	dependsOn: string[]
	/** This node's own card is stale, or reading its inputs would see a stale value. */
	outOfDate: boolean
}

export type UpstreamGraph = Record<string, UpstreamGraphNode>

/**
 * The out-of-date nodes upstream of `target` (not including `target`
 * itself), earliest dependency first. Guards against a cycle (e.g. a
 * loop-back wire the caller forgot to exclude) by never revisiting a node
 * that is already on the current path.
 */
export function upstreamOrder(graph: UpstreamGraph, target: string): string[] {
	const order: string[] = []
	const done = new Set<string>()
	const visiting = new Set<string>()

	function visit(id: string) {
		if (done.has(id) || visiting.has(id)) return
		const node = graph[id]
		if (!node) return
		if (!node.outOfDate) {
			// Trusted as-is: don't re-run it, and don't look further upstream of it.
			done.add(id)
			return
		}
		visiting.add(id)
		for (const dep of node.dependsOn) visit(dep)
		visiting.delete(id)
		done.add(id)
		order.push(id)
	}

	const targetNode = graph[target]
	if (!targetNode) return []
	for (const dep of targetNode.dependsOn) visit(dep)
	return order
}
