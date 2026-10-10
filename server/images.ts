import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigError, DATA_DIR } from './config'

export const IMAGE_DIR = join(DATA_DIR, 'images')

// ---------------------------------------------------------------------------
// Local image store: every generated or uploaded image is a file on disk,
// served at /api/images/:id. Nothing goes to a cloud bucket.
// ---------------------------------------------------------------------------

const MIME_EXT: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/svg+xml': 'svg',
}

export function isValidImageId(id: string) {
	return /^[a-zA-Z0-9_-]{1,100}$/.test(id)
}

export function saveImage(bytes: Uint8Array, mime = 'image/png', id?: string): string {
	mkdirSync(IMAGE_DIR, { recursive: true })
	const imageId = id ?? `img_${Date.now()}_${randomBytes(4).toString('hex')}`
	if (!isValidImageId(imageId)) throw new ConfigError('Invalid image id')
	const ext = MIME_EXT[mime] ?? 'png'
	writeFileSync(join(IMAGE_DIR, `${imageId}.${ext}`), bytes)
	return `/api/images/${imageId}`
}

export function readImage(imageId: string): { bytes: Uint8Array; mime: string } | null {
	if (!isValidImageId(imageId)) return null
	for (const [mime, ext] of Object.entries(MIME_EXT)) {
		const path = join(IMAGE_DIR, `${imageId}.${ext}`)
		if (existsSync(path)) return { bytes: readFileSync(path), mime }
	}
	return null
}

/** Load an image from a data URL, a local /api/images/ path, or an http(s) URL. */
export async function resolveImage(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
	if (url.startsWith('data:')) {
		const [header, data] = url.split(',', 2)
		const mime = header.match(/data:([^;]+)/)?.[1] ?? 'image/png'
		const bytes = header.includes('base64')
			? Buffer.from(data, 'base64')
			: Buffer.from(decodeURIComponent(data), 'utf8')
		return { bytes, mime }
	}
	const local = url.match(/^(?:https?:\/\/[^/]+)?\/api\/images\/([^/?#]+)/)
	if (local) {
		const image = readImage(local[1])
		if (!image) throw new Error(`Image not found: ${local[1]}`)
		return image
	}
	const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
	if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`)
	return {
		bytes: new Uint8Array(await res.arrayBuffer()),
		mime: res.headers.get('content-type')?.split(';')[0] ?? 'image/png',
	}
}

/** Fetch an image URL and store it locally. */
export async function importRemoteImage(url: string): Promise<string> {
	const image = await resolveImage(url)
	if (!image.mime.startsWith('image/')) throw new ConfigError('URL is not an image')
	return saveImage(image.bytes, image.mime)
}

export function toDataUrl(image: { bytes: Uint8Array; mime: string }) {
	return `data:${image.mime};base64,${Buffer.from(image.bytes).toString('base64')}`
}

export interface ImageProbeResult {
	isImage: boolean
	mime?: string
	width?: number
	height?: number
}

/** PNG/GIF/JPEG/WebP signatures, for when a server lies about (or omits) content-type. */
function sniffImageMime(bytes: Uint8Array): string | null {
	if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
		return 'image/png'
	}
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
	if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return 'image/webp'
	}
	return null
}

/** Is this URL an image? Tries a HEAD first, then a small ranged GET (some servers reject HEAD). */
export async function probeImageUrl(url: string): Promise<ImageProbeResult> {
	const signal = AbortSignal.timeout(5000)
	try {
		const head = await fetch(url, { method: 'HEAD', signal })
		const mime = head.headers.get('content-type')?.split(';')[0]
		if (mime?.startsWith('image/')) return { isImage: true, mime }
		if (head.ok && mime && !mime.startsWith('image/') && mime !== 'application/octet-stream') {
			return { isImage: false, mime }
		}
	} catch {
		// Some servers refuse HEAD, or the request timed out: fall through to a ranged GET.
	}
	try {
		const res = await fetch(url, { headers: { Range: 'bytes=0-4095' }, signal })
		const mime = res.headers.get('content-type')?.split(';')[0]
		if (mime?.startsWith('image/')) return { isImage: true, mime }
		const bytes = new Uint8Array(await res.arrayBuffer())
		const sniffed = sniffImageMime(bytes)
		if (sniffed) return { isImage: true, mime: sniffed }
		return { isImage: false, mime }
	} catch {
		return { isImage: false }
	}
}
