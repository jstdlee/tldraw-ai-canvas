import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
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

const PATH_MIME: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
}

/** Read a png, jpeg, webp or gif from a path on this machine. */
export function importLocalImage(filePath: string): string {
	const full = resolve(filePath.trim())
	let info: ReturnType<typeof statSync>
	try {
		info = statSync(full)
	} catch {
		throw new ConfigError('File not found')
	}
	if (!info.isFile()) throw new ConfigError('Path is not a file')
	if (info.size > 25 * 1024 * 1024) throw new ConfigError('Image is larger than 25 MB')
	const mime = PATH_MIME[extname(full).toLowerCase()]
	if (!mime) throw new ConfigError('Use a png, jpeg, webp, or gif file')
	return saveImage(readFileSync(full), mime)
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
