import { Editor, ImageShapeUtil, TLImageShape, TLTextShape } from 'tldraw'

/**
 * Per-shape options for built-in shapes:
 *  - images keep their aspect ratio when resized, unless meta.freeRatio is set
 *  - text wraps at its width (autoSize off) or grows on one line (autoSize on)
 */
export class RatioImageShapeUtil extends ImageShapeUtil {
	override isAspectRatioLocked(shape: TLImageShape) {
		return !shape.meta?.freeRatio
	}
}

export function imagesKeepRatio(editor: Editor): boolean {
	const images = editor.getSelectedShapes().filter((s) => s.type === 'image')
	return images.length > 0 && images.every((s) => !s.meta?.freeRatio)
}

export function toggleImageRatio(editor: Editor) {
	const images = editor.getSelectedShapes().filter((s) => s.type === 'image')
	if (!images.length) return false
	const free = imagesKeepRatio(editor)
	editor.updateShapes(images.map((s) => ({ id: s.id, type: s.type, meta: { ...s.meta, freeRatio: free } })))
	return true
}

/** Turn wrapping on (fixed width) or off (auto width) for the selected text shapes. */
export function toggleTextWrap(editor: Editor) {
	const texts = editor.getSelectedShapes().filter((s): s is TLTextShape => s.type === 'text')
	if (!texts.length) return null
	const wrapOn = texts.some((t) => t.props.autoSize)
	editor.markHistoryStoppingPoint('toggle text wrap')
	editor.updateShapes(
		texts.map((t) => {
			const bounds = editor.getShapePageBounds(t)
			return {
				id: t.id,
				type: 'text' as const,
				// Wrap at the current width, but never wider than 600 px.
				props: wrapOn ? { autoSize: false, w: Math.min(600, Math.max(120, bounds?.w ?? 300)) } : { autoSize: true },
			}
		})
	)
	return wrapOn
}
