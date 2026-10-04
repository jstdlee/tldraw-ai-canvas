import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { ConfigError, DATA_DIR } from './config'
import { resolveImage, saveImage } from './images'

/** Files from the Download node and the Save node. Never committed. */
export const DOWNLOAD_DIR = join(DATA_DIR, 'downloads')
export const EXPORT_DIR = join(DATA_DIR, 'exports')

const MAX_BYTES = 50 * 1024 * 1024
const TEXT_PREVIEW_BYTES = 1024 * 1024

export interface HttpRequestInput {
	method?: string
	url: string
	headers?: Record<string, string>
	body?: string
	/** Turn an HTML page into readable text. */
	extractText?: boolean
}

export interface HttpResult {
	status: number
	ok: boolean
	contentType: string
	/** Text body (or extracted text); empty for binary bodies. */
	text: string
	/** Set when the body is an image: stored locally and served from here. */
	imageUrl?: string
	bytes: number
}

function checkUrl(url: string) {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		throw new ConfigError(`Not a valid URL: ${url}`)
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new ConfigError('Only http and https URLs are allowed.')
	}
	return parsed
}

async function readLimited(res: Response): Promise<Uint8Array> {
	const length = Number(res.headers.get('content-length') ?? 0)
	if (length > MAX_BYTES) throw new ConfigError(`Response is too large (${length} bytes, limit 50 MB).`)
	const buf = new Uint8Array(await res.arrayBuffer())
	if (buf.byteLength > MAX_BYTES) throw new ConfigError('Response is too large (limit 50 MB).')
	return buf
}

/** Strip an HTML page down to its readable text. */
export function htmlToText(html: string): string {
	const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
	const body = html
		.replace(/<(script|style|noscript|svg|head|nav|footer)[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, '\n')
		.replace(/<li[^>]*>/gi, '• ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/[ \t\f\v]+/g, ' ')
		.replace(/\n\s*\n\s*\n+/g, '\n\n')
		.split('\n')
		.map((l) => l.trim())
		.join('\n')
		.trim()
	return title ? `${title}\n\n${body}` : body
}

function isTextType(contentType: string) {
	return /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|ld\+json|rss|atom))|\+json|\+xml/.test(
		contentType
	)
}

/** HTTP node: fetch a URL from the server (no browser CORS limits). */
export async function httpRequest(input: HttpRequestInput): Promise<HttpResult> {
	checkUrl(input.url)
	const method = (input.method ?? 'GET').toUpperCase()
	const hasBody = !['GET', 'HEAD'].includes(method) && input.body != null && input.body !== ''
	const headers: Record<string, string> = { 'User-Agent': 'tldraw-ai-canvas/0.1', ...(input.headers ?? {}) }
	if (hasBody && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
		headers['Content-Type'] = /^\s*[[{]/.test(input.body!) ? 'application/json' : 'text/plain'
	}
	const res = await fetch(input.url, {
		method,
		headers,
		body: hasBody ? input.body : undefined,
		redirect: 'follow',
		signal: AbortSignal.timeout(60_000),
	})
	const contentType = res.headers.get('content-type')?.split(';')[0].trim() ?? ''
	const bytes = await readLimited(res)
	if (contentType.startsWith('image/')) {
		return {
			status: res.status,
			ok: res.ok,
			contentType,
			text: '',
			imageUrl: saveImage(bytes, contentType),
			bytes: bytes.byteLength,
		}
	}
	let text = isTextType(contentType) || !contentType ? new TextDecoder().decode(bytes) : ''
	if (contentType === 'application/json' || /\+json$/.test(contentType)) {
		try {
			text = JSON.stringify(JSON.parse(text), null, 2)
		} catch {
			// Not valid JSON after all: keep the raw text.
		}
	}
	if (input.extractText && contentType.includes('html')) text = htmlToText(text)
	return { status: res.status, ok: res.ok, contentType, text, bytes: bytes.byteLength }
}

export function safeFileName(name: string, fallback: string) {
	const clean = basename(name || '')
		.replace(/[^\w.\- ()]+/g, '_')
		.replace(/^\.+/, '')
		.slice(0, 120)
	return clean || fallback
}

function uniquePath(dir: string, name: string) {
	mkdirSync(dir, { recursive: true })
	const dot = name.lastIndexOf('.')
	const stem = dot > 0 ? name.slice(0, dot) : name
	const ext = dot > 0 ? name.slice(dot) : ''
	let path = join(dir, name)
	for (let i = 2; exists(path); i++) path = join(dir, `${stem}-${i}${ext}`)
	return path
}

function exists(path: string) {
	try {
		statSync(path)
		return true
	} catch {
		return false
	}
}

const EXT_BY_TYPE: Record<string, string> = {
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/webp': '.webp',
	'image/gif': '.gif',
	'application/json': '.json',
	'application/pdf': '.pdf',
	'text/html': '.html',
	'text/plain': '.txt',
	'text/csv': '.csv',
}

export interface DownloadResult {
	path: string
	fileName: string
	contentType: string
	bytes: number
	imageUrl?: string
	text?: string
}

/** Download node: save a URL to data/downloads. */
export async function downloadUrl(url: string, fileName?: string): Promise<DownloadResult> {
	const parsed = checkUrl(url)
	const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) })
	if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
	const contentType = res.headers.get('content-type')?.split(';')[0].trim() ?? 'application/octet-stream'
	const bytes = await readLimited(res)
	let name = safeFileName(fileName || decodeURIComponent(basename(parsed.pathname)), 'download')
	if (!name.includes('.') && EXT_BY_TYPE[contentType]) name += EXT_BY_TYPE[contentType]
	const path = uniquePath(DOWNLOAD_DIR, name)
	writeFileSync(path, bytes)
	return {
		path,
		fileName: basename(path),
		contentType,
		bytes: bytes.byteLength,
		...(contentType.startsWith('image/') ? { imageUrl: saveImage(bytes, contentType) } : {}),
		...(isTextType(contentType) && bytes.byteLength <= TEXT_PREVIEW_BYTES
			? { text: new TextDecoder().decode(bytes) }
			: {}),
	}
}

/** Save node: write text or an image to data/exports. */
export async function saveContent(content: string, fileName?: string): Promise<{ path: string; bytes: number }> {
	const isImage = /^(data:image\/|\/api\/images\/)/.test(content)
	let bytes: Uint8Array
	let ext = '.txt'
	if (isImage) {
		const image = await resolveImage(content)
		bytes = image.bytes
		ext = EXT_BY_TYPE[image.mime] ?? '.png'
	} else {
		bytes = new TextEncoder().encode(content)
		if (/^\s*[[{]/.test(content)) {
			try {
				JSON.parse(content)
				ext = '.json'
			} catch {
				// plain text
			}
		}
	}
	const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
	let name = safeFileName((fileName || `canvas-${stamp}`).replace('{{date}}', stamp), `canvas-${stamp}`)
	if (!/\.[a-z0-9]{1,5}$/i.test(name)) name += ext
	const path = uniquePath(EXPORT_DIR, name)
	writeFileSync(path, bytes)
	return { path, bytes: bytes.byteLength }
}

export interface LinkPreview {
	url: string
	title: string
	description: string
	/** Preview image, stored locally so the card still shows offline. */
	image: string
	favicon: string
}

function metaContent(html: string, names: string[]): string {
	for (const name of names) {
		const re = new RegExp(
			`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`,
			'i'
		)
		const m = html.match(re)
		if (m) return decodeEntities(m[1] ?? m[2] ?? '')
	}
	return ''
}

function decodeEntities(s: string) {
	return s
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.trim()
}

async function storeRemoteImage(src: string, base: string): Promise<string> {
	if (!src) return ''
	try {
		const url = new URL(src, base).toString()
		const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
		const type = res.headers.get('content-type')?.split(';')[0] ?? ''
		if (!res.ok || !type.startsWith('image/')) return ''
		const bytes = await readLimited(res)
		return saveImage(bytes, type)
	} catch {
		return ''
	}
}

/** Link cards: read a page's title, description, preview image and icon. */
export async function unfurl(url: string): Promise<LinkPreview> {
	checkUrl(url)
	const res = await fetch(url, {
		redirect: 'follow',
		headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tldraw-ai-canvas link preview)' },
		signal: AbortSignal.timeout(15_000),
	})
	const type = res.headers.get('content-type') ?? ''
	const finalUrl = res.url || url
	if (type.startsWith('image/')) {
		const bytes = await readLimited(res)
		return { url, title: basename(new URL(finalUrl).pathname), description: '', image: saveImage(bytes, type.split(';')[0]), favicon: '' }
	}
	const html = new TextDecoder().decode((await readLimited(res)).slice(0, 512 * 1024))
	const title =
		metaContent(html, ['og:title', 'twitter:title']) ||
		decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') ||
		new URL(finalUrl).hostname
	const description = metaContent(html, ['og:description', 'twitter:description', 'description'])
	const imageSrc = metaContent(html, ['og:image', 'og:image:url', 'twitter:image'])
	const iconSrc =
		html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i)?.[1] ??
		html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["']/i)?.[1] ??
		'/favicon.ico'
	const [image, favicon] = await Promise.all([
		storeRemoteImage(imageSrc, finalUrl),
		storeRemoteImage(iconSrc, finalUrl),
	])
	return { url, title, description, image, favicon }
}
