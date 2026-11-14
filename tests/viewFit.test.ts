import { describe, expect, it } from 'vitest'
import {
	centerCamera,
	fitCamera,
	keepCenterCamera,
	nextZoomStep,
	panToShow,
	usableArea,
	ZOOM_STEPS,
	zoomCameraAt,
} from '../shared/viewFit'

const view = { w: 1000, h: 800 }
const insets = { top: 60, right: 20, bottom: 100, left: 20 }
const toScreen = (p: { x: number; y: number }, c: { x: number; y: number; z: number }) => ({
	x: (p.x + c.x) * c.z,
	y: (p.y + c.y) * c.z,
})

describe('WP46 view math', () => {
	it('zoom steps run from 5 % to 800 % with the listed stops', () => {
		expect(ZOOM_STEPS).toEqual([0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8])
	})

	it('fit never zooms past 100 % and centers the bounds in the usable area', () => {
		const c = fitCamera({ x: 0, y: 0, w: 100, h: 50 }, view, insets)
		expect(c.z).toBe(1)
		const center = toScreen({ x: 50, y: 25 }, c)
		const area = usableArea(view, insets)
		expect(center.x).toBeCloseTo(area.x + area.w / 2)
		expect(center.y).toBeCloseTo(area.y + area.h / 2)
	})

	it('fit zooms out so large bounds stay clear of the insets', () => {
		const bounds = { x: -500, y: 200, w: 4000, h: 1000 }
		const c = fitCamera(bounds, view, insets)
		expect(c.z).toBeLessThan(1)
		const tl = toScreen({ x: bounds.x, y: bounds.y }, c)
		const br = toScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h }, c)
		expect(tl.x).toBeGreaterThanOrEqual(insets.left - 1e-6)
		expect(br.x).toBeLessThanOrEqual(view.w - insets.right + 1e-6)
		expect(tl.y).toBeGreaterThanOrEqual(insets.top - 1e-6)
		expect(br.y).toBeLessThanOrEqual(view.h - insets.bottom + 1e-6)
	})

	it('pan to show: null when in view, a pure pan otherwise', () => {
		const camera = { x: 0, y: 0, z: 1 }
		expect(panToShow({ x: 100, y: 100, w: 100, h: 100 }, camera, view, insets)).toBeNull()
		const far = { x: 5000, y: 3000, w: 300, h: 200 }
		const next = panToShow(far, camera, view, insets)!
		expect(next.z).toBe(1)
		const br = toScreen({ x: far.x + far.w, y: far.y + far.h }, next)
		expect(br.x).toBeCloseTo(view.w - insets.right)
		expect(br.y).toBeCloseTo(view.h - insets.bottom)
		// Larger than the view: its top-left edge is shown.
		const huge = { x: -9000, y: -9000, w: 5000, h: 5000 }
		const tl = toScreen({ x: huge.x, y: huge.y }, panToShow(huge, camera, view, insets)!)
		expect(tl.x).toBeCloseTo(insets.left)
		expect(tl.y).toBeCloseTo(insets.top)
	})

	it('keeps the page point at the viewport center when the viewport shrinks', () => {
		const camera = { x: 30, y: -20, z: 0.5 }
		const before = { w: 1200, h: 800 }
		const after = { w: 820, h: 800 }
		const pageCenter = { x: before.w / 2 / camera.z - camera.x, y: before.h / 2 / camera.z - camera.y }
		const next = keepCenterCamera(camera, before, after)
		const screen = toScreen(pageCenter, next)
		expect(screen.x).toBeCloseTo(after.w / 2)
		expect(screen.y).toBeCloseTo(after.h / 2)
	})

	it('steps zoom in and out, clamped at the ends', () => {
		expect(nextZoomStep(1, 'in')).toBe(1.25)
		expect(nextZoomStep(0.999, 'in')).toBe(1.25)
		expect(nextZoomStep(0.9, 'in')).toBe(1)
		expect(nextZoomStep(1, 'out')).toBe(0.75)
		expect(nextZoomStep(8, 'in')).toBe(8)
		expect(nextZoomStep(0.05, 'out')).toBe(0.05)
		expect(nextZoomStep(3.5, 'out')).toBe(3)
	})

	it('zooms around a point and centers on a point', () => {
		const camera = { x: 10, y: 20, z: 1 }
		const point = { x: 300, y: 200 }
		const pagePoint = { x: point.x / camera.z - camera.x, y: point.y / camera.z - camera.y }
		const next = zoomCameraAt(camera, 2, point)
		const screen = toScreen(pagePoint, next)
		expect(screen.x).toBeCloseTo(point.x)
		expect(screen.y).toBeCloseTo(point.y)
		const centered = centerCamera({ x: 0, y: 0 }, 1, view, insets)
		const area = usableArea(view, insets)
		expect(toScreen({ x: 0, y: 0 }, centered).x).toBeCloseTo(area.x + area.w / 2)
	})
})
