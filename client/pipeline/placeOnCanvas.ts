import { AssetRecordType, Box, createShapeId, Editor, TLShape, toRichText } from 'tldraw'

/** A free spot to the right of a shape (or the viewport centre). */
function spotNextTo(editor: Editor, shape: TLShape | null, w: number, h: number) {
	const bounds = shape ? editor.getShapePageBounds(shape.id) : null
	if (bounds) return { x: bounds.maxX + 40, y: bounds.minY }
	const c = editor.getViewportPageBounds().center
	return { x: c.x - w / 2, y: c.y - h / 2 }
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
	opts: { maxSize?: number; name?: string } = {}
) {
	const { w, h } = await loadSize(src)
	const scale = Math.min(1, (opts.maxSize ?? 480) / Math.max(w, h))
	const sw = Math.round(w * scale)
	const sh = Math.round(h * scale)
	const assetId = AssetRecordType.createId()
	const mimeType = src.startsWith('data:') ? src.slice(5, src.indexOf(';')) : 'image/png'
	const { x, y } = spotNextTo(editor, nextTo, sw, sh)
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
				props: { richText: toRichText(text), autoSize: false, w },
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
