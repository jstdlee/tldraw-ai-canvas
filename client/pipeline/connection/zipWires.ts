/**
 * WP43 "Zip wires": pull the middles of selected wires and arrows into parallel lanes.
 * Pure maths is in shared/zipWires.ts. Wires keep `meta.zip = { bundle, offset }` and draw the
 * zipped path themselves (ConnectionShapeUtil); arrows only get a new `bend` / `elbowMidPoint`.
 */
import {
	Computed,
	Editor,
	Mat,
	MatModel,
	TLArrowShape,
	TLShape,
	TLShapeId,
	Vec,
	atom,
	computed,
	getArrowBindings,
	getArrowInfo,
	getArrowTerminalsInArrowSpace,
	invLerp,
} from 'tldraw'
import {
	ZIP_MAX_ANGLE_DEG,
	ZipBundle,
	ZipLine,
	ZipPoint,
	arcBendFor,
	arcLaneMiddle,
	computeZipBundles,
	zipBundleFrame,
	zipLanePoint,
	zippedConnectionPath,
} from '../../../shared/zipWires'
import { getConnectionBindingPositionInPageSpace, getConnectionBindings } from './ConnectionBindingUtil'
import type { ConnectionShape } from './ConnectionShapeUtil'

export interface ConnectionZip {
	bundle: string
	offset: number
}

export interface ArrowZip extends ConnectionZip {
	/** The arrow's bend before it was zipped (arc arrows). */
	bend?: number
	/** The arrow's elbowMidPoint before it was zipped (elbow arrows). */
	elbowMidPoint?: number
}

type ZipNotify = (title: string, severity?: 'info' | 'success' | 'warning' | 'error') => void

/** Arrows with both ends free and shorter than this are not zip targets. */
const MIN_FREE_ARROW_LENGTH = 40
const ZIP_DURATION_MS = 450
const SLIDER_FADE_MS = 120
/** How far the zip slider travels along the bundle axis, in screen px. */
const SLIDER_TRAVEL_PX = 60
/** tldraw's MIN_ARROW_BEND (not exported): smaller bends draw a straight arrow. */
const TLDRAW_MIN_ARROW_BEND = 8
const COS_MAX_ANGLE = Math.cos((ZIP_MAX_ANGLE_DEG * Math.PI) / 180)

// --- Client-only animation state ---------------------------------------------------------------

/**
 * Per connection id: how far the zip has gone (0 = normal wire, 1 = zipped). `zip` holds the
 * zip while an unzip plays (meta.zip is already cleared then). No entry = follow meta.zip.
 */
export const $zipAnim = atom<Record<string, { factor: number; zip?: ConnectionZip }>>('zip wires anim', {})

export interface ZipSlider {
	id: string
	/** Page point. */
	x: number
	y: number
	/** Axis angle in radians. */
	angle: number
	opacity: number
}

/** The zip slider pills drawn by ZipSliderLayer during the animation. */
export const $zipSliders = atom<ZipSlider[]>('zip wires sliders', [])

// --- Reading the zip ---------------------------------------------------------------------------

function readZip(shape: TLShape): ArrowZip | null {
	const zip = (shape.meta as Record<string, unknown> | undefined)?.zip as Record<string, unknown> | null | undefined
	if (!zip || typeof zip !== 'object') return null
	if (typeof zip.bundle !== 'string' || typeof zip.offset !== 'number') return null
	return zip as unknown as ArrowZip
}

export function hasZip(shape: TLShape) {
	return readZip(shape) !== null
}

/** The zip a connection draws with now: the animation override, else meta.zip. */
function effectiveConnectionZip(shape: TLShape): ConnectionZip | null {
	const anim = $zipAnim.get()[shape.id]
	return anim?.zip ?? readZip(shape)
}

/** Page-space ends of a connection (the bound ports, else its own handle points). */
export function getConnectionPageTerminals(editor: Editor, connection: ConnectionShape) {
	const bindings = getConnectionBindings(editor, connection)
	const transform = editor.getShapePageTransform(connection)
	const start =
		(bindings.start && getConnectionBindingPositionInPageSpace(editor, bindings.start)) ||
		transform.applyToPoint(connection.props.start)
	const end =
		(bindings.end && getConnectionBindingPositionInPageSpace(editor, bindings.end)) ||
		transform.applyToPoint(connection.props.end)
	return { start: Vec.From(start), end: Vec.From(end) }
}

interface BundleFrame {
	axis: ZipPoint
	normal: ZipPoint
	centre: ZipPoint
	count: number
}

const frameCaches = new WeakMap<Editor, Computed<Record<string, BundleFrame>>>()

/**
 * Live bundle frames (axis, centre) per bundle id, from the current natural middles of every
 * zipped connection on the page. Not stored, so a bundle stays tidy when cards move.
 */
function getBundleFrames(editor: Editor): Record<string, BundleFrame> {
	let cache = frameCaches.get(editor)
	if (!cache) {
		cache = computed(
			'zip bundle frames',
			() => {
				const groups: Record<string, { start: ZipPoint; end: ZipPoint }[]> = {}
				for (const shape of editor.getCurrentPageShapes()) {
					if (shape.type !== 'connection') continue
					const zip = effectiveConnectionZip(shape)
					if (!zip) continue
					;(groups[zip.bundle] ??= []).push(getConnectionPageTerminals(editor, shape as ConnectionShape))
				}
				const frames: Record<string, BundleFrame> = {}
				for (const [bundle, lines] of Object.entries(groups)) {
					frames[bundle] = { ...zipBundleFrame(lines), count: lines.length }
				}
				return frames
			},
			{ isEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
		)
		frameCaches.set(editor, cache)
	}
	return cache.get()
}

/**
 * The zipped path of a connection in page space, or null when it draws as a normal wire
 * (no zip, or the rest of its bundle is gone).
 */
export function getZippedConnectionPagePath(editor: Editor, connection: ConnectionShape) {
	// Read the live record: tldraw's indicator cache passes a record that is only refreshed when
	// props change, so its meta.zip can be stale.
	const zip = effectiveConnectionZip(editor.getShape(connection.id) ?? connection)
	if (!zip) return null
	const frame = getBundleFrames(editor)[zip.bundle]
	if (!frame || frame.count < 2) return null
	const { start, end } = getConnectionPageTerminals(editor, connection)
	const lane = zipLanePoint({ start, end }, frame.centre, frame.axis, zip.offset)
	const factor = $zipAnim.get()[connection.id]?.factor ?? 1
	return zippedConnectionPath(start, end, lane, frame.axis, factor)
}

/** The same, in the connection's own shape space (for geometry and drawing). */
export function getZippedConnectionPath(editor: Editor, connection: ConnectionShape) {
	const page = getZippedConnectionPagePath(editor, connection)
	if (!page) return null
	const inverse = Mat.Inverse(editor.getShapePageTransform(connection))
	const local = (p: ZipPoint) => Mat.applyToPoint(inverse, p)
	const segments = page.segments.map((s) => ({
		start: local(s.start),
		cp1: local(s.cp1),
		cp2: local(s.cp2),
		end: local(s.end),
	}))
	const f = (n: number) => Math.round(n * 1000) / 1000
	const d =
		`M ${f(segments[0].start.x)} ${f(segments[0].start.y)}` +
		segments.map((s) => ` C ${f(s.cp1.x)} ${f(s.cp1.y)} ${f(s.cp2.x)} ${f(s.cp2.y)} ${f(s.end.x)} ${f(s.end.y)}`).join('')
	return { d, segments, middlePage: Vec.From(page.middle) }
}

// --- Targets -----------------------------------------------------------------------------------

function arrowPageTerminals(editor: Editor, arrow: TLArrowShape) {
	const local = getArrowTerminalsInArrowSpace(editor, arrow, getArrowBindings(editor, arrow))
	const transform = editor.getShapePageTransform(arrow)
	return { start: transform.applyToPoint(local.start), end: transform.applyToPoint(local.end) }
}

/**
 * Wires and arrows the zip acts on: the selected ones, plus those with an end on a selected
 * shape. Skips locked shapes, derived links and tiny free arrows.
 */
export function zipTargets(editor: Editor): TLShape[] {
	const found = new Map<TLShapeId, TLShape>()
	const consider = (shape: TLShape | undefined) => {
		if (!shape || found.has(shape.id)) return
		if (shape.type !== 'connection' && shape.type !== 'arrow') return
		if (editor.isShapeOrAncestorLocked(shape)) return
		if ((shape.meta as Record<string, unknown>)?.derived) return
		if (shape.type === 'arrow') {
			const arrow = shape as TLArrowShape
			const bindings = getArrowBindings(editor, arrow)
			if (!bindings.start && !bindings.end) {
				const { start, end } = arrowPageTerminals(editor, arrow)
				if (Vec.Dist(start, end) < MIN_FREE_ARROW_LENGTH) return
			}
		}
		found.set(shape.id, shape)
	}
	for (const shape of editor.getSelectedShapes()) {
		consider(shape)
		for (const type of ['connection', 'arrow'] as const) {
			for (const binding of editor.getBindingsToShape(shape.id, type)) consider(editor.getShape(binding.fromId))
		}
	}
	return [...found.values()]
}

function lineOf(editor: Editor, shape: TLShape): ZipLine {
	const { start, end } =
		shape.type === 'connection'
			? getConnectionPageTerminals(editor, shape as ConnectionShape)
			: arrowPageTerminals(editor, shape as TLArrowShape)
	return { id: shape.id, start, end }
}

// --- Arrow planning ----------------------------------------------------------------------------

interface ArrowPlan {
	id: TLShapeId
	prop: 'bend' | 'elbowMidPoint'
	from: number
	to: number
	zip: ArrowZip
}

/** Middle of an arc arrow in page space (from tldraw's own arrow info). */
export function arrowMiddlePage(editor: Editor, id: TLShapeId): ZipPoint | null {
	const info = getArrowInfo(editor, id)
	if (!info || info.type === 'elbow') return null
	return editor.getShapePageTransform(id).applyToPoint(info.middle)
}

/**
 * Work out each arrow's final bend / elbowMidPoint. tldraw computes the arrow, so this tries
 * values (without history) and reads tldraw's answer back, then puts every arrow back.
 * Returns the plans plus the elbow arrows that cannot put their middle segment on the lane.
 */
function planArrows(editor: Editor, bundles: ZipBundle[], bundleIds: string[]) {
	const plans: ArrowPlan[] = []
	const impossible = new Set<string>()
	const originals: TLArrowShape[] = []
	editor.run(
		() => {
			bundles.forEach((bundle, bundleIndex) => {
				for (const id of bundle.ids) {
					const arrow = editor.getShape<TLArrowShape>(id as TLShapeId)
					if (!arrow) continue
					originals.push(arrow)
					const old = readZip(arrow)
					const offset = bundle.lanes[id]
					const zip: ArrowZip = { bundle: bundleIds[bundleIndex], offset }
					const transform = editor.getShapePageTransform(arrow)
					const inverse = Mat.Inverse(transform)
					const { start, end } = arrowPageTerminals(editor, arrow)
					if (arrow.props.kind === 'elbow') {
						const value = planElbow(editor, arrow, { start, end }, bundle, offset, inverse)
						if (value === null) {
							impossible.add(id)
							continue
						}
						zip.elbowMidPoint = old?.elbowMidPoint ?? arrow.props.elbowMidPoint
						plans.push({ id: arrow.id, prop: 'elbowMidPoint', from: arrow.props.elbowMidPoint, to: value, zip })
						continue
					}
					const target = arcLaneMiddle(start, end, bundle.centre, bundle.axis, offset)
					const local = getArrowTerminalsInArrowSpace(editor, arrow, getArrowBindings(editor, arrow))
					let bend = arcBendFor(local.start, local.end, Mat.applyToPoint(inverse, target))
					// Bound arrows are clipped at their shapes, which moves tldraw's middle a little:
					// nudge the bend until the middle sits on the lane line.
					const dir = Vec.Sub(end, start).uni()
					const perp = new Vec(dir.y, -dir.x)
					const slope = -Vec.Dpr(perp, bundle.normal)
					const minBend = TLDRAW_MIN_ARROW_BEND * arrow.props.scale
					for (let i = 0; i < 6 && Math.abs(bend) >= minBend; i++) {
						editor.updateShape<TLArrowShape>({ id: arrow.id, type: 'arrow', props: { bend } })
						const middle = arrowMiddlePage(editor, arrow.id)
						if (!middle || Math.abs(slope) < 1e-6) break
						const error = Vec.Dpr(Vec.Sub(middle, target), bundle.normal)
						if (Math.abs(error) < 0.2) break
						bend -= error / slope
					}
					// tldraw draws |bend| < 8 × scale as a straight arrow (middle = its midpoint), so
					// a smaller bend cannot be shown: take whichever of straight / the smallest
					// curve is closer.
					if (Math.abs(bend) < minBend) bend = Math.abs(bend) < minBend / 2 ? 0 : Math.sign(bend) * minBend
					zip.bend = old?.bend ?? arrow.props.bend
					plans.push({ id: arrow.id, prop: 'bend', from: arrow.props.bend, to: bend, zip })
				}
			})
			// Put every arrow back as it was; the real change is written later, with history.
			for (const arrow of originals) {
				editor.updateShape<TLArrowShape>({ id: arrow.id, type: 'arrow', props: { bend: arrow.props.bend, elbowMidPoint: arrow.props.elbowMidPoint } })
			}
		},
		{ history: 'ignore' }
	)
	return { plans, impossible }
}

/** elbowMidPoint that puts the elbow's middle segment through its lane point, or null. */
function planElbow(
	editor: Editor,
	arrow: TLArrowShape,
	line: { start: ZipPoint; end: ZipPoint },
	bundle: ZipBundle,
	offset: number,
	inverse: MatModel
): number | null {
	const info = getArrowInfo(editor, arrow.id)
	if (info?.type !== 'elbow') return null
	const handle = info.route.midpointHandle
	if (!handle) return null
	// axis 'x': a vertical segment at x = midX; axis 'y': a horizontal segment at y = midY.
	const transform = editor.getShapePageTransform(arrow)
	const segDir = Vec.Sub(
		transform.applyToPoint(handle.axis === 'x' ? { x: 0, y: 1 } : { x: 1, y: 0 }),
		transform.applyToPoint({ x: 0, y: 0 })
	).uni()
	if (Math.abs(Vec.Dpr(segDir, bundle.axis)) < COS_MAX_ANGLE) return null
	const range = handle.axis === 'x' ? info.elbow.midXRange : info.elbow.midYRange
	if (!range || range.lo === range.hi) return null
	const lane = Mat.applyToPoint(inverse, zipLanePoint(line, bundle.centre, bundle.axis, offset))
	const coord = handle.axis === 'x' ? lane.x : lane.y
	const value = invLerp(range.lo, range.hi, coord)
	if (!(value >= 0 && value <= 1)) return null
	editor.updateShape<TLArrowShape>({ id: arrow.id, type: 'arrow', props: { elbowMidPoint: value } })
	const after = getArrowInfo(editor, arrow.id)
	const h = after?.type === 'elbow' ? after.route.midpointHandle : null
	if (!h || h.axis !== handle.axis) return null
	if (Math.abs((handle.axis === 'x' ? h.point.x : h.point.y) - coord) > 1) return null
	return value
}

// --- Animation ---------------------------------------------------------------------------------

interface AnimLine {
	id: TLShapeId
	/** Order within its bundle (0 moves first) and the bundle size. */
	index: number
	count: number
	kind: 'connection' | 'arrow'
	arrow?: { prop: 'bend' | 'elbowMidPoint'; from: number; to: number }
}

interface AnimSlider {
	id: string
	centre: ZipPoint
	axis: ZipPoint
	direction: 1 | -1
}

let running: { finish(): void } | null = null

function prefersReducedMotion(editor: Editor) {
	try {
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true
	} catch {
		// No matchMedia (tests): animate.
	}
	return editor.user.getAnimationSpeed() === 0
}

const easeOut = (t: number) => 1 - (1 - t) ** 3

/**
 * Play the zip: each line tweens one after another (stagger min(60, 300 / n) ms), 450 ms in all,
 * ease-out. `forward` = zip (connection factor 0 → 1), else unzip (1 → 0). Arrow frames are
 * written without history; the store already holds the final values.
 */
function animate(editor: Editor, lines: AnimLine[], sliders: AnimSlider[], forward: boolean) {
	running?.finish()
	const startTime = performance.now()
	const lastWritten = new Map<TLShapeId, number>()
	let frame = 0
	let done = false

	const progressOf = (line: AnimLine, now: number) => {
		const stagger = Math.min(60, 300 / line.count)
		const duration = ZIP_DURATION_MS - stagger * (line.count - 1)
		return easeOut(Math.min(1, Math.max(0, (now - startTime - line.index * stagger) / duration)))
	}

	const writeArrows = (values: { line: AnimLine; value: number }[]) => {
		const updates = values.filter(({ line }) => {
			const shape = editor.getShape<TLArrowShape>(line.id)
			if (!shape) return false
			// Someone else changed the arrow (undo, a drag): stop animating it.
			const last = lastWritten.get(line.id)
			const current = shape.props[line.arrow!.prop]
			return last === undefined ? current === line.arrow!.to : current === last
		})
		if (!updates.length) return
		editor.run(
			() => {
				for (const { line, value } of updates) {
					editor.updateShape<TLArrowShape>({ id: line.id, type: 'arrow', props: { [line.arrow!.prop]: value } })
					lastWritten.set(line.id, value)
				}
			},
			{ history: 'ignore' }
		)
	}

	const finish = () => {
		if (done) return
		done = true
		cancelAnimationFrame(frame)
		writeArrows(lines.filter((l) => l.arrow).map((line) => ({ line, value: line.arrow!.to })))
		const anim = { ...$zipAnim.get() }
		for (const line of lines) delete anim[line.id]
		$zipAnim.set(anim)
		$zipSliders.set($zipSliders.get().filter((s) => !sliders.some((own) => own.id === s.id)))
		if (running === handle) running = null
	}
	const handle = { finish }
	running = handle

	const tick = () => {
		if (done) return
		const now = performance.now()
		const anim = { ...$zipAnim.get() }
		const arrowValues: { line: AnimLine; value: number }[] = []
		for (const line of lines) {
			const p = progressOf(line, now)
			if (line.kind === 'connection') {
				const entry = anim[line.id]
				if (entry) anim[line.id] = { ...entry, factor: forward ? p : 1 - p }
			} else if (line.arrow) {
				arrowValues.push({ line, value: line.arrow.from + (line.arrow.to - line.arrow.from) * p })
			}
		}
		$zipAnim.set(anim)
		writeArrows(arrowValues)

		const elapsed = now - startTime
		const zoom = editor.getZoomLevel()
		const travel = SLIDER_TRAVEL_PX / zoom
		const t = Math.min(1, elapsed / ZIP_DURATION_MS)
		const fade = elapsed <= ZIP_DURATION_MS ? 1 : Math.max(0, 1 - (elapsed - ZIP_DURATION_MS) / SLIDER_FADE_MS)
		const others = $zipSliders.get().filter((s) => !sliders.some((own) => own.id === s.id))
		$zipSliders.set([
			...others,
			...sliders.map((s) => {
				const along = (easeOut(t) - 0.5) * travel * s.direction
				return {
					id: s.id,
					x: s.centre.x + s.axis.x * along,
					y: s.centre.y + s.axis.y * along,
					angle: Math.atan2(s.axis.y, s.axis.x),
					opacity: fade,
				}
			}),
		])

		if (elapsed >= ZIP_DURATION_MS + SLIDER_FADE_MS) finish()
		else frame = requestAnimationFrame(tick)
	}
	tick()
}

// --- Zip / unzip -------------------------------------------------------------------------------

function newBundleId() {
	try {
		return crypto.randomUUID().slice(0, 8)
	} catch {
		return Math.random().toString(36).slice(2, 10)
	}
}

/** Zip the target wires and arrows. Returns the number of lines zipped. */
export function zipWires(editor: Editor, notify: ZipNotify): number {
	const targets = zipTargets(editor)
	if (targets.length < 2) {
		notify('Select at least two wires or arrows', 'warning')
		return 0
	}
	running?.finish()

	// Wires follow later card moves (their bundle centre is live), arrows do not, so the two
	// kinds are bundled apart.
	const connections = targets.filter((s) => s.type === 'connection')
	const connectionBundles = computeZipBundles(connections.map((s) => lineOf(editor, s)))

	let arrows = targets.filter((s) => s.type === 'arrow')
	let arrowBundles: ZipBundle[] = []
	let arrowBundleIds: string[] = []
	let plans: ArrowPlan[] = []
	let elbowsLeftOut = 0
	// An elbow arrow that cannot put its middle segment on the lane leaves the bundle; the rest
	// are bundled again without it.
	for (let pass = 0; pass < 5; pass++) {
		arrowBundles = computeZipBundles(arrows.map((s) => lineOf(editor, s)))
		arrowBundleIds = arrowBundles.map(newBundleId)
		const result = planArrows(editor, arrowBundles, arrowBundleIds)
		plans = result.plans
		if (!result.impossible.size) break
		elbowsLeftOut += result.impossible.size
		arrows = arrows.filter((s) => !result.impossible.has(s.id))
		plans = []
		arrowBundles = []
	}

	const elbowNote = elbowsLeftOut
		? `${elbowsLeftOut} elbow arrow${elbowsLeftOut === 1 ? '' : 's'} left out: the middle segment runs across the bundle`
		: ''
	if (!connectionBundles.length && !plans.length) {
		notify(elbowNote || 'These wires do not run the same way: nothing to zip', 'info')
		return 0
	}
	if (elbowNote) notify(elbowNote, 'info')

	const connectionBundleIds = connectionBundles.map(newBundleId)
	const reduced = prefersReducedMotion(editor)
	const animLines: AnimLine[] = []
	const sliders: AnimSlider[] = []

	connectionBundles.forEach((bundle, i) => {
		sliders.push({ id: connectionBundleIds[i], centre: bundle.centre, axis: bundle.axis, direction: 1 })
		bundle.ids.forEach((id, index) =>
			animLines.push({ id: id as TLShapeId, index, count: bundle.ids.length, kind: 'connection' })
		)
	})
	const planById = new Map(plans.map((p) => [p.id, p]))
	arrowBundles.forEach((bundle, i) => {
		const lineIds = bundle.ids.filter((id) => planById.has(id as TLShapeId))
		if (!lineIds.length) return
		sliders.push({ id: arrowBundleIds[i], centre: bundle.centre, axis: bundle.axis, direction: 1 })
		lineIds.forEach((id, index) => {
			const plan = planById.get(id as TLShapeId)!
			animLines.push({
				id: plan.id,
				index,
				count: lineIds.length,
				kind: 'arrow',
				arrow: { prop: plan.prop, from: plan.from, to: plan.to },
			})
		})
	})

	editor.markHistoryStoppingPoint('zip-wires')
	if (!reduced) {
		const anim = { ...$zipAnim.get() }
		for (const line of animLines) if (line.kind === 'connection') anim[line.id] = { factor: 0 }
		$zipAnim.set(anim)
	}
	// The final values, in one history step (one Ctrl+Z undoes the whole zip).
	editor.run(() => {
		connectionBundles.forEach((bundle, i) => {
			for (const id of bundle.ids) {
				editor.updateShape({
					id: id as TLShapeId,
					type: 'connection',
					meta: { zip: { bundle: connectionBundleIds[i], offset: bundle.lanes[id] } },
				})
			}
		})
		for (const plan of plans) {
			editor.updateShape<TLArrowShape>({
				id: plan.id,
				type: 'arrow',
				props: { [plan.prop]: plan.to },
				meta: { zip: { ...plan.zip } },
			})
		}
	})
	if (!reduced) animate(editor, animLines, sliders, true)
	return animLines.length
}

/** Put zipped wires and arrows back the way they were. Returns the number of lines unzipped. */
export function unzipWires(editor: Editor, notify: ZipNotify): number {
	const zipped = zipTargets(editor).filter(hasZip)
	if (!zipped.length) {
		notify('No zipped wires or arrows in the selection', 'info')
		return 0
	}
	running?.finish()
	const reduced = prefersReducedMotion(editor)

	// Reverse lane order per bundle (the zip played backwards).
	const byBundle = new Map<string, TLShape[]>()
	for (const shape of zipped) {
		const zip = readZip(shape)!
		const list = byBundle.get(zip.bundle) ?? []
		list.push(shape)
		byBundle.set(zip.bundle, list)
	}
	const animLines: AnimLine[] = []
	const sliders: AnimSlider[] = []
	for (const [bundle, shapes] of byBundle) {
		shapes.sort((a, b) => readZip(b)!.offset - readZip(a)!.offset)
		const frame = zipBundleFrame(shapes.map((s) => lineOf(editor, s)))
		sliders.push({ id: `unzip:${bundle}`, centre: frame.centre, axis: frame.axis, direction: -1 })
		shapes.forEach((shape, index) => {
			const zip = readZip(shape)!
			if (shape.type === 'connection') {
				animLines.push({ id: shape.id, index, count: shapes.length, kind: 'connection' })
			} else {
				const arrow = shape as TLArrowShape
				const prop = arrow.props.kind === 'elbow' && typeof zip.elbowMidPoint === 'number' ? 'elbowMidPoint' : 'bend'
				const to = prop === 'elbowMidPoint' ? zip.elbowMidPoint! : (zip.bend ?? 0)
				animLines.push({ id: shape.id, index, count: shapes.length, kind: 'arrow', arrow: { prop, from: arrow.props[prop], to } })
			}
		})
	}

	editor.markHistoryStoppingPoint('unzip-wires')
	if (!reduced) {
		const anim = { ...$zipAnim.get() }
		for (const shape of zipped) {
			if (shape.type === 'connection') anim[shape.id] = { factor: 1, zip: readZip(shape)! }
		}
		$zipAnim.set(anim)
	}
	editor.run(() => {
		for (const line of animLines) {
			if (line.kind === 'connection') {
				editor.updateShape({ id: line.id, type: 'connection', meta: { zip: null } })
			} else {
				editor.updateShape<TLArrowShape>({
					id: line.id,
					type: 'arrow',
					props: { [line.arrow!.prop]: line.arrow!.to },
					meta: { zip: null },
				})
			}
		}
	})
	if (!reduced) animate(editor, animLines, sliders, false)
	return animLines.length
}
