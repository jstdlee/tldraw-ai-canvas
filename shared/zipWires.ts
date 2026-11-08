/**
 * WP43 "Zip wires": pure maths. Lines (pipeline wires and arrows) that run roughly the same way
 * are grouped into bundles. Each line keeps its own ends, but its middle is pulled onto a lane
 * next to the others, parallel and in an order with no crossings.
 */

export interface ZipPoint {
	x: number
	y: number
}

export interface ZipLine {
	id: string
	start: ZipPoint
	end: ZipPoint
}

export interface ZipBundle {
	/** Line ids in lane order (smallest offset first). */
	ids: string[]
	/** Unit vector: the mean direction of the lines. */
	axis: ZipPoint
	/** Unit vector: the axis turned 90°. Lane offsets are measured along it. */
	normal: ZipPoint
	/** Mean of the lines' natural middle points. */
	centre: ZipPoint
	/** Lane offset of each line along the normal, relative to the centre. */
	lanes: Record<string, number>
}

/** Page units between two neighbouring lanes. */
export const ZIP_GAP = 10
/** Lines whose directions differ by more than this never share a bundle. */
export const ZIP_MAX_ANGLE_DEG = 35
/** Middle points closer than this along the normal can share a bundle (or 0.6 × the shorter line). */
export const ZIP_MIN_REACH = 160

const COS_MAX_ANGLE = Math.cos((ZIP_MAX_ANGLE_DEG * Math.PI) / 180)

const sub = (a: ZipPoint, b: ZipPoint): ZipPoint => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: ZipPoint, b: ZipPoint): ZipPoint => ({ x: a.x + b.x, y: a.y + b.y })
const mul = (a: ZipPoint, k: number): ZipPoint => ({ x: a.x * k, y: a.y * k })
const dot = (a: ZipPoint, b: ZipPoint) => a.x * b.x + a.y * b.y
const len = (a: ZipPoint) => Math.hypot(a.x, a.y)
const lerp = (a: ZipPoint, b: ZipPoint, t: number): ZipPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const unit = (a: ZipPoint): ZipPoint => {
	const l = len(a)
	return l ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 }
}
/** The vector turned 90° (x → y). */
export const zipNormalOf = (axis: ZipPoint): ZipPoint => ({ x: -axis.y, y: axis.x })

export const lineMiddle = (line: { start: ZipPoint; end: ZipPoint }): ZipPoint => lerp(line.start, line.end, 0.5)
const lineDir = (line: ZipLine) => unit(sub(line.end, line.start))
const lineLength = (line: ZipLine) => len(sub(line.end, line.start))

function canJoin(a: ZipLine, b: ZipLine): boolean {
	const da = lineDir(a)
	const db = lineDir(b)
	if (dot(da, db) < COS_MAX_ANGLE) return false
	const normal = zipNormalOf(unit(add(da, db)))
	const apart = Math.abs(dot(sub(lineMiddle(a), lineMiddle(b)), normal))
	return apart <= Math.max(ZIP_MIN_REACH, 0.6 * Math.min(lineLength(a), lineLength(b)))
}

/** Bundle geometry (axis, normal, centre) for a set of lines, without lanes. */
export function zipBundleFrame(lines: { start: ZipPoint; end: ZipPoint }[]): {
	axis: ZipPoint
	normal: ZipPoint
	centre: ZipPoint
} {
	let sum = { x: 0, y: 0 }
	let centre = { x: 0, y: 0 }
	for (const line of lines) {
		sum = add(sum, unit(sub(line.end, line.start)))
		centre = add(centre, lineMiddle(line))
	}
	const axis = unit(sum)
	return { axis, normal: zipNormalOf(axis), centre: lines.length ? mul(centre, 1 / lines.length) : centre }
}

/**
 * Greedy grouping: each line joins the first bundle whose every member is within
 * ZIP_MAX_ANGLE_DEG of it and close enough sideways. Bundles of one line are dropped.
 */
export function computeZipBundles(lines: ZipLine[]): ZipBundle[] {
	const valid = lines.filter((line) => lineLength(line) > 0)
	const groups: ZipLine[][] = []
	for (const line of valid) {
		const group = groups.find((members) => members.every((member) => canJoin(member, line)))
		if (group) group.push(line)
		else groups.push([line])
	}
	return groups
		.filter((group) => group.length >= 2)
		.map((group) => {
			const { axis, normal, centre } = zipBundleFrame(group)
			const side = (line: ZipLine) => (dot(line.start, normal) + dot(line.end, normal)) / 2
			const ordered = [...group].sort((a, b) => side(a) - side(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
			const lanes: Record<string, number> = {}
			ordered.forEach((line, i) => {
				lanes[line.id] = (i - (ordered.length - 1) / 2) * ZIP_GAP
			})
			return { ids: ordered.map((line) => line.id), axis, normal, centre, lanes }
		})
}

/**
 * The page point the zipped line passes through: its own middle along the axis, and the bundle
 * centre + offset along the normal.
 */
export function zipLanePoint(
	line: { start: ZipPoint; end: ZipPoint },
	bundleCentre: ZipPoint,
	axis: ZipPoint,
	offset: number
): ZipPoint {
	const normal = zipNormalOf(axis)
	const mid = lineMiddle(line)
	return add(mid, mul(normal, dot(sub(bundleCentre, mid), normal) + offset))
}

// --- Pipeline wires --------------------------------------------------------------------------

export interface ZipCubic {
	start: ZipPoint
	cp1: ZipPoint
	cp2: ZipPoint
	end: ZipPoint
}

/** Same rule as the app's wire (`getConnectionControlPoints`): horizontal out / in tangents. */
export function connectionControlPoints(start: ZipPoint, end: ZipPoint): [ZipPoint, ZipPoint] {
	const distance = end.x - start.x
	const reach = Math.max(30, distance > 0 ? distance / 3 : Math.min(Math.max(Math.abs(distance) + 30, 0), 100))
	return [
		{ x: start.x + reach, y: start.y },
		{ x: end.x - reach, y: end.y },
	]
}

/** The unzipped wire, split at t = 0.5 into two cubics that draw exactly the same curve. */
function naturalHalves(start: ZipPoint, end: ZipPoint): [ZipCubic, ZipCubic] {
	const [c1, c2] = connectionControlPoints(start, end)
	const ab = lerp(start, c1, 0.5)
	const bc = lerp(c1, c2, 0.5)
	const cd = lerp(c2, end, 0.5)
	const abc = lerp(ab, bc, 0.5)
	const bcd = lerp(bc, cd, 0.5)
	const mid = lerp(abc, bcd, 0.5)
	return [
		{ start, cp1: ab, cp2: abc, end: mid },
		{ start: mid, cp1: bcd, cp2: cd, end },
	]
}

function zippedHalves(start: ZipPoint, end: ZipPoint, lane: ZipPoint, axis: ZipPoint): [ZipCubic, ZipCubic] {
	const a = unit(axis)
	const [out] = connectionControlPoints(start, lane)
	const [, into] = connectionControlPoints(lane, end)
	const k1 = len(sub(lane, start)) / 3
	const k2 = len(sub(end, lane)) / 3
	return [
		{ start, cp1: out, cp2: sub(lane, mul(a, k1)), end: lane },
		{ start: lane, cp1: add(lane, mul(a, k2)), cp2: into, end },
	]
}

function cubicPath(cubics: ZipCubic[]): string {
	const f = (n: number) => Math.round(n * 1000) / 1000
	let d = `M ${f(cubics[0].start.x)} ${f(cubics[0].start.y)}`
	for (const c of cubics) {
		d += ` C ${f(c.cp1.x)} ${f(c.cp1.y)} ${f(c.cp2.x)} ${f(c.cp2.y)} ${f(c.end.x)} ${f(c.end.y)}`
	}
	return d
}

/**
 * Path of a zipped wire: two cubics, start → lane point → end. The tangent at the lane point is
 * the bundle axis; the tangents at the ends stay horizontal. `factor` (0…1) blends from the
 * normal wire (0, exactly the old curve) to the zipped one (1), for the zip animation.
 */
export function zippedConnectionPath(
	start: ZipPoint,
	end: ZipPoint,
	lane: ZipPoint,
	axis: ZipPoint,
	factor = 1
): { d: string; segments: [ZipCubic, ZipCubic]; middle: ZipPoint } {
	const t = Math.min(1, Math.max(0, factor))
	const zipped = zippedHalves(start, end, lane, axis)
	const segments: [ZipCubic, ZipCubic] =
		t >= 1
			? zipped
			: (naturalHalves(start, end).map((half, i) => ({
					start: lerp(half.start, zipped[i].start, t),
					cp1: lerp(half.cp1, zipped[i].cp1, t),
					cp2: lerp(half.cp2, zipped[i].cp2, t),
					end: lerp(half.end, zipped[i].end, t),
				})) as [ZipCubic, ZipCubic])
	return { d: cubicPath(segments), segments, middle: segments[0].end }
}

// --- Arc arrows ------------------------------------------------------------------------------

/**
 * Where an arc arrow's middle should go: the arc middle always lies on the perpendicular
 * bisector of its ends, so take the point where that bisector meets the lane line (the line
 * through the lane point, along the axis). Close to `zipLanePoint` when the arrow runs along the
 * axis; exactly on the lane, so the lanes stay parallel.
 */
export function arcLaneMiddle(
	start: ZipPoint,
	end: ZipPoint,
	bundleCentre: ZipPoint,
	axis: ZipPoint,
	offset: number
): ZipPoint {
	const lane = zipLanePoint({ start, end }, bundleCentre, axis, offset)
	const med = lineMiddle({ start, end })
	const u = unit(sub(end, start))
	const perp = { x: u.y, y: -u.x }
	const normal = zipNormalOf(axis)
	const along = dot(perp, normal)
	if (Math.abs(along) < 1e-6) return lane
	return add(med, mul(perp, dot(sub(lane, med), normal) / along))
}

/**
 * tldraw's arc arrow puts its middle at `med + per(u) × -bend` (u = unit start → end,
 * per(v) = (v.y, -v.x)), in arrow space. This returns the bend that puts it at `middle`.
 */
export function arcBendFor(start: ZipPoint, end: ZipPoint, middle: ZipPoint): number {
	const med = lineMiddle({ start, end })
	const u = unit(sub(end, start))
	return -dot(sub(middle, med), { x: u.y, y: -u.x })
}
