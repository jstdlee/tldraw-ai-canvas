/**
 * A node output stays small. Text over 1024 bytes is cut and the full text goes
 * to a file. More than 10 images go to a folder instead of riding inline.
 */

export const OUTPUT_BYTE_LIMIT = 1024
export const IMAGE_DIR_THRESHOLD = 10

const encoder = new TextEncoder()
const IMAGE_DATA = /^data:image\/[a-z0-9.+-]+;base64,/i

export function byteLength(text: string): number {
	return encoder.encode(text).length
}

export function isImageDataUrl(value: string): boolean {
	return IMAGE_DATA.test(value)
}

/** The longest start of `text` that fits in `limit` bytes without splitting a character. */
export function truncateToBytes(text: string, limit = OUTPUT_BYTE_LIMIT): string {
	if (byteLength(text) <= limit) return text
	let lo = 0
	let hi = Math.min(text.length, limit)
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2)
		if (byteLength(text.slice(0, mid)) <= limit) lo = mid
		else hi = mid - 1
	}
	// Do not end on half of a surrogate pair.
	const code = text.charCodeAt(lo - 1)
	if (code >= 0xd800 && code <= 0xdbff) lo--
	return text.slice(0, lo)
}

/** Image data URLs in a value: a JSON array of them, or one per line. Null when it is not a list of images. */
export function listImages(value: string): string[] | null {
	const text = value.trim()
	if (!text) return null
	let items: unknown[] | null = null
	if (text.startsWith('[')) {
		try {
			const parsed: unknown = JSON.parse(text)
			if (Array.isArray(parsed)) items = parsed
		} catch {
			// Not JSON. Try lines below.
		}
	}
	if (!items) items = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
	if (items.length < 2) return null
	return items.every((item) => typeof item === 'string' && isImageDataUrl(item)) ? (items as string[]) : null
}

/** A single image output is kept whole. Only text and image lists are capped. */
export function needsFile(value: string): boolean {
	if (isImageDataUrl(value.trim()) && !value.includes('\n')) return false
	const images = listImages(value)
	if (images) return images.length > IMAGE_DIR_THRESHOLD
	return byteLength(value) > OUTPUT_BYTE_LIMIT
}
