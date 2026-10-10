import { describe, expect, it } from 'vitest'
import { findFreeSpot, placeRightOf, type Box } from '../shared/placement'

describe('findFreeSpot', () => {
	it('returns the wanted spot on an empty canvas', () => {
		const spot = findFreeSpot({ x: 100, y: 100 }, { w: 320, h: 200 }, [])
		expect(spot).toEqual({ x: 100, y: 100 })
	})

	it('moves to a free spot that does not intersect a blocking box', () => {
		const blocking: Box = { x: 100, y: 100, w: 320, h: 200 }
		const spot = findFreeSpot({ x: 100, y: 100 }, { w: 320, h: 200 }, [blocking], 48)
		const candidate: Box = { x: spot.x, y: spot.y, w: 320, h: 200 }
		const intersects = !(
			candidate.x + candidate.w + 48 <= blocking.x ||
			blocking.x + blocking.w + 48 <= candidate.x ||
			candidate.y + candidate.h + 48 <= blocking.y ||
			blocking.y + blocking.h + 48 <= candidate.y
		)
		expect(intersects).toBe(false)
		expect(spot).not.toEqual({ x: 100, y: 100 })
	})

	it('is deterministic: the same inputs give the same output', () => {
		const taken: Box[] = [
			{ x: 100, y: 100, w: 320, h: 200 },
			{ x: 100, y: 348, w: 320, h: 200 },
		]
		const a = findFreeSpot({ x: 100, y: 100 }, { w: 320, h: 200 }, taken)
		const b = findFreeSpot({ x: 100, y: 100 }, { w: 320, h: 200 }, taken)
		expect(a).toEqual(b)
	})

	it('falls back to the wanted spot when nothing is found within the search radius', () => {
		// Pack the whole search grid with giant blockers so every ring is occupied.
		const taken: Box[] = [{ x: -100000, y: -100000, w: 200000, h: 200000 }]
		const spot = findFreeSpot({ x: 0, y: 0 }, { w: 320, h: 200 }, taken, 48, 1)
		expect(spot).toEqual({ x: 0, y: 0 })
	})
})

describe('placeRightOf', () => {
	const anchor: Box = { x: 0, y: 0, w: 320, h: 200 }

	it('places directly to the right when that spot is free', () => {
		const spot = placeRightOf(anchor, { w: 320, h: 200 }, [])
		expect(spot).toEqual({ x: 320 + 48, y: 0 })
	})

	it('steps down when a box is already on the right', () => {
		const occupied: Box = { x: anchor.x + anchor.w + 48, y: anchor.y, w: 320, h: 200 }
		const spot = placeRightOf(anchor, { w: 320, h: 200 }, [occupied])
		expect(spot.x).toBe(occupied.x)
		expect(spot.y).toBeGreaterThan(anchor.y)
		expect(spot.y).toBe(anchor.y + (200 + 48))
	})

	it('is deterministic', () => {
		const occupied: Box = { x: anchor.x + anchor.w + 48, y: anchor.y, w: 320, h: 200 }
		const a = placeRightOf(anchor, { w: 320, h: 200 }, [occupied])
		const b = placeRightOf(anchor, { w: 320, h: 200 }, [occupied])
		expect(a).toEqual(b)
	})
})
