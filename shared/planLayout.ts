/**
 * Lay out the new nodes of an AiPlan: a left-to-right layered graph layout,
 * then nudged into the first free spot so nothing overlaps. Existing nodes
 * never move. No tldraw import, so this is testable in Node.
 */

import type { AiPlan } from './aiPlan'
import { findFreeSpot, type Box } from './placement'

export interface LayoutBox extends Box {
	id: string
}

/**
 * Layered layout: layer(ref) = 1 + the longest chain of wires feeding into it
 * from other new nodes (existing nodes count as layer 0, fixed in place). A
 * new node goes to the right of the rightmost node that feeds it, stacked
 * top-down within its layer; a new node with no wire at all goes in a row
 * below the existing selection.
 */
export function layoutPlan(
	plan: AiPlan,
	existing: LayoutBox[],
	sizeOf: (type: string) => { w: number; h: number },
	gap = 48
): Record<string, { x: number; y: number }> {
	const existingById = new Map(existing.map((box) => [box.id, box]))
	const sizes = new Map(plan.add.map((node) => [node.ref, sizeOf(node.type)]))
	const result: Record<string, { x: number; y: number }> = {}
	const placed: Box[] = existing.map((box) => ({ x: box.x, y: box.y, w: box.w, h: box.h }))

	const incoming = new Map<string, string[]>()
	for (const node of plan.add) incoming.set(node.ref, [])
	const hasWire = new Set<string>()
	for (const wire of plan.wires) {
		hasWire.add(wire.from)
		hasWire.add(wire.to)
		if (incoming.has(wire.to)) incoming.get(wire.to)!.push(wire.from)
	}
	// `after` is a layout-only hint (no data flows): place a node near a given
	// anchor even when nothing wires into it yet.
	for (const node of plan.add) {
		if (node.after && incoming.has(node.ref)) {
			incoming.get(node.ref)!.push(node.after)
			hasWire.add(node.ref)
			hasWire.add(node.after)
		}
	}

	const layerCache = new Map<string, number>()
	const visiting = new Set<string>()
	function layerOf(ref: string): number {
		if (existingById.has(ref)) return 0
		if (layerCache.has(ref)) return layerCache.get(ref)!
		if (visiting.has(ref)) return 0 // guards an unexpected cycle; validatePlan should have rejected it
		visiting.add(ref)
		const ins = incoming.get(ref) ?? []
		const layer = ins.length ? 1 + Math.max(...ins.map(layerOf)) : 1
		visiting.delete(ref)
		layerCache.set(ref, layer)
		return layer
	}

	function boxOf(ref: string): Box | undefined {
		const ex = existingById.get(ref)
		if (ex) return ex
		const pos = result[ref]
		const size = sizes.get(ref)
		return pos && size ? { x: pos.x, y: pos.y, w: size.w, h: size.h } : undefined
	}

	const baselineX = existing.length ? Math.max(...existing.map((box) => box.x)) + gap : 0
	const baselineY = existing.length ? Math.min(...existing.map((box) => box.y)) : 0
	const belowY = existing.length ? Math.max(...existing.map((box) => box.y + box.h)) + gap : 0
	const leftX = existing.length ? Math.min(...existing.map((box) => box.x)) : 0

	const connected = plan.add
		.filter((node) => hasWire.has(node.ref))
		.map((node, index) => ({ node, index, layer: layerOf(node.ref) }))
		.sort((a, b) => a.layer - b.layer || a.index - b.index)
	const orphans = plan.add.filter((node) => !hasWire.has(node.ref))

	const columnNextY = new Map<number, number>()
	for (const { node, layer } of connected) {
		const size = sizes.get(node.ref)!
		const ins = incoming.get(node.ref) ?? []
		const rightEdges = ins.map((ref) => {
			const box = boxOf(ref)
			return box ? box.x + box.w : baselineX
		})
		const x = rightEdges.length ? Math.max(...rightEdges) + gap : baselineX
		const y0 = columnNextY.get(layer) ?? baselineY
		const spot = findFreeSpot({ x, y: y0 }, size, placed, gap)
		result[node.ref] = spot
		placed.push({ x: spot.x, y: spot.y, w: size.w, h: size.h })
		columnNextY.set(layer, spot.y + size.h + gap)
	}

	let orphanX = leftX
	for (const node of orphans) {
		const size = sizes.get(node.ref)!
		const spot = findFreeSpot({ x: orphanX, y: belowY }, size, placed, gap)
		result[node.ref] = spot
		placed.push({ x: spot.x, y: spot.y, w: size.w, h: size.h })
		orphanX = spot.x + size.w + gap
	}

	return result
}
