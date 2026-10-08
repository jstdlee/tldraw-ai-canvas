/**
 * Cap what gets written onto canvas shapes. Wire values between nodes always
 * carry the full text/image; only when a value is placed on a shape (spill or
 * an output→shape arrow) do we cut it, so a huge dump doesn't flood the canvas.
 * Text over the cap spills to a file and the shape shows a preview plus the path.
 */

/** Text written to a canvas shape is cut at this many bytes. */
export const CANVAS_TEXT_CAP = 1024
/** More than this many generated images go to a folder instead of the canvas. */
export const CANVAS_IMAGE_CAP = 10

export interface CappedText {
	/** What to show on the shape. */
	text: string
	/** The file the full text was saved to, when it was cut. */
	path?: string
	/** True when the text was cut. */
	cut: boolean
}

const encoder = new TextEncoder()

function byteLength(text: string): number {
	return encoder.encode(text).length
}

/** Cut to whole UTF-8 characters within `bytes`. */
function cutToBytes(text: string, bytes: number): string {
	let out = ''
	let used = 0
	for (const ch of text) {
		const size = encoder.encode(ch).length
		if (used + size > bytes) break
		out += ch
		used += size
	}
	return out
}

async function postJson<T>(url: string, body: unknown): Promise<T | null> {
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
		if (!response.ok) return null
		return (await response.json()) as T
	} catch {
		return null
	}
}

/**
 * Cap text meant for a canvas shape. Over the cap, the full text goes to
 * /api/output and the shape gets a preview plus the saved path. On a server
 * failure the shape still gets the (cut) preview.
 */
export async function capTextForCanvas(name: string, text: string): Promise<CappedText> {
	if (byteLength(text) <= CANVAS_TEXT_CAP) return { text, cut: false }
	const preview = cutToBytes(text, CANVAS_TEXT_CAP)
	const saved = await postJson<{ path?: string }>('/api/output', { name, text })
	const path = saved?.path
	return {
		text: `${preview}\n\n… (${formatBytes(byteLength(text))} total${path ? `, saved to ${path}` : ''})`,
		path,
		cut: true,
	}
}

export interface CappedImages {
	/** Images to keep inline (at most CANVAS_IMAGE_CAP). */
	inline: string[]
	/** The folder the rest were saved to, when spilled. */
	dir?: string
	/** Saved file paths, when spilled. */
	paths?: string[]
	/** True when some images were spilled to disk. */
	spilled: boolean
}

/**
 * Keep up to CANVAS_IMAGE_CAP images inline; spill the rest to a folder via
 * /api/output/images. Values that are not data URLs stay inline (nothing to save).
 */
export async function capImagesForCanvas(name: string, images: string[]): Promise<CappedImages> {
	if (images.length <= CANVAS_IMAGE_CAP) return { inline: images, spilled: false }
	const inline = images.slice(0, CANVAS_IMAGE_CAP)
	const rest = images.slice(CANVAS_IMAGE_CAP)
	const dataUrls = rest.filter((src) => src.startsWith('data:image/'))
	if (!dataUrls.length) return { inline, spilled: false }
	const saved = await postJson<{ dir?: string; paths?: string[] }>('/api/output/images', { name, images: dataUrls })
	if (!saved?.dir) return { inline, spilled: false }
	return { inline, dir: saved.dir, paths: saved.paths, spilled: true }
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
