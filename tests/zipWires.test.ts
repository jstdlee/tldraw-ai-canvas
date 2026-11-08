import { describe, expect, it } from 'vitest'
import {
	ZIP_GAP,
	arcBendFor,
	arcLaneMiddle,
	computeZipBundles,
	connectionControlPoints,
	zipLanePoint,
	zippedConnectionPath,
	type ZipLine,
	type ZipPoint,
} from '../shared/zipWires'

const line = (id: string, sx: number, sy: number, ex: number, ey: number): ZipLine => ({
	id,
	start: { x: sx, y: sy },
	end: { x: ex, y: ey },
})
const dot = (a: ZipPoint, b: ZipPoint) => a.x * b.x + a.y * b.y

describe('computeZipBundles', () => {
	it('gives two crossing wires swapped lanes, so they no longer cross', () => {
		// a starts above b but ends far below it: its average sideways position is lower.
		const a = line('a', 0, 0, 400, 160)
		const b = line('b', 0, 60, 400, 20)
		const [bundle] = computeZipBundles([a, b])
		expect(bundle.ids).toEqual(['b', 'a'])
		expect(bundle.lanes.b).toBe(-ZIP_GAP / 2)
		expect(bundle.lanes.a).toBe(ZIP_GAP / 2)
		const pa = zipLanePoint(a, bundle.centre, bundle.axis, bundle.lanes.a)
		const pb = zipLanePoint(b, bundle.centre, bundle.axis, bundle.lanes.b)
		expect(dot(pa, bundle.normal) - dot(pb, bundle.normal)).toBeCloseTo(ZIP_GAP, 6)
	})

	it('gives three parallel wires offsets -10 / 0 / +10', () => {
		const lines = [line('m', 0, 50, 300, 50), line('t', 0, 0, 300, 0), line('b', 0, 100, 300, 100)]
		const [bundle] = computeZipBundles(lines)
		expect(bundle.ids).toEqual(['t', 'm', 'b'])
		expect(bundle.lanes).toEqual({ t: -10, m: 0, b: 10 })
		expect(bundle.axis.x).toBeCloseTo(1)
		expect(bundle.axis.y).toBeCloseTo(0)
	})

	it('leaves out a wire at 90° to the others', () => {
		const lines = [line('a', 0, 0, 300, 0), line('b', 0, 40, 300, 40), line('up', 150, 200, 150, -100)]
		const bundles = computeZipBundles(lines)
		expect(bundles).toHaveLength(1)
		expect(bundles[0].ids.sort()).toEqual(['a', 'b'])
	})

	it('leaves out lines that are far apart sideways', () => {
		expect(computeZipBundles([line('a', 0, 0, 100, 0), line('b', 0, 400, 100, 400)])).toHaveLength(0)
	})

	it('puts lane points between start and end along the axis', () => {
		const lines = [line('a', 0, 0, 400, 80), line('b', 20, 90, 380, 10), line('c', -10, 40, 420, 60)]
		const [bundle] = computeZipBundles(lines)
		expect(bundle.ids).toHaveLength(3)
		for (const l of lines) {
			const p = zipLanePoint(l, bundle.centre, bundle.axis, bundle.lanes[l.id])
			const s = dot(l.start, bundle.axis)
			const e = dot(l.end, bundle.axis)
			const m = dot(p, bundle.axis)
			expect(m).toBeGreaterThan(Math.min(s, e))
			expect(m).toBeLessThan(Math.max(s, e))
		}
	})

	it('is deterministic', () => {
		const lines = [line('a', 0, 0, 400, 80), line('b', 20, 90, 380, 10), line('c', -10, 40, 420, 60), line('d', 0, 500, 0, 900)]
		const first = computeZipBundles(lines)
		expect(computeZipBundles(lines)).toEqual(first)
		expect(computeZipBundles(structuredClone(lines))).toEqual(first)
		// Lane order and offsets do not depend on input order.
		const reversed = computeZipBundles([...lines].reverse())
		expect(reversed[0].ids).toEqual(first[0].ids)
		expect(reversed[0].lanes).toEqual(first[0].lanes)
	})
})

describe('zippedConnectionPath', () => {
	const start = { x: 0, y: 0 }
	const end = { x: 300, y: 120 }
	const axis = { x: 1, y: 0 }
	const lane = { x: 150, y: 70 }

	it('goes start → lane point → end with the axis as tangent at the lane point', () => {
		const { d, segments, middle } = zippedConnectionPath(start, end, lane, axis)
		expect(middle).toEqual(lane)
		expect(segments[0].start).toEqual(start)
		expect(segments[0].end).toEqual(lane)
		expect(segments[1].start).toEqual(lane)
		expect(segments[1].end).toEqual(end)
		// Tangent at the lane point is along the axis (control points on the axis line through it).
		expect(segments[0].cp2.y).toBeCloseTo(lane.y)
		expect(segments[0].cp2.x).toBeLessThan(lane.x)
		expect(segments[1].cp1.y).toBeCloseTo(lane.y)
		expect(segments[1].cp1.x).toBeGreaterThan(lane.x)
		// Horizontal tangents at the ends.
		expect(segments[0].cp1.y).toBe(start.y)
		expect(segments[1].cp2.y).toBe(end.y)
		expect(d.startsWith('M 0 0 C')).toBe(true)
		expect(d.match(/C/g)).toHaveLength(2)
	})

	it('with factor 0 draws the normal wire', () => {
		const { segments, middle } = zippedConnectionPath(start, end, lane, axis, 0)
		const [c1, c2] = connectionControlPoints(start, end)
		// The natural cubic at t = 0.5.
		expect(middle.x).toBeCloseTo((start.x + 3 * c1.x + 3 * c2.x + end.x) / 8)
		expect(middle.y).toBeCloseTo((start.y + 3 * c1.y + 3 * c2.y + end.y) / 8)
		expect(segments[0].cp1.x).toBeCloseTo((start.x + c1.x) / 2)
		expect(segments[1].cp2.x).toBeCloseTo((c2.x + end.x) / 2)
	})
})

describe('arc arrows', () => {
	it('arcBendFor puts the tldraw arc middle on the target', () => {
		const start = { x: 0, y: 0 }
		const end = { x: 200, y: 50 }
		const target = arcLaneMiddle(start, end, { x: 100, y: 40 }, { x: 1, y: 0 }, 0)
		const bend = arcBendFor(start, end, target)
		// tldraw: middle = med + per(u) * -bend, per(v) = (v.y, -v.x)
		const l = Math.hypot(200, 50)
		const u = { x: 200 / l, y: 50 / l }
		const middle = { x: 100 + u.y * -bend, y: 25 + -u.x * -bend }
		expect(middle.x).toBeCloseTo(target.x)
		expect(middle.y).toBeCloseTo(target.y)
		// On the lane line (y = 40 for a horizontal axis).
		expect(target.y).toBeCloseTo(40)
	})
})
