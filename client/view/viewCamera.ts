/**
 * WP46: auto center, fit and zoom. The camera math is in shared/viewFit.ts; this file reads the
 * editor and the DOM (how much of the canvas the toolbar and menus cover) and moves the camera.
 */
import {
	Box,
	defaultHandleExternalTldrawContent,
	DefaultSizeStyle,
	Editor,
	TLCameraMoveOptions,
	TLCameraOptions,
	TLEventInfo,
	TLShapeId,
	TLUiActionsContextType,
} from 'tldraw'
import {
	centerCamera,
	fitCamera,
	keepCenterCamera,
	nextZoomStep,
	panToShow,
	ViewCamera,
	ViewInsets,
	ZOOM_STEPS,
	zoomCameraAt,
} from '../../shared/viewFit'

/** Module-level, so the <Tldraw> options object stays stable. Plain wheel pans; Ctrl+wheel zooms. */
export const CAMERA_OPTIONS: Partial<TLCameraOptions> = { zoomSteps: ZOOM_STEPS, wheelBehavior: 'pan' }

const ZOOM_MS = 200
const PAN_MS = 200
/** Fallbacks when the tldraw UI is not in the DOM (yet). */
const DEFAULT_INSETS: ViewInsets = { top: 56, right: 16, bottom: 72, left: 16 }
const EDGE_GAP = 16

export function prefersReducedMotion(): boolean {
	try {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches
	} catch {
		return false
	}
}

function moveOpts(ms: number): TLCameraMoveOptions {
	return prefersReducedMotion() ? {} : { animation: { duration: ms } }
}

/** Viewport pixels covered by tldraw's menus (top) and toolbar (bottom), plus a gap. */
export function getViewInsets(editor: Editor): ViewInsets {
	const container = editor.getContainer()
	const view = editor.getViewportScreenBounds()
	const insets = { ...DEFAULT_INSETS }
	const bottomZone = container.querySelector('.tlui-layout__bottom')?.getBoundingClientRect()
	if (bottomZone && bottomZone.height > 0) insets.bottom = Math.max(0, view.maxY - bottomZone.top) + EDGE_GAP
	let topEdge = 0
	for (const el of container.querySelectorAll('.tlui-menu-zone, .app-panel-toggles')) {
		const rect = el.getBoundingClientRect()
		if (rect.height > 0) topEdge = Math.max(topEdge, rect.bottom - view.minY)
	}
	if (topEdge > 0) insets.top = topEdge + EDGE_GAP
	return insets
}

function pageBounds(editor: Editor, ids: readonly TLShapeId[]): Box | null {
	const boxes = ids.map((id) => editor.getShapePageBounds(id)).filter((b): b is Box => !!b)
	return boxes.length ? Box.Common(boxes) : null
}

function viewSize(editor: Editor) {
	const { w, h } = editor.getViewportScreenBounds()
	return { w, h }
}

function setCamera(editor: Editor, camera: ViewCamera, opts: TLCameraMoveOptions) {
	editor.setCamera({ x: camera.x, y: camera.y, z: camera.z }, opts)
}

/** The page bounds of every visible shape on the page (as tldraw's own zoom-to-fit). */
function contentBounds(editor: Editor): Box | null {
	return pageBounds(editor, [...editor.getCurrentPageShapeIds()].filter((id) => !editor.isShapeHidden(id)))
}

/** Fit `bounds` inside the part of the canvas no UI covers, at most 100 %. */
export function fitBounds(editor: Editor, bounds: Box, animate = true) {
	if (editor.getCameraOptions().isLocked) return
	const camera = fitCamera(bounds, viewSize(editor), getViewInsets(editor))
	setCamera(editor, camera, animate ? moveOpts(ZOOM_MS) : {})
}

/** Fit all content (Shift+1). Returns false on an empty page. */
export function fitAll(editor: Editor, animate = true): boolean {
	const bounds = contentBounds(editor)
	if (!bounds) return false
	fitBounds(editor, bounds, animate)
	return true
}

/** Fit the selection (Shift+2). Returns false when nothing is selected. */
export function fitSelection(editor: Editor, animate = true): boolean {
	const bounds = editor.getSelectionPageBounds()
	if (!bounds) return false
	fitBounds(editor, bounds, animate)
	return true
}

/** "Center view": the selection if there is one, else all content. */
export function centerView(editor: Editor) {
	if (!fitSelection(editor)) fitAll(editor)
}

/** On load: show all content (at most 100 %), or the page origin at 100 % on an empty page. */
export function showContentOnLoad(editor: Editor) {
	if (fitAll(editor, false)) return
	setCamera(editor, centerCamera({ x: 0, y: 0 }, 1, viewSize(editor), getViewInsets(editor)), {})
}

/** After a big insert: pan (never zoom) so the shapes are in view. */
export function panIntoView(editor: Editor, ids: readonly TLShapeId[]) {
	const bounds = pageBounds(editor, ids)
	if (!bounds || editor.getCameraOptions().isLocked) return
	const next = panToShow(bounds, editor.getCamera(), viewSize(editor), getViewInsets(editor))
	if (next) setCamera(editor, next, moveOpts(PAN_MS))
}

// The pointer is "over the canvas" when its last move was on tldraw's canvas element (not a
// panel, a menu or the toolbar). Keyboard zoom then zooms toward it.
let pointerOverCanvas = false
let pointerTracking = false

function trackPointer() {
	if (pointerTracking || typeof document === 'undefined') return
	pointerTracking = true
	document.addEventListener(
		'pointermove',
		(event) => {
			pointerOverCanvas = event.target instanceof Element && !!event.target.closest('.tl-canvas')
		},
		{ capture: true, passive: true }
	)
	document.documentElement.addEventListener('pointerleave', () => (pointerOverCanvas = false))
}

// Rapid Ctrl+= presses: step from where the running animation will end, not from mid-way.
let pendingZoom: { z: number; until: number } | null = null

/** One zoom step in or out, toward `point` (viewport px), the pointer, or the center. */
export function zoomStep(editor: Editor, direction: 'in' | 'out', point?: { x: number; y: number }) {
	if (editor.getCameraOptions().isLocked) return
	const camera = editor.getCamera()
	const base = pendingZoom && performance.now() < pendingZoom.until ? pendingZoom.z : camera.z
	const z = nextZoomStep(base, direction)
	const at = point ?? (pointerOverCanvas ? editor.inputs.getCurrentScreenPoint() : editor.getViewportScreenCenter())
	const opts = moveOpts(ZOOM_MS)
	pendingZoom = opts.animation ? { z, until: performance.now() + ZOOM_MS } : null
	setCamera(editor, zoomCameraAt(camera, z, at), opts)
}

/** tldraw's zoom actions, with our steps, our fit rules and clearer labels. */
export function zoomActionOverrides(editor: Editor, actions: TLUiActionsContextType): TLUiActionsContextType {
	const next: TLUiActionsContextType = {}
	if (actions['zoom-in']) next['zoom-in'] = { ...actions['zoom-in'], onSelect: () => zoomStep(editor, 'in') }
	if (actions['zoom-out']) next['zoom-out'] = { ...actions['zoom-out'], onSelect: () => zoomStep(editor, 'out') }
	if (actions['zoom-to-fit']) {
		next['zoom-to-fit'] = { ...actions['zoom-to-fit'], label: 'Fit all', onSelect: () => void fitAll(editor) }
	}
	if (actions['zoom-to-selection']) {
		next['zoom-to-selection'] = {
			...actions['zoom-to-selection'],
			label: 'Fit selection',
			onSelect: () => void fitSelection(editor),
		}
	}
	return next
}

/**
 * Install the view behaviour on a new editor. Returns a function that removes the listeners.
 * - keeps the center point when the canvas size changes (library sidebar, agent dock, window)
 * - Shift+double-click on empty canvas zooms in one step at that point
 * - a paste of several shapes that lands off screen pans into view
 * - new text/note/geo shapes start at size S (unless the user already picked a size)
 */
export function installViewBehaviour(editor: Editor): () => void {
	trackPointer()

	if (editor.getInstanceState().stylesForNextShape[DefaultSizeStyle.id] === undefined) {
		editor.setStyleForNextShapes(DefaultSizeStyle, 's', { history: 'ignore' })
	}

	let size = viewSize(editor)
	const onResize = () => {
		const next = viewSize(editor)
		const before = size
		size = next
		if (before.w === next.w && before.h === next.h) return
		if (editor.getInstanceState().followingUserId) return
		// tldraw has just kept the top-left corner; move so the old center stays the center.
		editor.stopCameraAnimation()
		setCamera(editor, keepCenterCamera(editor.getCamera(), before, next), {})
	}
	editor.on('resize', onResize)

	const onEvent = (info: TLEventInfo) => {
		if (info.type !== 'click' || info.name !== 'double_click' || info.phase !== 'down' || !info.shiftKey) return
		if (info.target !== 'canvas' || editor.getCurrentToolId() !== 'select') return
		const hit = editor.getShapeAtPoint(editor.inputs.getCurrentPagePoint(), {
			hitInside: true,
			margin: editor.getHitTestMargin(),
		})
		if (hit) return
		zoomStep(editor, 'in', editor.inputs.getCurrentScreenPoint())
	}
	editor.on('event', onEvent)

	editor.registerExternalContentHandler('tldraw', async (info) => {
		await defaultHandleExternalTldrawContent(editor, info)
		const ids = editor.getSelectedShapeIds()
		if (ids.length >= 2) panIntoView(editor, ids)
	})

	return () => {
		editor.off('resize', onResize)
		editor.off('event', onEvent)
	}
}
