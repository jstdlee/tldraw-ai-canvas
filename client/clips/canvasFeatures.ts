import QRCode from 'qrcode'
import {
	AssetRecordType,
	createShapeId,
	defaultHandleExternalTextContent,
	Editor,
	getHashForString,
	TLAsset,
	TLShape,
	TLShapeId,
	toRichText,
} from 'tldraw'
import { apiGenerateText, apiHttp } from '../pipeline/api/pipelineApi'
import { placeImageOnCanvas, placeTextOnCanvas } from '../pipeline/placeOnCanvas'
import { isMermaid, looksLikeMarkdown } from '../../shared/clipText'
import { shapeText } from './shapeText'

export { shapeText }

// ---------------------------------------------------------------------------
// Reading the selection
// ---------------------------------------------------------------------------

/** Text of the selection, top-to-bottom then left-to-right; includes children of frames/groups. */
export function selectionText(editor: Editor): string {
	const ids = new Set<TLShapeId>()
	for (const id of editor.getSelectedShapeIds()) {
		ids.add(id)
		for (const child of editor.getShapeAndDescendantIds([id])) ids.add(child)
	}
	return [...ids]
		.map((id) => editor.getShape(id)!)
		.filter(Boolean)
		.sort((a, b) => {
			const pa = editor.getShapePageBounds(a)!
			const pb = editor.getShapePageBounds(b)!
			return Math.abs(pa.minY - pb.minY) > 20 ? pa.minY - pb.minY : pa.minX - pb.minX
		})
		.map((s) => shapeText(editor, s).trim())
		.filter(Boolean)
		.join('\n\n')
}

export function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(reader.result as string)
		reader.onerror = () => reject(reader.error)
		reader.readAsDataURL(blob)
	})
}

/** A PNG snapshot of the selection (what you see), as a data URL. */
export async function selectionSnapshot(editor: Editor): Promise<string | null> {
	const ids = editor.getSelectedShapeIds()
	if (!ids.length) return null
	const { blob } = await editor.toImage(ids, { format: 'png', background: true, scale: 1, padding: 16 })
	return blobToDataUrl(blob)
}

export function selectedImage(
	editor: Editor
): { shape: TLShape; src: string; assetId: TLAsset['id'] } | null {
	const shape = editor.getOnlySelectedShape()
	if (!shape || shape.type !== 'image') return null
	const assetId = (shape.props as { assetId?: TLAsset['id'] }).assetId
	const asset = assetId ? editor.getAsset(assetId) : undefined
	const src = (asset?.props as { src?: string } | undefined)?.src
	return src && assetId ? { shape, src, assetId } : null
}

/** A URL or data URL for the selected image that the server and models can read. */
export async function selectedImageForAI(editor: Editor): Promise<string | null> {
	const image = selectedImage(editor)
	if (!image) return null
	if (image.src.startsWith('data:') || image.src.startsWith('/api/images/') || /^https?:/.test(image.src)) {
		return image.src
	}
	// tldraw keeps dropped images in the browser (asset: / blob: URLs): read the bytes here.
	const url = (await editor.resolveAssetUrl(image.assetId, { shouldResolveToOriginal: true })) ?? image.src
	const blob = await (await fetch(url)).blob()
	return blobToDataUrl(blob)
}

// ---------------------------------------------------------------------------
// AI actions on the selection
// ---------------------------------------------------------------------------

export type Notify = (title: string, severity?: 'info' | 'success' | 'error' | 'warning') => void

const anchor = (editor: Editor) => editor.getOnlySelectedShape() ?? editor.getSelectedShapes()[0] ?? null

async function runAI(
	editor: Editor,
	notify: Notify,
	label: string,
	input: string,
	prompt: string,
	placeAs: 'text' | 'markdown' = 'markdown'
) {
	const near = anchor(editor)
	notify(`${label}…`)
	try {
		const { text } = await apiGenerateText({ input, prompt })
		placeTextOnCanvas(editor, near, text, placeAs)
		notify(`${label}: done`, 'success')
	} catch (e) {
		notify(`${label} failed: ${(e as Error).message}`, 'error')
	}
}

export async function aiDescribeImage(editor: Editor, notify: Notify) {
	const input = (await selectedImageForAI(editor)) ?? (await selectionSnapshot(editor))
	if (!input) return notify('Select an image first', 'warning')
	return runAI(editor, notify, 'Describe image', input, 'Describe this image in detail: subject, setting, style, colours and any text.')
}

export async function aiExtractText(editor: Editor, notify: Notify) {
	const input = (await selectedImageForAI(editor)) ?? (await selectionSnapshot(editor))
	if (!input) return notify('Select an image first', 'warning')
	return runAI(editor, notify, 'Extract text', input, 'Extract all text in this image exactly as written (OCR). Keep line breaks. Return only the text.', 'text')
}

export async function aiExplainSelection(editor: Editor, notify: Notify) {
	const snapshot = await selectionSnapshot(editor)
	if (!snapshot) return notify('Select something first', 'warning')
	return runAI(editor, notify, 'Explain', snapshot, 'Explain what this part of a whiteboard shows (drawings, diagrams, notes). Then suggest 3 next steps. Use Markdown.')
}

export async function aiAskSelection(editor: Editor, notify: Notify) {
	const question = window.prompt('Ask AI about the selection:')
	if (!question) return
	const text = selectionText(editor)
	const snapshot = await selectionSnapshot(editor)
	const input = snapshot ?? text
	if (!input) return notify('Select something first', 'warning')
	const prompt = text ? `Text in the selection:\n${text.slice(0, 8000)}\n\nQuestion: ${question}` : question
	return runAI(editor, notify, 'Ask AI', input, prompt)
}

export async function aiTextJob(editor: Editor, notify: Notify, job: 'summarize' | 'translate' | 'improve' | 'brainstorm') {
	const text = selectionText(editor)
	if (!text) return notify('Select shapes with text first', 'warning')
	if (job === 'translate') {
		const language = window.prompt('Translate into which language?', 'English')
		if (!language) return
		return runAI(editor, notify, 'Translate', text, `Translate the input into ${language}. Keep the formatting. Return only the translation.`)
	}
	const prompts = {
		summarize: 'Summarize the input as a short title line and 3-6 bullet points. Use Markdown.',
		improve: 'Rewrite the input to be clear and concise. Fix grammar. Keep the meaning and formatting.',
		brainstorm: 'Brainstorm 8 new, varied ideas that build on the input. Markdown checklist (- [ ] …).',
	}
	const labels = { summarize: 'Summarize', improve: 'Improve writing', brainstorm: 'Brainstorm' }
	return runAI(editor, notify, labels[job], text, prompts[job])
}

// ---------------------------------------------------------------------------
// Handy tools
// ---------------------------------------------------------------------------

export async function makeQrCode(editor: Editor, notify: Notify) {
	let text = selectionText(editor).trim()
	if (!text) text = window.prompt('Text or link for the QR code:') ?? ''
	if (!text) return
	if (text.length > 1500) return notify('Too much text for a QR code (max ~1500 characters)', 'warning')
	const dataUrl = await QRCode.toDataURL(text, { margin: 1, width: 512, errorCorrectionLevel: 'M' })
	await placeImageOnCanvas(editor, anchor(editor), dataUrl, { maxSize: 200, name: 'qr-code.png' })
}

export function insertDateTime(editor: Editor) {
	const now = new Date()
	const text = `${now.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })} ${now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
	const point = editor.inputs.getCurrentPagePoint?.() ?? editor.getViewportPageBounds().center
	const id = createShapeId()
	editor.createShape({ id, type: 'text', x: point.x, y: point.y, props: { richText: toRichText(text) } })
	editor.select(id)
}

export function wordCount(editor: Editor, notify: Notify) {
	const text = selectionText(editor)
	const words = text.trim() ? text.trim().split(/\s+/).length : 0
	notify(`${words} words · ${text.length} characters · ${editor.getSelectedShapeIds().length} shapes`)
}

export async function fetchPageAsMarkdown(editor: Editor, notify: Notify) {
	const url = window.prompt('Web page URL:', 'https://')
	if (!url || url === 'https://') return
	notify('Fetching page…')
	try {
		const result = await apiHttp({ method: 'GET', url, extractText: true })
		if (!result.ok) throw new Error(`HTTP ${result.status}`)
		const [title, ...rest] = result.text.split('\n')
		const md = `# [${title.trim() || url}](${url})\n\n${rest.join('\n').trim().slice(0, 20000)}`
		placeTextOnCanvas(editor, null, md, 'markdown')
	} catch (e) {
		notify(`Fetch failed: ${(e as Error).message}`, 'error')
	}
}

export function createClipAtCenter(editor: Editor, type: 'markdown' | 'mermaid') {
	const c = editor.getViewportPageBounds().center
	const id = createShapeId()
	const [w, h] = type === 'markdown' ? [360, 260] : [420, 300]
	editor.createShape({ id, type, x: c.x - w / 2, y: c.y - h / 2 })
	editor.select(id)
	editor.setEditingShape(id)
}

/** Send the selected image into a new "Load image" pipeline node. */
export async function sendImageToPipeline(editor: Editor, notify: Notify) {
	const image = selectedImage(editor)
	const src = await selectedImageForAI(editor)
	if (!image || !src) return notify('Select an image first', 'warning')
	const bounds = editor.getShapePageBounds(image.shape)!
	const id = createShapeId()
	editor.createShape({
		id,
		type: 'node',
		x: bounds.maxX + 60,
		y: bounds.minY,
		props: { node: { type: 'load_image', imageUrl: src }, isOutOfDate: false },
	})
	editor.select(id)
}

// ---------------------------------------------------------------------------
// Paste & link cards
// ---------------------------------------------------------------------------

/**
 * - URLs become link cards: title, description, picture and icon are read by
 *   the local server (and stored, so the card still shows offline).
 * - Pasted Mermaid becomes a diagram clip; pasted Markdown becomes a Markdown clip.
 */
export function registerClipHandlers(editor: Editor) {
	editor.registerExternalAssetHandler('url', async ({ url }) => {
		let meta = { title: '', description: '', image: '', favicon: '' }
		try {
			const res = await fetch(`/api/unfurl?url=${encodeURIComponent(url)}`)
			if (res.ok) meta = await res.json()
		} catch {
			// Offline: the card shows just the URL.
		}
		return AssetRecordType.create({
			id: AssetRecordType.createId(getHashForString(url)),
			typeName: 'asset',
			type: 'bookmark',
			props: {
				src: url,
				title: meta.title,
				description: meta.description,
				image: meta.image,
				favicon: meta.favicon,
			},
			meta: {},
		})
	})

	editor.registerExternalContentHandler('text', async (info) => {
		const text = info.text ?? ''
		const point = info.point ?? editor.getViewportPageBounds().center
		if (!info.html && isMermaid(text)) {
			const id = createShapeId()
			editor.createShape({
				id,
				type: 'mermaid',
				x: point.x - 210,
				y: point.y - 150,
				props: { code: text.replace(/^```mermaid\s*|```\s*$/g, '').trim() },
			})
			editor.select(id)
			return
		}
		if (!info.html && looksLikeMarkdown(text)) {
			const id = createShapeId()
			const h = Math.min(600, 80 + text.split('\n').length * 20)
			editor.createShape({ id, type: 'markdown', x: point.x - 190, y: point.y - h / 2, props: { w: 380, h, md: text } })
			editor.select(id)
			return
		}
		await defaultHandleExternalTextContent(editor, { point: info.point, text, html: info.html })
	})
}
