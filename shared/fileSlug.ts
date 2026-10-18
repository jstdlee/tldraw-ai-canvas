/**
 * IMAGE-06 / GAPS-17 / O: a small, shared "make this a safe, readable file-name stem" helper,
 * used by every download/save path (the node footer's "Download image", Generate image's tile
 * downloads, and the Save card's file name) so results are named after the thing that made them,
 * not a generic literal like "image.png" that collides across cards and runs. Pure, no tldraw
 * import, testable in Node.
 */
export function slugifyFileName(name: string, fallback = 'file'): string {
	const slug = (name ?? '')
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60)
	return slug || fallback
}

/** A short, sortable timestamp stem (base36 ms since epoch) to tell repeated downloads of the
 * same card apart without a long ISO string. */
export function shortTimeStamp(date: Date = new Date()): string {
	return date.getTime().toString(36)
}
