import { AssetRecordType, Box, createShapeId, Editor, TLShape, toRichText } from 'tldraw'
import { textToRichText } from '../../shared/richTextLists'

/** Room between a shape and a result placed next to it: enough for a labelled link arrow. */
export const NEXT_TO_GAP = 160

/** A free spot to the right of a shape (or the viewport centre). */
export function spotNextTo(editor: Editor, shape: TLShape | null, w: number, h: number) {
	const bounds = shape ? editor.getShapePageBounds(shape.id) : null
	if (!bounds) {
		const c = editor.getViewportPageBounds().center
		return { x: c.x - w / 2, y: c.y - h / 2 }
	}
	return freeSpot(editor, bounds.maxX + NEXT_TO_GAP, bounds.minY, w, h)
}

/** Start at (x, y) and move down past any shape in the way, so results never cover each other. */
export function freeSpot(editor: Editor, x: number, y: number, w: number, h: number) {
	const others = editor
		.getCurrentPageShapes()
		.filter((s) => s.type !== 'arrow' && s.type !== 'connection' && s.type !== 'frame')
		.map((s) => editor.getShapePageBounds(s.id))
		.filter((b): b is Box => !!b)
	for (let moved = true, guard = 0; moved && guard < 200; guard++) {
		moved = false
		for (const b of others) {
			if (x < b.maxX && x + w > b.minX && y < b.maxY && y + h > b.minY) {
				y = b.maxY + 24
				moved = true
			}
		}
	}
	return { x, y }
}

function loadSize(src: string): Promise<{ w: number; h: number }> {
	return new Promise((resolve) => {
		const img = new Image()
		img.onload = () => resolve({ w: img.naturalWidth || 512, h: img.naturalHeight || 512 })
		img.onerror = () => resolve({ w: 512, h: 512 })
		img.src = src
	})
}

/**
 * Put an image (data URL or /api/images/… URL) on the canvas as a normal
 * tldraw image shape, so it can be cropped, drawn on, exported…
 */
export async function placeImageOnCanvas(
	editor: Editor,
	nextTo: TLShape | null,
	src: string,
	opts: { maxSize?: number; name?: string; at?: { x: number; y: number } } = {}
) {
	const { w, h } = await loadSize(src)
	const scale = Math.min(1, (opts.maxSize ?? 480) / Math.max(w, h))
	const sw = Math.round(w * scale)
	const sh = Math.round(h * scale)
	const assetId = AssetRecordType.createId()
	const mimeType = src.startsWith('data:') ? src.slice(5, src.indexOf(';')) : 'image/png'
	const { x, y } = opts.at ? { x: opts.at.x - sw / 2, y: opts.at.y - sh / 2 } : spotNextTo(editor, nextTo, sw, sh)
	const id = createShapeId()
	editor.run(() => {
		editor.createAssets([
			{
				id: assetId,
				typeName: 'asset',
				type: 'image',
				props: { src, w, h, mimeType, name: opts.name ?? 'image', isAnimated: mimeType === 'image/gif' },
				meta: {},
			},
		])
		editor.createShape({ id, type: 'image', x, y, props: { assetId, w: sw, h: sh } })
		editor.select(id)
	})
	return id
}

/** Put text on the canvas: a text shape, or a Markdown clip. */
export function placeTextOnCanvas(
	editor: Editor,
	nextTo: TLShape | null,
	text: string,
	as: 'text' | 'markdown' = 'text'
) {
	const id = createShapeId()
	const w = 380
	const h = Math.min(600, 80 + text.split('\n').length * 20)
	const { x, y } = spotNextTo(editor, nextTo, w, h)
	editor.run(() => {
		if (as === 'markdown') {
			editor.createShape({ id, type: 'markdown', x, y, props: { w, h, md: text } })
		} else {
			editor.createShape({
				id,
				type: 'text',
				x,
				y,
				props: { richText: textToRichText(text), autoSize: false, w },
			})
		}
		editor.select(id)
	})
	return id
}

/** Bounds of the selection, or null. */
export function selectionBounds(editor: Editor): Box | null {
	return editor.getSelectionPageBounds()
}
