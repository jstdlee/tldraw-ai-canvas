/**
 * Pure placement logic for new nodes: find a free spot near a wanted position,
 * or a free spot to the right of an anchor box. No tldraw import, so it is
 * testable in Node.
 */

export interface Box {
	x: number
	y: number
	w: number
	h: number
}

function overlaps(a: Box, b: Box, gap: number): boolean {
	return !(
		a.x + a.w + gap <= b.x ||
		b.x + b.w + gap <= a.x ||
		a.y + a.h + gap <= b.y ||
		b.y + b.h + gap <= a.y
	)
}

function isFree(box: Box, taken: Box[], gap: number): boolean {
	return taken.every((t) => !overlaps(box, t, gap))
}

/**
 * First free spot for a box of size w×h near `want`, avoiding `taken` with `gap` margin.
 * Search order: want itself, then a spiral of candidate positions on a grid of step
 * (w+gap)/2 and (h+gap)/2, up to `maxRings` rings (default 12). Returns the closest
 * free candidate; falls back to `want` if nothing is found within the search radius.
 */
export function findFreeSpot(
	want: { x: number; y: number },
	size: { w: number; h: number },
	taken: Box[],
	gap = 48,
	maxRings = 12
): { x: number; y: number } {
	const candidate = (x: number, y: number): Box => ({ x, y, w: size.w, h: size.h })
	if (isFree(candidate(want.x, want.y), taken, gap)) return { x: want.x, y: want.y }

	const stepX = (size.w + gap) / 2
	const stepY = (size.h + gap) / 2

	for (let ring = 1; ring <= maxRings; ring++) {
		const points: { x: number; y: number }[] = []
		// Top and bottom edges of the ring.
		for (let i = -ring; i <= ring; i++) {
			points.push({ x: want.x + i * stepX, y: want.y - ring * stepY })
			points.push({ x: want.x + i * stepX, y: want.y + ring * stepY })
		}
		// Left and right edges (excluding corners, already covered above).
		for (let j = -ring + 1; j <= ring - 1; j++) {
			points.push({ x: want.x - ring * stepX, y: want.y + j * stepY })
			points.push({ x: want.x + ring * stepX, y: want.y + j * stepY })
		}
		// Closest candidates first. Array.prototype.sort is stable, so ties keep a
		// deterministic order (the order points were pushed above).
		points.sort((a, b) => dist2(a, want) - dist2(b, want))
		for (const p of points) {
			if (isFree(candidate(p.x, p.y), taken, gap)) return p
		}
	}
	return { x: want.x, y: want.y }
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
	const dx = a.x - b.x
	const dy = a.y - b.y
	return dx * dx + dy * dy
}

/**
 * Place to the right of `anchor`: try anchor.right+gap at the anchor's y, then step down.
 */
export function placeRightOf(
	anchor: Box,
	size: { w: number; h: number },
	taken: Box[],
	gap = 48
): { x: number; y: number } {
	const x = anchor.x + anchor.w + gap
	const isFreeAt = (y: number) => isFree({ x, y, w: size.w, h: size.h }, taken, gap)

	if (isFreeAt(anchor.y)) return { x, y: anchor.y }

	const stepY = size.h + gap
	for (let i = 1; i <= 200; i++) {
		const y = anchor.y + i * stepY
		if (isFreeAt(y)) return { x, y }
	}
	return { x, y: anchor.y }
}
