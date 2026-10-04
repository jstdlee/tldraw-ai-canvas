import { useEffect, useRef, useState } from 'react'
import { T, TldrawUiButton, useEditor } from 'tldraw'
import { AdjustIcon } from '../../components/icons/AdjustIcon'
import { CaptureIcon } from '../../components/icons/CaptureIcon'
import { UpscaleIcon } from '../../components/icons/UpscaleIcon'
import {
	NODE_HEADER_HEIGHT_PX,
	NODE_IMAGE_PREVIEW_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_ROW_HEIGHT_PX,
	NODE_WIDTH_PX,
} from '../../constants'
import {
	canvasToStoredUrl,
	centeredAspectRect,
	cropImage,
	FILTER_PRESETS,
	filterImage,
	ImageFilter,
	loadImageElement,
	NO_FILTER,
	resizeImage,
} from '../../imageOps'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { PortRow, stopEvent } from './fields'
import {
	areAnyInputsOutOfDate,
	coerceToText,
	ExecutionResult,
	getInput,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeImage,
	NodeRow,
	STOP_EXECUTION,
	updateNode,
} from './shared'

const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
const portY = (row: number) => BASE_Y + NODE_ROW_HEIGHT_PX * (row + 0.5)
const imageIn = (): ShapePort => ({ id: 'image', x: 0, y: portY(0), terminal: 'end', dataType: 'image' })
const imageOut = (): ShapePort => ({
	id: 'output',
	x: NODE_WIDTH_PX,
	y: NODE_HEADER_HEIGHT_PX / 2,
	terminal: 'start',
	dataType: 'image',
})

function Preview({ url, error, loading }: { url: string | null; error?: string | null; loading?: boolean }) {
	return (
		<div
			className={'NodeImagePreview' + (loading ? ' NodeImagePreview_loading' : '')}
			style={{ height: NODE_IMAGE_PREVIEW_HEIGHT_PX - 8 }}
		>
			{error ? (
				<span className="NodeStatus is-error">{error}</span>
			) : url ? (
				<NodeImage src={url} alt="result" />
			) : (
				<span className="NodeRow-disconnected">Press ▶ Play</span>
			)}
		</div>
	)
}

/** Shared execute wrapper for one-image-in, one-image-out nodes. */
async function runImageOp<N extends { lastResultUrl: string | null; error: string | null }>(
	def: NodeDefinition<any>,
	shape: NodeShape,
	inputs: InputValues,
	op: (src: string) => Promise<string>
): Promise<ExecutionResult> {
	const src = coerceToText(getInput(inputs, 'image'))
	if (!src) {
		updateNode<any>(def.editor, shape, (n: N) => ({ ...n, error: 'Connect an image' }), false)
		return { output: STOP_EXECUTION }
	}
	try {
		const url = await op(src)
		updateNode<any>(def.editor, shape, (n: N) => ({ ...n, lastResultUrl: url, error: null }))
		return { output: url }
	} catch (e) {
		updateNode<any>(def.editor, shape, (n: N) => ({ ...n, error: (e as Error).message }), false)
		return { output: STOP_EXECUTION }
	}
}

function imageOutputInfo(shape: NodeShape, url: string | null, inputs: InfoValues): InfoValues {
	return {
		output: {
			value: url,
			isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
			dataType: 'image',
		},
	}
}

// ---------------------------------------------------------------------------
// Camera: take a photo with the webcam
// ---------------------------------------------------------------------------

export type CameraNode = T.TypeOf<typeof CameraNode>
export const CameraNode = T.object({
	type: T.literal('camera'),
	lastResultUrl: T.string.nullable(),
	error: T.string.nullable(),
})

const CAMERA_VIEW_PX = 190

export class CameraNodeDefinition extends NodeDefinition<CameraNode> {
	static type = 'camera'
	static validator = CameraNode
	title = 'Camera'
	heading = 'Camera'
	icon = <CaptureIcon />
	category = 'input'
	resultKeys = ['lastResultUrl', 'error'] as const
	getDefault(): CameraNode {
		return { type: 'camera', lastResultUrl: null, error: null }
	}
	getBodyHeightPx() {
		return CAMERA_VIEW_PX + NODE_ROW_HEIGHT_PX
	}
	getPorts(): Record<string, ShapePort> {
		return { output: imageOut() }
	}
	async execute(_shape: NodeShape, node: CameraNode): Promise<ExecutionResult> {
		return { output: node.lastResultUrl ?? STOP_EXECUTION }
	}
	getOutputInfo(shape: NodeShape, node: CameraNode): InfoValues {
		return imageOutputInfo(shape, node.lastResultUrl, {})
	}
	Component = CameraNodeComponent
}

function CameraNodeComponent({ shape, node }: NodeComponentProps<CameraNode>) {
	const editor = useEditor()
	const videoRef = useRef<HTMLVideoElement>(null)
	const [stream, setStream] = useState<MediaStream | null>(null)

	useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream])

	const start = async () => {
		try {
			const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } })
			setStream(s)
			if (videoRef.current) videoRef.current.srcObject = s
			updateNode<CameraNode>(editor, shape, (n) => ({ ...n, error: null }), false)
		} catch (e) {
			updateNode<CameraNode>(editor, shape, (n) => ({ ...n, error: `Camera: ${(e as Error).message}` }), false)
		}
	}

	const snap = async () => {
		const video = videoRef.current
		if (!video || !stream) return
		const canvas = document.createElement('canvas')
		canvas.width = video.videoWidth
		canvas.height = video.videoHeight
		canvas.getContext('2d')!.drawImage(video, 0, 0)
		const url = await canvasToStoredUrl(canvas, 'image/jpeg')
		updateNode<CameraNode>(editor, shape, (n) => ({ ...n, lastResultUrl: url, error: null }))
		stream.getTracks().forEach((t) => t.stop())
		setStream(null)
	}

	return (
		<>
			<div className="NodeImagePreview NodeGrow" style={{ height: CAMERA_VIEW_PX - 8 }}>
				<video
					ref={videoRef}
					autoPlay
					muted
					playsInline
					style={{ display: stream ? 'block' : 'none', width: '100%', height: '100%', objectFit: 'contain' }}
				/>
				{!stream &&
					(node.error ? (
						<span className="NodeStatus is-error">{node.error}</span>
					) : node.lastResultUrl ? (
						<NodeImage src={node.lastResultUrl} alt="photo" />
					) : (
						<span className="NodeRow-disconnected">Start the camera, then take a photo</span>
					))}
			</div>
			<NodeRow>
				{stream ? (
					<TldrawUiButton type="primary" onPointerDown={stopEvent} onClick={snap}>
						Take photo
					</TldrawUiButton>
				) : (
					<TldrawUiButton type="normal" onPointerDown={stopEvent} onClick={start}>
						{node.lastResultUrl ? 'Retake' : 'Start camera'}
					</TldrawUiButton>
				)}
			</NodeRow>
		</>
	)
}

// ---------------------------------------------------------------------------
// Crop: by aspect preset or by percent box
// ---------------------------------------------------------------------------

export type CropNode = T.TypeOf<typeof CropNode>
export const CropNode = T.object({
	type: T.literal('crop'),
	aspect: T.string,
	x: T.number,
	y: T.number,
	w: T.number,
	h: T.number,
	lastResultUrl: T.string.nullable(),
	error: T.string.nullable(),
})

const ASPECTS: Record<string, number | null> = {
	Custom: null,
	'1:1': 1,
	'4:3': 4 / 3,
	'3:2': 3 / 2,
	'16:9': 16 / 9,
	'9:16': 9 / 16,
	'3:4': 3 / 4,
}

export class CropNodeDefinition extends NodeDefinition<CropNode> {
	static type = 'crop'
	static validator = CropNode
	title = 'Crop'
	heading = 'Crop'
	icon = <CaptureIcon />
	category = 'image'
	resultKeys = ['lastResultUrl', 'error'] as const
	getDefault(): CropNode {
		return { type: 'crop', aspect: '1:1', x: 10, y: 10, w: 80, h: 80, lastResultUrl: null, error: null }
	}
	getBodyHeightPx(_s: NodeShape, node: CropNode) {
		return NODE_ROW_HEIGHT_PX * (node.aspect === 'Custom' ? 4 : 2) + NODE_IMAGE_PREVIEW_HEIGHT_PX
	}
	getPorts(): Record<string, ShapePort> {
		return { image: imageIn(), output: imageOut() }
	}
	async execute(shape: NodeShape, node: CropNode, inputs: InputValues) {
		return runImageOp<CropNode>(this, shape, inputs, async (src) => {
			const ratio = ASPECTS[node.aspect]
			if (ratio == null) return cropImage(src, node)
			const img = await loadImageElement(src)
			return cropImage(src, centeredAspectRect(img.naturalWidth, img.naturalHeight, ratio))
		})
	}
	getOutputInfo(shape: NodeShape, node: CropNode, inputs: InfoValues) {
		return imageOutputInfo(shape, node.lastResultUrl, inputs)
	}
	Component = CropNodeComponent
}

function NumberField({
	label,
	value,
	onChange,
	suffix,
}: {
	label: string
	value: number
	onChange(v: number): void
	suffix?: string
}) {
	return (
		<label className="NodeField-inline">
			<span>{label}</span>
			<input
				type="number"
				className="NodeField-input"
				value={value}
				onPointerDown={stopEvent}
				onKeyDown={stopEvent}
				onChange={(e) => onChange(Number(e.target.value))}
			/>
			{suffix && <span className="NodeField-suffix">{suffix}</span>}
		</label>
	)
}

function CropNodeComponent({ shape, node }: NodeComponentProps<CropNode>) {
	const editor = useEditor()
	const set = (patch: Partial<CropNode>) => updateNode<CropNode>(editor, shape, (n) => ({ ...n, ...patch }))
	return (
		<>
			<PortRow shapeId={shape.id} portId="image" label="Image" dataType="image" />
			<NodeRow>
				<span className="NodeInputRow-label">Shape</span>
				<select className="NodeField-select" value={node.aspect} onPointerDown={stopEvent} onChange={(e) => set({ aspect: e.target.value })}>
					{Object.keys(ASPECTS).map((a) => (
						<option key={a} value={a}>
							{a === 'Custom' ? 'Custom box (%)' : `${a} centred`}
						</option>
					))}
				</select>
			</NodeRow>
			{node.aspect === 'Custom' && (
				<>
					<NodeRow>
						<NumberField label="X" value={node.x} suffix="%" onChange={(x) => set({ x })} />
						<NumberField label="Y" value={node.y} suffix="%" onChange={(y) => set({ y })} />
					</NodeRow>
					<NodeRow>
						<NumberField label="W" value={node.w} suffix="%" onChange={(w) => set({ w })} />
						<NumberField label="H" value={node.h} suffix="%" onChange={(h) => set({ h })} />
					</NodeRow>
				</>
			)}
			<Preview url={node.lastResultUrl} error={node.error} />
		</>
	)
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

export type ImageResizeNode = T.TypeOf<typeof ImageResizeNode>
export const ImageResizeNode = T.object({
	type: T.literal('image_resize'),
	mode: T.string,
	value: T.number,
	value2: T.number,
	lastResultUrl: T.string.nullable(),
	error: T.string.nullable(),
})

export class ImageResizeNodeDefinition extends NodeDefinition<ImageResizeNode> {
	static type = 'image_resize'
	static validator = ImageResizeNode
	title = 'Resize'
	heading = 'Resize'
	icon = <UpscaleIcon />
	category = 'image'
	resultKeys = ['lastResultUrl', 'error'] as const
	getDefault(): ImageResizeNode {
		return { type: 'image_resize', mode: 'fit', value: 1024, value2: 1024, lastResultUrl: null, error: null }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 3 + NODE_IMAGE_PREVIEW_HEIGHT_PX
	}
	getPorts(): Record<string, ShapePort> {
		return { image: imageIn(), output: imageOut() }
	}
	async execute(shape: NodeShape, node: ImageResizeNode, inputs: InputValues) {
		return runImageOp<ImageResizeNode>(this, shape, inputs, (src) =>
			resizeImage(src, { mode: node.mode as 'scale' | 'width' | 'height' | 'fit', value: node.value, value2: node.value2 })
		)
	}
	getOutputInfo(shape: NodeShape, node: ImageResizeNode, inputs: InfoValues) {
		return imageOutputInfo(shape, node.lastResultUrl, inputs)
	}
	Component = ImageResizeNodeComponent
}

function ImageResizeNodeComponent({ shape, node }: NodeComponentProps<ImageResizeNode>) {
	const editor = useEditor()
	const set = (patch: Partial<ImageResizeNode>) =>
		updateNode<ImageResizeNode>(editor, shape, (n) => ({ ...n, ...patch }))
	return (
		<>
			<PortRow shapeId={shape.id} portId="image" label="Image" dataType="image" />
			<NodeRow>
				<span className="NodeInputRow-label">Mode</span>
				<select
					className="NodeField-select"
					value={node.mode}
					onPointerDown={stopEvent}
					onChange={(e) => {
						const mode = e.target.value
						set({ mode, value: mode === 'scale' ? 50 : 1024, value2: 1024 })
					}}
				>
					<option value="fit">Fit inside box (px)</option>
					<option value="scale">Scale (%)</option>
					<option value="width">Width (px), keep ratio</option>
					<option value="height">Height (px), keep ratio</option>
				</select>
			</NodeRow>
			<NodeRow>
				<NumberField
					label={node.mode === 'fit' ? 'W' : node.mode === 'scale' ? 'Scale' : node.mode === 'width' ? 'Width' : 'Height'}
					value={node.value}
					suffix={node.mode === 'scale' ? '%' : 'px'}
					onChange={(value) => set({ value })}
				/>
				{node.mode === 'fit' && <NumberField label="H" value={node.value2} suffix="px" onChange={(value2) => set({ value2 })} />}
			</NodeRow>
			<Preview url={node.lastResultUrl} error={node.error} />
		</>
	)
}

// ---------------------------------------------------------------------------
// Filter: brightness, contrast, colour, presets, rotate, flip (canvas filters)
// ---------------------------------------------------------------------------

export type ImageFilterNode = T.TypeOf<typeof ImageFilterNode>
export const ImageFilterNode = T.object({
	type: T.literal('image_filter'),
	brightness: T.number,
	contrast: T.number,
	saturate: T.number,
	hue: T.number,
	grayscale: T.number,
	sepia: T.number,
	invert: T.number,
	blur: T.number,
	rotate: T.number,
	flipX: T.boolean,
	flipY: T.boolean,
	lastResultUrl: T.string.nullable(),
	error: T.string.nullable(),
})

const SLIDERS: { key: keyof ImageFilter; label: string; min: number; max: number }[] = [
	{ key: 'brightness', label: 'Bright', min: 0, max: 200 },
	{ key: 'contrast', label: 'Contrast', min: 0, max: 200 },
	{ key: 'saturate', label: 'Colour', min: 0, max: 300 },
	{ key: 'hue', label: 'Hue', min: -180, max: 180 },
	{ key: 'grayscale', label: 'Gray', min: 0, max: 100 },
	{ key: 'sepia', label: 'Sepia', min: 0, max: 100 },
	{ key: 'blur', label: 'Blur', min: 0, max: 20 },
]

export class ImageFilterNodeDefinition extends NodeDefinition<ImageFilterNode> {
	static type = 'image_filter'
	static validator = ImageFilterNode
	title = 'Filter'
	heading = 'Filter'
	icon = <AdjustIcon />
	category = 'image'
	resultKeys = ['lastResultUrl', 'error'] as const
	getDefault(): ImageFilterNode {
		return { type: 'image_filter', ...NO_FILTER, lastResultUrl: null, error: null }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 3 + SLIDERS.length * 26 + NODE_IMAGE_PREVIEW_HEIGHT_PX
	}
	getPorts(): Record<string, ShapePort> {
		return { image: imageIn(), output: imageOut() }
	}
	async execute(shape: NodeShape, node: ImageFilterNode, inputs: InputValues) {
		return runImageOp<ImageFilterNode>(this, shape, inputs, (src) => filterImage(src, node))
	}
	getOutputInfo(shape: NodeShape, node: ImageFilterNode, inputs: InfoValues) {
		return imageOutputInfo(shape, node.lastResultUrl, inputs)
	}
	Component = ImageFilterNodeComponent
}

function ImageFilterNodeComponent({ shape, node }: NodeComponentProps<ImageFilterNode>) {
	const editor = useEditor()
	const set = (patch: Partial<ImageFilterNode>) =>
		updateNode<ImageFilterNode>(editor, shape, (n) => ({ ...n, ...patch }))
	return (
		<>
			<PortRow shapeId={shape.id} portId="image" label="Image" dataType="image" />
			<NodeRow>
				<span className="NodeInputRow-label">Preset</span>
				<select
					className="NodeField-select"
					value=""
					onPointerDown={stopEvent}
					onChange={(e) => e.target.value && set({ ...NO_FILTER, rotate: node.rotate, flipX: node.flipX, flipY: node.flipY, ...FILTER_PRESETS[e.target.value] })}
				>
					<option value="">Choose…</option>
					{Object.keys(FILTER_PRESETS).map((p) => (
						<option key={p}>{p}</option>
					))}
				</select>
			</NodeRow>
			<div className="NodeField-block" style={{ height: SLIDERS.length * 26 }}>
				{SLIDERS.map((s) => (
					<label key={s.key} className="NodeSlider" onPointerDown={stopEvent}>
						<span>{s.label}</span>
						<input
							type="range"
							min={s.min}
							max={s.max}
							value={node[s.key] as number}
							onChange={(e) => set({ [s.key]: Number(e.target.value) })}
						/>
						<span className="NodeSlider-value">{node[s.key] as number}</span>
					</label>
				))}
			</div>
			<NodeRow>
				<TldrawUiButton type="normal" onPointerDown={stopEvent} onClick={() => set({ rotate: (node.rotate + 90) % 360 })}>
					⟳ {node.rotate}°
				</TldrawUiButton>
				<TldrawUiButton type="normal" onPointerDown={stopEvent} onClick={() => set({ flipX: !node.flipX })}>
					{node.flipX ? '⇋ on' : '⇋'}
				</TldrawUiButton>
				<TldrawUiButton type="normal" onPointerDown={stopEvent} onClick={() => set({ flipY: !node.flipY })}>
					{node.flipY ? '⇵ on' : '⇵'}
				</TldrawUiButton>
				<TldrawUiButton type="normal" onPointerDown={stopEvent} onClick={() => set({ ...NO_FILTER })}>
					Reset
				</TldrawUiButton>
			</NodeRow>
			<Preview url={node.lastResultUrl} error={node.error} />
		</>
	)
}
