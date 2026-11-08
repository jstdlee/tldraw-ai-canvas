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
import { apiGenerateText, apiHttp, apiImportImage, apiProbeImage } from '../pipeline/api/pipelineApi'
import { placeImageOnCanvas, placeTextOnCanvas } from '../pipeline/placeOnCanvas'
import { isMermaid, looksLikeMarkdown } from '../../shared/clipText'
import { pastePatch } from '../../shared/pasteTarget'
import { NodeShape } from '../pipeline/nodes/NodeShapeUtil'
import { shapeText } from './shapeText'
import { derivedSources, linkAllDerived } from './derivedLink'

export { shapeText }

// ---------------------------------------------------------------------------
// Reading the selection
// ---------------------------------------------------------------------------

/** Text of the selection, top-to-bottom then left-to-right; includes children of frames/groups. */
export function selectionText(editor: Editor): string {
	return textOfShapes(editor, editor.getSelectedShapeIds())
}

/** Text of these shapes (and their children), top-to-bottom then left-to-right. */
export function textOfShapes(editor: Editor, shapeIds: TLShapeId[]): string {
	const ids = new Set<TLShapeId>()
	for (const id of shapeIds) {
		if (!editor.getShape(id)) continue
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

/** A PNG snapshot of these shapes (what you see), as a data URL. */
export async function snapshotOf(editor: Editor, shapeIds: TLShapeId[]): Promise<string | null> {
	const ids = shapeIds.filter((id) => editor.getShape(id))
	if (!ids.length) return null
	const { blob } = await editor.toImage(ids, { format: 'png', background: true, scale: 1, padding: 16 })
	return blobToDataUrl(blob)
}

function imageOf(editor: Editor, shape: TLShape | undefined): { shape: TLShape; src: string; assetId: TLAsset['id'] } | null {
	if (!shape || shape.type !== 'image') return null
	const assetId = (shape.props as { assetId?: TLAsset['id'] }).assetId
	const asset = assetId ? editor.getAsset(assetId) : undefined
	const src = (asset?.props as { src?: string } | undefined)?.src
	return src && assetId ? { shape, src, assetId } : null
}

export function selectedImage(
	editor: Editor
): { shape: TLShape; src: string; assetId: TLAsset['id'] } | null {
	return imageOf(editor, editor.getOnlySelectedShape() ?? undefined)
}

/** A URL or data URL for the selected image that the server and models can read. */
export async function selectedImageForAI(editor: Editor): Promise<string | null> {
	const shape = editor.getOnlySelectedShape()
	return shape ? imageForAI(editor, shape.id) : null
}

/** A URL or data URL for one image shape that the server and models can read. */
export async function imageForAI(editor: Editor, shapeId: TLShapeId): Promise<string | null> {
	const image = imageOf(editor, editor.getShape(shapeId))
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

export interface AiJobResult {
	text: string
	/** The text or Markdown shape the result was placed in. */
	placedId: TLShapeId
}

/**
 * WP44: one AI job on some shapes: ask the model, place the answer next to `near`, and link
 * every source to it with a derived arrow. Returns the answer; throws on failure (the agent
 * panel shows it as a task message, not a toast).
 */
export async function runAI(
	editor: Editor,
	job: {
		label: string
		input: string
		prompt: string
		placeAs?: 'text' | 'markdown'
		near: TLShape | null
		sources: TLShapeId[]
		signal?: AbortSignal
	}
): Promise<AiJobResult> {
	const { text } = await apiGenerateText({ input: job.input, prompt: job.prompt }, job.signal)
	if (!text.trim()) throw new Error('The model sent an empty answer. Try again or pick another model.')
	const placedId = placeTextOnCanvas(editor, job.near, text, job.placeAs ?? 'markdown')
	linkAllDerived(editor, job.sources, placedId, job.label)
	return { text, placedId }
}

const TEXT_JOB_PROMPTS = {
	summarize: 'Summarize the input as a short title line and 3-6 bullet points. Use Markdown.',
	improve: 'Rewrite the input to be clear and concise. Fix grammar. Keep the meaning and formatting.',
	brainstorm: 'Brainstorm 8 new, varied ideas that build on the input. Markdown checklist (- [ ] …).',
}

const TEXT_JOB_LABELS = { summarize: 'Summarize', improve: 'Improve writing', brainstorm: 'Brainstorm' }

/** The shapes a job reads, minus arrows (they are links, not sources). */
function jobSources(editor: Editor, ids: TLShapeId[]): TLShapeId[] {
	return ids.filter((id) => {
		const shape = editor.getShape(id)
		return shape && shape.type !== 'arrow'
	})
}

function jobAnchor(editor: Editor, ids: TLShapeId[]): TLShape | null {
	for (const id of ids) {
		const shape = editor.getShape(id)
		if (shape) return shape
	}
	return null
}

/** Summarize / translate / improve / brainstorm the text of these shapes. */
export async function runTextJob(
	editor: Editor,
	ids: TLShapeId[],
	job: 'summarize' | 'translate' | 'improve' | 'brainstorm',
	opts: { language?: string; signal?: AbortSignal } = {}
): Promise<AiJobResult> {
	const input = textOfShapes(editor, ids)
	if (!input) throw new Error('Select shapes with text first.')
	const near = jobAnchor(editor, ids)
	const sources = jobSources(editor, ids)
	if (job === 'translate') {
		const language = opts.language?.trim() || 'English'
		return runAI(editor, {
			label: `Translate → ${language}`,
			input,
			prompt: `Translate the input into ${language}. Keep the formatting. Return only the translation.`,
			near,
			sources,
			signal: opts.signal,
		})
	}
	return runAI(editor, { label: TEXT_JOB_LABELS[job], input, prompt: TEXT_JOB_PROMPTS[job], near, sources, signal: opts.signal })
}

/** Describe an image, or read its text (OCR). Falls back to a snapshot of the shapes. */
export async function runImageJob(
	editor: Editor,
	ids: TLShapeId[],
	job: 'describe' | 'ocr',
	opts: { signal?: AbortSignal } = {}
): Promise<AiJobResult> {
	const imageId = ids.find((id) => editor.getShape(id)?.type === 'image')
	const input = (imageId ? await imageForAI(editor, imageId) : null) ?? (await snapshotOf(editor, ids))
	if (!input) throw new Error('Select an image first.')
	const near = jobAnchor(editor, ids)
	const sources = jobSources(editor, ids)
	if (job === 'describe') {
		return runAI(editor, {
			label: 'Describe image',
			input,
			prompt: 'Describe this image in detail: subject, setting, style, colours and any text.',
			near,
			sources,
			signal: opts.signal,
		})
	}
	return runAI(editor, {
		label: 'Extract text',
		input,
		prompt: 'Extract all text in this image exactly as written (OCR). Keep line breaks. Return only the text.',
		placeAs: 'text',
		near,
		sources,
		signal: opts.signal,
	})
}

/** Explain what these shapes show (from a snapshot), with 3 next steps. */
export async function runExplain(editor: Editor, ids: TLShapeId[], opts: { signal?: AbortSignal } = {}): Promise<AiJobResult> {
	const snapshot = await snapshotOf(editor, ids)
	if (!snapshot) throw new Error('Select something first.')
	return runAI(editor, {
		label: 'Explain',
		input: snapshot,
		prompt: 'Explain what this part of a whiteboard shows (drawings, diagrams, notes, workflow cards). Then suggest 3 next steps. Use Markdown.',
		near: jobAnchor(editor, ids),
		sources: jobSources(editor, ids),
		signal: opts.signal,
	})
}

// ---------------------------------------------------------------------------
// Handy tools
// ---------------------------------------------------------------------------

export async function makeQrCode(editor: Editor, notify: Notify) {
	let text = selectionText(editor).trim()
	const sources = text ? derivedSources(editor) : []
	if (!text) text = window.prompt('Text or link for the QR code:') ?? ''
	if (!text) return
	if (text.length > 1500) return notify('Too much text for a QR code (max ~1500 characters)', 'warning')
	const dataUrl = await QRCode.toDataURL(text, { margin: 1, width: 512, errorCorrectionLevel: 'M' })
	const id = await placeImageOnCanvas(editor, anchor(editor), dataUrl, { maxSize: 200, name: 'qr-code.png' })
	linkAllDerived(editor, sources, id, 'QR code')
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

/** Send the selected image into a new "Load image" pipeline node. Returns the new card's id. */
export async function sendImageToPipeline(editor: Editor, notify?: Notify): Promise<TLShapeId | null> {
	const image = selectedImage(editor)
	const src = await selectedImageForAI(editor)
	if (!image || !src) {
		notify?.('Select an image first', 'warning')
		return null
	}
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
	return id
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

	/** A pasted link that points at an image: a resizable image shape, not a bookmark card. */
	editor.registerExternalContentHandler('url', async (info) => {
		const { url } = info
		const point = info.point ?? editor.getViewportPageBounds().center
		let isImage = /\.(png|jpe?g|gif|webp|bmp|avif|svg)(?:[?#].*)?$/i.test(url)
		if (!isImage) {
			try {
				isImage = (await apiProbeImage(url)).isImage
			} catch {
				isImage = false
			}
		}
		if (isImage) {
			try {
				const imageUrl = await apiImportImage(url)
				const selected = editor.getOnlySelectedShape()
				if (selected && editor.isShapeOfType<NodeShape>(selected, 'node')) {
					const patch = pastePatch(selected.props.node as unknown as { type: string }, { imageUrl })
					if (patch) {
						editor.updateShape<NodeShape>({
							id: selected.id,
							type: 'node',
							props: { node: { ...(selected.props.node as unknown as Record<string, unknown>), ...patch } as NodeShape['props']['node'], isOutOfDate: true },
						})
						return
					}
				}
				await placeImageOnCanvas(editor, null, imageUrl, { maxSize: 640, name: url.split('/').pop(), at: point })
				return
			} catch {
				// Fall through to the normal bookmark card below.
			}
		}
		const asset = await editor.getAssetForExternalContent({ type: 'url', url })
		if (!asset) return
		const id = createShapeId()
		editor.createShape({ id, type: 'bookmark', x: point.x - 150, y: point.y - 160, props: { url, assetId: asset.id } })
		editor.select(id)
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

/**
 * IMAGE-01: Ctrl+V of an image file (not a URL — an actual clipboard image, e.g. a screenshot)
 * had no paste path at all, despite the Load image card's own placeholder text promising
 * "paste". A capture-phase `paste` listener on `window` runs before tldraw's own (bubble-phase)
 * paste handling gets a look at the event: when the clipboard has an image file AND exactly one
 * selected shape is a node card whose type accepts an image (`pastePatch`, the same function the
 * card footer's own "Paste" menu item already uses), the image lands in that card's own field
 * and the event is suppressed; otherwise nothing is done, so the native paste proceeds exactly
 * as it always did (tldraw's own canvas-paste for an image file, or anything else).
 * Returns an unsubscribe function (app-lifetime in practice; offered for symmetry/tests).
 */
export function registerLoadImagePaste(editor: Editor): () => void {
	const onPaste = (event: ClipboardEvent) => {
		const files = event.clipboardData?.files
		const imageFile = files && Array.from(files).find((file) => file.type.startsWith('image/'))
		if (!imageFile) return
		const selected = editor.getOnlySelectedShape()
		if (!selected || !editor.isShapeOfType<NodeShape>(selected, 'node')) return
		// A placeholder value just to ask "does this node type have a field pastePatch would set
		// for an image?" before committing to pre-empting the native paste.
		if (!pastePatch(selected.props.node as unknown as { type: string }, { imageUrl: 'x' })) return

		event.preventDefault()
		event.stopPropagation()
		const reader = new FileReader()
		reader.onload = () => {
			const imageUrl = String(reader.result)
			const fresh = editor.getShape<NodeShape>(selected.id)
			if (!fresh) return
			const patch = pastePatch(fresh.props.node as unknown as { type: string }, { imageUrl })
			if (!patch) return
			editor.updateShape<NodeShape>({
				id: fresh.id,
				type: 'node',
				props: { node: { ...(fresh.props.node as unknown as Record<string, unknown>), ...patch } as NodeShape['props']['node'], isOutOfDate: true },
			})
		}
		reader.readAsDataURL(imageFile)
	}
	window.addEventListener('paste', onPaste, { capture: true })
	return () => window.removeEventListener('paste', onPaste, { capture: true })
}
