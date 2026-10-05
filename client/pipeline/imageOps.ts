/**
 * Image operations that run in the browser (canvas 2D). Results are stored in
 * the local image store (/api/images/…), so documents stay small.
 */

import { FILTER_PRESETS, type ImageFilter, NO_FILTER } from '../../shared/imageFilters'

export type { ImageFilter } from '../../shared/imageFilters'
export { applyPreset, FILTER_PRESETS, matchPreset, NO_FILTER } from '../../shared/imageFilters'

export function loadImageElement(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.crossOrigin = 'anonymous'
		img.onload = () => resolve(img)
		img.onerror = () => reject(new Error('Cannot load the image'))
		img.src = src
	})
}

export async function canvasToStoredUrl(canvas: HTMLCanvasElement, type = 'image/png'): Promise<string> {
	const blob = await new Promise<Blob>((resolve, reject) =>
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), type, 0.92)
	)
	return storeBlob(blob)
}

export async function storeBlob(blob: Blob): Promise<string> {
	const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
	const res = await fetch(`/api/images/${id}`, {
		method: 'POST',
		headers: { 'Content-Type': blob.type || 'image/png' },
		body: blob,
	})
	if (!res.ok) throw new Error(`Saving the image failed (${res.status})`)
	return `/api/images/${id}`
}

export interface CropRect {
	/** All in percent of the image (0–100). */
	x: number
	y: number
	w: number
	h: number
}

export async function cropImage(src: string, rect: CropRect): Promise<string> {
	const img = await loadImageElement(src)
	const sx = Math.round((img.naturalWidth * clampPct(rect.x)) / 100)
	const sy = Math.round((img.naturalHeight * clampPct(rect.y)) / 100)
	const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round((img.naturalWidth * clampPct(rect.w)) / 100)))
	const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round((img.naturalHeight * clampPct(rect.h)) / 100)))
	const canvas = document.createElement('canvas')
	canvas.width = sw
	canvas.height = sh
	canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
	return canvasToStoredUrl(canvas)
}

/** Crop to an aspect ratio (e.g. 1 for square), centred. */
export function centeredAspectRect(imgW: number, imgH: number, aspect: number): CropRect {
	const current = imgW / imgH
	if (current > aspect) {
		const w = (aspect / current) * 100
		return { x: (100 - w) / 2, y: 0, w, h: 100 }
	}
	const h = (current / aspect) * 100
	return { x: 0, y: (100 - h) / 2, w: 100, h }
}

export async function resizeImage(
	src: string,
	opts: { mode: 'scale' | 'width' | 'height' | 'fit' | 'exact'; value: number; value2?: number }
): Promise<string> {
	const img = await loadImageElement(src)
	const iw = img.naturalWidth
	const ih = img.naturalHeight
	let w = iw
	let h = ih
	switch (opts.mode) {
		case 'scale':
			w = (iw * opts.value) / 100
			h = (ih * opts.value) / 100
			break
		case 'width':
			w = opts.value
			h = (ih * opts.value) / iw
			break
		case 'height':
			h = opts.value
			w = (iw * opts.value) / ih
			break
		case 'exact':
			// Stretch to exactly W × H (ratio not kept).
			w = opts.value
			h = opts.value2 ?? opts.value
			break
		case 'fit': {
			const k = Math.min(opts.value / iw, (opts.value2 ?? opts.value) / ih)
			w = iw * k
			h = ih * k
			break
		}
	}
	const canvas = document.createElement('canvas')
	canvas.width = Math.max(1, Math.round(w))
	canvas.height = Math.max(1, Math.round(h))
	const ctx = canvas.getContext('2d')!
	ctx.imageSmoothingQuality = 'high'
	ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
	return canvasToStoredUrl(canvas)
}

export function cssFilter(f: ImageFilter) {
	return [
		`brightness(${f.brightness}%)`,
		`contrast(${f.contrast}%)`,
		`saturate(${f.saturate}%)`,
		`hue-rotate(${f.hue}deg)`,
		`grayscale(${f.grayscale}%)`,
		`sepia(${f.sepia}%)`,
		`invert(${f.invert}%)`,
		f.blur ? `blur(${f.blur}px)` : '',
	].join(' ')
}

export async function filterImage(src: string, f: ImageFilter): Promise<string> {
	const img = await loadImageElement(src)
	const w = img.naturalWidth
	const h = img.naturalHeight
	const turned = f.rotate % 180 !== 0
	const canvas = document.createElement('canvas')
	canvas.width = turned ? h : w
	canvas.height = turned ? w : h
	const ctx = canvas.getContext('2d')!
	ctx.filter = cssFilter(f)
	ctx.translate(canvas.width / 2, canvas.height / 2)
	ctx.rotate((f.rotate * Math.PI) / 180)
	ctx.scale(f.flipX ? -1 : 1, f.flipY ? -1 : 1)
	ctx.drawImage(img, -w / 2, -h / 2, w, h)
	return canvasToStoredUrl(canvas)
}

function clampPct(v: number) {
	return Math.min(100, Math.max(0, Number.isFinite(v) ? v : 0))
}

export const IMAGE_TOOLS = [
	{ id: 'info', label: 'Info (size, type, colours)' },
	{ id: 'convert', label: 'Convert format', a: 'png / jpeg / webp', b: 'quality 1-100 (jpeg/webp)' },
	{ id: 'pixelate', label: 'Pixelate', a: 'block size px (12)' },
	{ id: 'border', label: 'Add border', a: 'width px (16)', b: 'colour (#ffffff)' },
	{ id: 'round', label: 'Round corners', a: 'radius px (32)' },
	{ id: 'watermark', label: 'Watermark text', a: 'text', b: 'position: br, bl, tr, tl, center' },
	{ id: 'square', label: 'Pad to square', b: 'colour (#ffffff)' },
	{ id: 'data_url', label: 'To data URL (base64 text)' },
	{ id: 'look', label: 'Look (film preset)', a: 'JP 90s, Kodak Gold, Noir…' },
] as const

async function blobInfo(src: string) {
	const res = await fetch(src)
	const blob = await res.blob()
	return { type: blob.type || 'unknown', bytes: blob.size }
}

/** Run one image tool. Returns an image URL, or text for info / data URL. */
export async function imageTool(src: string, tool: string, a: string, b: string): Promise<{ image?: string; text?: string }> {
	const img = await loadImageElement(src)
	const w = img.naturalWidth
	const h = img.naturalHeight
	const canvas = document.createElement('canvas')
	const ctx = canvas.getContext('2d')!
	const draw = (cw = w, ch = h) => {
		canvas.width = cw
		canvas.height = ch
	}
	switch (tool) {
		case 'look': {
			const preset = FILTER_PRESETS[a.trim()] ?? FILTER_PRESETS['JP 90s'] ?? {}
			return { image: await filterImage(src, { ...NO_FILTER, ...preset }) }
		}
		case 'info': {
			draw(64, 64)
			ctx.drawImage(img, 0, 0, 64, 64)
			const data = ctx.getImageData(0, 0, 64, 64).data
			let r = 0
			let g = 0
			let bl = 0
			for (let i = 0; i < data.length; i += 4) {
				r += data[i]
				g += data[i + 1]
				bl += data[i + 2]
			}
			const n = data.length / 4
			const avg = '#' + [r, g, bl].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('')
			const meta = await blobInfo(src).catch(() => ({ type: 'unknown', bytes: 0 }))
			const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x)
			const d = gcd(w, h)
			return {
				text: [
					`Size        ${w} × ${h} px (${((w * h) / 1e6).toFixed(2)} MP)`,
					`Ratio       ${w / d}:${h / d}`,
					`Type        ${meta.type}`,
					`File size   ${meta.bytes ? (meta.bytes / 1024).toFixed(1) + ' KB' : 'unknown'}`,
					`Avg colour  ${avg}`,
				].join('\n'),
			}
		}
		case 'convert': {
			draw()
			const format = (a || 'png').toLowerCase().replace('jpg', 'jpeg')
			if (!['png', 'jpeg', 'webp'].includes(format)) throw new Error('Format must be png, jpeg or webp')
			if (format === 'jpeg') {
				ctx.fillStyle = '#ffffff'
				ctx.fillRect(0, 0, w, h)
			}
			ctx.drawImage(img, 0, 0)
			const quality = Math.min(100, Math.max(1, Number(b) || 90)) / 100
			const blob = await new Promise<Blob>((resolve, reject) =>
				canvas.toBlob((x) => (x ? resolve(x) : reject(new Error('Export failed'))), `image/${format}`, quality)
			)
			return { image: await storeBlob(blob) }
		}
		case 'pixelate': {
			const size = Math.max(2, Number(a) || 12)
			const sw = Math.max(1, Math.round(w / size))
			const sh = Math.max(1, Math.round(h / size))
			const small = document.createElement('canvas')
			small.width = sw
			small.height = sh
			small.getContext('2d')!.drawImage(img, 0, 0, sw, sh)
			draw()
			ctx.imageSmoothingEnabled = false
			ctx.drawImage(small, 0, 0, w, h)
			return { image: await canvasToStoredUrl(canvas) }
		}
		case 'border': {
			const bw = Math.max(1, Number(a) || 16)
			draw(w + bw * 2, h + bw * 2)
			ctx.fillStyle = b || '#ffffff'
			ctx.fillRect(0, 0, canvas.width, canvas.height)
			ctx.drawImage(img, bw, bw)
			return { image: await canvasToStoredUrl(canvas) }
		}
		case 'round': {
			const r = Math.min(Math.max(1, Number(a) || 32), w / 2, h / 2)
			draw()
			ctx.beginPath()
			ctx.roundRect(0, 0, w, h, r)
			ctx.clip()
			ctx.drawImage(img, 0, 0)
			return { image: await canvasToStoredUrl(canvas) }
		}
		case 'watermark': {
			draw()
			ctx.drawImage(img, 0, 0)
			const text = a || '© you'
			const size = Math.max(12, Math.round(Math.min(w, h) / 18))
			ctx.font = `600 ${size}px Inter, sans-serif`
			const pad = size * 0.8
			const tw = ctx.measureText(text).width
			const pos = (b || 'br').toLowerCase()
			const x = pos.includes('l') ? pad : pos === 'center' ? (w - tw) / 2 : w - tw - pad
			const y = pos.includes('t') ? pad + size : pos === 'center' ? h / 2 : h - pad
			ctx.lineWidth = Math.max(2, size / 8)
			ctx.strokeStyle = 'rgba(0,0,0,0.55)'
			ctx.fillStyle = 'rgba(255,255,255,0.9)'
			ctx.strokeText(text, x, y)
			ctx.fillText(text, x, y)
			return { image: await canvasToStoredUrl(canvas) }
		}
		case 'square': {
			const side = Math.max(w, h)
			draw(side, side)
			ctx.fillStyle = b || '#ffffff'
			ctx.fillRect(0, 0, side, side)
			ctx.drawImage(img, (side - w) / 2, (side - h) / 2)
			return { image: await canvasToStoredUrl(canvas) }
		}
		case 'data_url': {
			draw()
			ctx.drawImage(img, 0, 0)
			return { text: canvas.toDataURL('image/png') }
		}
		default:
			throw new Error(`Unknown image tool ${tool}`)
	}
}
