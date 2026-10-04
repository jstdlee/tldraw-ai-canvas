import { useEffect, useRef, useState } from 'react'
import { AssetRecordType, atom, Editor, TLImageShape, TLShapeId, useValue } from 'tldraw'
import { placeImageOnCanvas } from '../pipeline/placeOnCanvas'

/** The image shape being edited, or null. */
export const $imageEditorTarget = atom<TLShapeId | null>('image editor target', null)

interface Edit {
	rotate: 0 | 90 | 180 | 270
	flipX: boolean
	flipY: boolean
	brightness: number
	contrast: number
	saturate: number
	grayscale: number
	sepia: number
	invert: number
	hue: number
	blur: number
	scale: number
}

const NO_EDIT: Edit = {
	rotate: 0,
	flipX: false,
	flipY: false,
	brightness: 100,
	contrast: 100,
	saturate: 100,
	grayscale: 0,
	sepia: 0,
	invert: 0,
	hue: 0,
	blur: 0,
	scale: 100,
}

const SLIDERS: { key: keyof Edit; label: string; min: number; max: number; unit: string }[] = [
	{ key: 'brightness', label: 'Brightness', min: 0, max: 200, unit: '%' },
	{ key: 'contrast', label: 'Contrast', min: 0, max: 200, unit: '%' },
	{ key: 'saturate', label: 'Saturation', min: 0, max: 300, unit: '%' },
	{ key: 'hue', label: 'Hue', min: -180, max: 180, unit: '°' },
	{ key: 'grayscale', label: 'Grayscale', min: 0, max: 100, unit: '%' },
	{ key: 'sepia', label: 'Sepia', min: 0, max: 100, unit: '%' },
	{ key: 'invert', label: 'Invert', min: 0, max: 100, unit: '%' },
	{ key: 'blur', label: 'Blur', min: 0, max: 20, unit: 'px' },
	{ key: 'scale', label: 'Resize', min: 10, max: 300, unit: '%' },
]

const PRESETS: { label: string; edit: Partial<Edit> }[] = [
	{ label: 'Original', edit: {} },
	{ label: 'B & W', edit: { grayscale: 100, contrast: 115 } },
	{ label: 'Vivid', edit: { saturate: 160, contrast: 110 } },
	{ label: 'Warm', edit: { sepia: 35, saturate: 120 } },
	{ label: 'Faded', edit: { contrast: 80, brightness: 110, saturate: 70 } },
	{ label: 'Sketch', edit: { grayscale: 100, contrast: 180, brightness: 120 } },
]

function cssFilter(e: Edit) {
	return [
		`brightness(${e.brightness}%)`,
		`contrast(${e.contrast}%)`,
		`saturate(${e.saturate}%)`,
		`hue-rotate(${e.hue}deg)`,
		`grayscale(${e.grayscale}%)`,
		`sepia(${e.sepia}%)`,
		`invert(${e.invert}%)`,
		e.blur ? `blur(${e.blur}px)` : '',
	].join(' ')
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.crossOrigin = 'anonymous'
		img.onload = () => resolve(img)
		img.onerror = () => reject(new Error('Cannot load the image'))
		img.src = src
	})
}

/** Draw the image with the edit applied. */
function render(img: HTMLImageElement, e: Edit, maxSide?: number): HTMLCanvasElement {
	const s = e.scale / 100
	let w = Math.max(1, Math.round(img.naturalWidth * s))
	let h = Math.max(1, Math.round(img.naturalHeight * s))
	if (maxSide && Math.max(w, h) > maxSide) {
		const k = maxSide / Math.max(w, h)
		w = Math.round(w * k)
		h = Math.round(h * k)
	}
	const turned = e.rotate === 90 || e.rotate === 270
	const canvas = document.createElement('canvas')
	canvas.width = turned ? h : w
	canvas.height = turned ? w : h
	const ctx = canvas.getContext('2d')!
	ctx.filter = cssFilter(e)
	ctx.translate(canvas.width / 2, canvas.height / 2)
	ctx.rotate((e.rotate * Math.PI) / 180)
	ctx.scale(e.flipX ? -1 : 1, e.flipY ? -1 : 1)
	ctx.drawImage(img, -w / 2, -h / 2, w, h)
	return canvas
}

async function uploadCanvas(canvas: HTMLCanvasElement): Promise<string> {
	const blob = await new Promise<Blob>((resolve, reject) =>
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), 'image/png')
	)
	const id = `edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
	const res = await fetch(`/api/images/${id}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob })
	if (!res.ok) throw new Error(`Saving the image failed (${res.status})`)
	return `/api/images/${id}`
}

export function ImageEditorModal({ editor }: { editor: Editor | null }) {
	const target = useValue('image editor target', () => $imageEditorTarget.get(), [])
	const [src, setSrc] = useState<string | null>(null)
	const shape = editor && target ? editor.getShape<TLImageShape>(target) : undefined
	useEffect(() => {
		setSrc(null)
		if (!editor || !shape?.props.assetId) return
		// Resolve browser-stored assets (asset:/blob:) to a loadable URL.
		editor
			.resolveAssetUrl(shape.props.assetId, { shouldResolveToOriginal: true })
			.then((url) => setSrc(url ?? ((editor.getAsset(shape.props.assetId!)?.props as { src?: string })?.src ?? null)))
	}, [editor, shape?.props.assetId])
	if (!editor || !shape || !src) return null
	return <ImageEditorDialog editor={editor} shape={shape} src={src} onClose={() => $imageEditorTarget.set(null)} />
}

function ImageEditorDialog({
	editor,
	shape,
	src,
	onClose,
}: {
	editor: Editor
	shape: TLImageShape
	src: string
	onClose(): void
}) {
	const [edit, setEdit] = useState<Edit>(NO_EDIT)
	const [img, setImg] = useState<HTMLImageElement | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const previewRef = useRef<HTMLDivElement>(null)
	const isDark = useValue('dark', () => editor.user.getIsDarkMode(), [editor])

	useEffect(() => {
		loadImage(src).then(setImg, (e) => setError(e.message))
	}, [src])

	useEffect(() => {
		if (!img || !previewRef.current) return
		const canvas = render(img, edit, 520)
		canvas.className = 'img-editor__canvas'
		previewRef.current.replaceChildren(canvas)
	}, [img, edit])

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])

	const apply = async (asCopy: boolean) => {
		if (!img) return
		setBusy(true)
		try {
			const canvas = render(img, edit)
			const url = await uploadCanvas(canvas)
			if (asCopy) {
				await placeImageOnCanvas(editor, shape, url, { maxSize: Math.max(shape.props.w, shape.props.h) })
			} else {
				const assetId = AssetRecordType.createId()
				const turned = edit.rotate === 90 || edit.rotate === 270
				editor.run(() => {
					editor.markHistoryStoppingPoint('edit image')
					editor.createAssets([
						{
							id: assetId,
							typeName: 'asset',
							type: 'image',
							props: { src: url, w: canvas.width, h: canvas.height, mimeType: 'image/png', name: 'edited.png', isAnimated: false },
							meta: {},
						},
					])
					editor.updateShape<TLImageShape>({
						id: shape.id,
						type: 'image',
						props: {
							assetId,
							w: turned ? shape.props.h : shape.props.w,
							h: turned ? shape.props.w : shape.props.h,
							crop: null,
						},
					})
				})
			}
			onClose()
		} catch (e) {
			setError((e as Error).message)
			setBusy(false)
		}
	}

	const set = (patch: Partial<Edit>) => setEdit((e) => ({ ...e, ...patch }))

	return (
		<div
			className={`ai-modal-backdrop tl-container ${isDark ? 'tl-theme__dark' : 'tl-theme__light'}`}
			onPointerDown={(e) => e.target === e.currentTarget && onClose()}
		>
			<div className="ai-dialog img-editor" role="dialog" aria-modal="true" aria-label="Edit image">
				<div className="ai-dialog__header">
					<h2>Edit image</h2>
					<button className="ai-icon-button" onClick={onClose} aria-label="Close">
						✕
					</button>
				</div>
				<div className="ai-dialog__body img-editor__body">
					<div className="img-editor__preview" ref={previewRef}>
						{error ? <span className="ai-status is-error">{error}</span> : <span className="ai-muted">Loading…</span>}
					</div>
					<div className="img-editor__controls">
						<div className="img-editor__buttons">
							<button className="ai-button" onClick={() => set({ rotate: (((edit.rotate + 270) % 360) as Edit['rotate']) })}>
								⟲ Rotate left
							</button>
							<button className="ai-button" onClick={() => set({ rotate: (((edit.rotate + 90) % 360) as Edit['rotate']) })}>
								⟳ Rotate right
							</button>
							<button className={'ai-button' + (edit.flipX ? ' is-on' : '')} onClick={() => set({ flipX: !edit.flipX })}>
								⇋ Flip
							</button>
							<button className={'ai-button' + (edit.flipY ? ' is-on' : '')} onClick={() => set({ flipY: !edit.flipY })}>
								⇵ Flip
							</button>
						</div>
						<div className="img-editor__buttons">
							{PRESETS.map((p) => (
								<button key={p.label} className="ai-chip" onClick={() => setEdit({ ...NO_EDIT, rotate: edit.rotate, flipX: edit.flipX, flipY: edit.flipY, scale: edit.scale, ...p.edit })}>
									{p.label}
								</button>
							))}
						</div>
						{SLIDERS.map((s) => (
							<label key={s.key} className="img-editor__slider">
								<span>{s.label}</span>
								<input
									type="range"
									min={s.min}
									max={s.max}
									value={edit[s.key] as number}
									onChange={(e) => set({ [s.key]: Number(e.target.value) } as Partial<Edit>)}
								/>
								<span className="img-editor__value">
									{edit[s.key] as number}
									{s.unit}
								</span>
							</label>
						))}
						{img && (
							<div className="ai-muted">
								Output: {Math.round((img.naturalWidth * edit.scale) / 100)} ×{' '}
								{Math.round((img.naturalHeight * edit.scale) / 100)} px. Crop: double-click the image on the canvas.
							</div>
						)}
					</div>
				</div>
				<div className="ai-dialog__footer">
					<button className="ai-button" onClick={() => setEdit(NO_EDIT)}>
						Reset
					</button>
					<span className="ai-spacer" />
					<button className="ai-button" onClick={onClose}>
						Cancel
					</button>
					<button className="ai-button" disabled={busy || !img} onClick={() => apply(true)}>
						Save as copy
					</button>
					<button className="ai-button is-primary" disabled={busy || !img} onClick={() => apply(false)}>
						Apply
					</button>
				</div>
			</div>
		</div>
	)
}
