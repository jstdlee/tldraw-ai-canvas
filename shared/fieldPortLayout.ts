/**
 * Pure port-map layout for WP17 (every card parameter can be wired): positions every input
 * port — dedicated ones (`url`, `data`, `sql`, `model`, …) and `field:<key>` ones alike — at
 * its row's measured anchor, falling back to its hand-coded y only before that row has ever
 * mounted. A port whose row isn't rendered in the current state is dropped entirely, unless a
 * wire is already connected to it — then it's kept, stacked near the nearest visible anchor so
 * it never shares a point with another port. No tldraw import — testable in Node. See
 * `client/pipeline/nodes/nodeTypes.tsx` (`getNodeTypePorts`) for the tldraw-side caller, and
 * `client/pipeline/ports/fieldAnchors.ts` for the anchor atom.
 */

export interface PortLike {
	id: string
	x: number
	y: number
	terminal: 'start' | 'end'
	dataType: string
	multi?: boolean
	feedback?: boolean
}

export interface PortCandidate extends PortLike {
	/** Key to look up in the registered-anchors map, when different from `id` (a field port's
	 * anchor is keyed by its bare field name, e.g. "method", not "field:method"). */
	anchorKey?: string
	/** True when this port's own row is not part of the current render (a conditional field,
	 * or a dedicated port like DataPipe's "extra" that only applies to some ops). Only
	 * meaningful for `terminal: 'end'` ports — an output port is never hidden this way. */
	hidden?: boolean
	/** Only read when `hidden`: true if a wire is already connected, so the port must be kept
	 * (just moved to a fallback position) instead of dropped. */
	wired?: boolean
}

/**
 * Lay out a node's full port list. `anchors` is the per-shape map of measured row positions
 * (keyed by `anchorKey ?? id`); `fallbackY` is the card header's row (the ultimate fallback —
 * before any row has mounted, and for a hidden-but-wired port with no closer anchor).
 */
export function layoutPorts(
	candidates: PortCandidate[],
	anchors: Record<string, number> | undefined,
	fallbackY: number
): Record<string, PortLike> {
	const result: Record<string, PortLike> = {}
	let hiddenWiredIndex = 0
	for (const candidate of candidates) {
		const { anchorKey, hidden, wired, ...port } = candidate
		if (hidden) {
			if (!wired) continue
			result[port.id] = { ...port, y: fallbackY + hiddenWiredIndex * 8 }
			hiddenWiredIndex++
			continue
		}
		const key = anchorKey ?? port.id
		result[port.id] = { ...port, y: anchors?.[key] ?? port.y }
	}
	return result
}
