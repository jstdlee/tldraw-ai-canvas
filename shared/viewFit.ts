/**
 * WP46: camera math for "fit", "pan into view", "keep the center on resize" and zoom steps.
 * Pure functions (no tldraw import), so they are tested in Node.
 *
 * Camera convention is tldraw's: a page point `p` shows at viewport point `(p + camera) * z`
 * (viewport point = screen point minus the canvas element's top-left corner).
 */

export interface ViewCamera {
	x: number
	y: number
	z: number
}

export interface ViewBox {
	x: number
	y: number
	w: number
	h: number
}

export interface ViewSize {
	w: number
	h: number
}

/** Screen pixels to keep clear at each edge of the canvas (toolbar, menus). */
export interface ViewInsets {
	top: number
	right: number
	bottom: number
	left: number
}

/** Zoom steps for Ctrl+= / Ctrl+- and the zoom menu. First and last are the min and max zoom. */
export const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8]
export const MIN_ZOOM = ZOOM_STEPS[0]
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]
/** Fit never zooms in past 100 %: a small canvas does not jump to 800 %. */
export const FIT_MAX_ZOOM = 1

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value))
}

/** The part of the viewport that is not covered by UI, in viewport pixels. */
export function usableArea(view: ViewSize, insets: ViewInsets): ViewBox {
	// A very small window: never let the insets eat the whole canvas.
	const w = Math.max(view.w * 0.4, view.w - insets.left - insets.right)
	const h = Math.max(view.h * 0.4, view.h - insets.top - insets.bottom)
	const x = view.w - insets.left - insets.right >= w ? insets.left : (view.w - w) / 2
	const y = view.h - insets.top - insets.bottom >= h ? insets.top : (view.h - h) / 2
	return { x, y, w, h }
}

/** The camera that shows `bounds` as large as possible inside the usable area, at most `maxZoom`. */
export function fitCamera(
	bounds: ViewBox,
	view: ViewSize,
	insets: ViewInsets,
	opts: { minZoom?: number; maxZoom?: number } = {}
): ViewCamera {
	const area = usableArea(view, insets)
	const z = clamp(
		Math.min(area.w / Math.max(bounds.w, 1), area.h / Math.max(bounds.h, 1)),
		opts.minZoom ?? MIN_ZOOM,
		opts.maxZoom ?? FIT_MAX_ZOOM
	)
	return {
		x: (area.x + area.w / 2) / z - (bounds.x + bounds.w / 2),
		y: (area.y + area.h / 2) / z - (bounds.y + bounds.h / 2),
		z,
	}
}

/** The camera (same zoom) that puts page point `point` at the center of the usable area. */
export function centerCamera(point: { x: number; y: number }, z: number, view: ViewSize, insets: ViewInsets): ViewCamera {
	const area = usableArea(view, insets)
	return { x: (area.x + area.w / 2) / z - point.x, y: (area.y + area.h / 2) / z - point.y, z }
}

/** One axis of `panToShow`: the new camera offset, or the old one when the range is in view. */
function panAxis(min: number, max: number, cam: number, z: number, areaStart: number, areaSize: number): number {
	const start = areaStart / z - cam // page coordinate at the area's start edge
	const end = (areaStart + areaSize) / z - cam
	// Larger than the area: show its start (workflows read left to right, top to bottom).
	if (max - min > end - start || min < start) return areaStart / z - min
	if (max > end) return (areaStart + areaSize) / z - max
	return cam
}

/**
 * The camera that pans (never zooms) the least so `bounds` is inside the usable area, or
 * `null` when it already is. A range larger than the area is aligned to its start edge.
 */
export function panToShow(bounds: ViewBox, camera: ViewCamera, view: ViewSize, insets: ViewInsets): ViewCamera | null {
	const area = usableArea(view, insets)
	const x = panAxis(bounds.x, bounds.x + bounds.w, camera.x, camera.z, area.x, area.w)
	const y = panAxis(bounds.y, bounds.y + bounds.h, camera.y, camera.z, area.y, area.h)
	if (Math.abs(x - camera.x) < 1e-6 && Math.abs(y - camera.y) < 1e-6) return null
	return { x, y, z: camera.z }
}

/** The camera that keeps the page point at the old viewport center at the new viewport center. */
export function keepCenterCamera(camera: ViewCamera, before: ViewSize, after: ViewSize): ViewCamera {
	return {
		x: camera.x + (after.w - before.w) / 2 / camera.z,
		y: camera.y + (after.h - before.h) / 2 / camera.z,
		z: camera.z,
	}
}

/** The next zoom step above (`in`) or below (`out`) `zoom`, clamped to the first/last step. */
export function nextZoomStep(zoom: number, direction: 'in' | 'out', steps: readonly number[] = ZOOM_STEPS): number {
	// 1 % tolerance, so 99.9 % counts as "at 100 %" and the next step is 125 %.
	if (direction === 'in') return steps.find((s) => s > zoom * 1.01) ?? steps[steps.length - 1]
	for (let i = steps.length - 1; i >= 0; i--) if (steps[i] < zoom * 0.99) return steps[i]
	return steps[0]
}

/** The camera at zoom `z` that keeps viewport point `point` over the same page point. */
export function zoomCameraAt(camera: ViewCamera, z: number, point: { x: number; y: number }): ViewCamera {
	return {
		x: camera.x + point.x / z - point.x / camera.z,
		y: camera.y + point.y / z - point.y / camera.z,
		z,
	}
}
