import { categoryOf } from '../../../../shared/nodeGroups'
import { useEffect, useRef, useState } from 'react'
import { T, TldrawUiButton, useEditor } from 'tldraw'
import { UiButton, UiIconButton, UiNumberInput, UiSlider, UiTextInput } from '../../../ui'
import { IconReset } from '../../../ui/icons'
import { AdjustIcon } from '../../components/icons/AdjustIcon'
import { CaptureIcon } from '../../components/icons/CaptureIcon'
import { UpscaleIcon } from '../../components/icons/UpscaleIcon'
import {
	getNodeRowHeightPx,
	NODE_HEADER_HEIGHT_PX,
	NODE_IMAGE_PREVIEW_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_WIDTH_PX,
} from '../../constants'
import {
	canvasToStoredUrl,
	centeredAspectRect,
	cropImage,
	applyPreset,
	FILTER_PRESETS,
	filterImage,
	IMAGE_TOOLS,
	ImageFilter,
	imageTool,
	loadImageElement,
	matchPreset,
	NO_FILTER,
	resizeImage,
	toImageUrl,
} from '../../imageOps'
import { Port, ShapePort } from '../../ports/Port'
import { useFieldPortAnchor } from '../../ports/useFieldPortAnchor'
import { NodeShape } from '../NodeShapeUtil'
import { FieldMax, ImageZoom } from '../../editors/LargeEditor'
import { PortRow, stopEvent, NodeSelect, WireField, useWireField } from './fields'
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
const portY = (row: number, rowPx: number) => BASE_Y + rowPx * (row + 0.5)
const imageIn = (rowPx: number): ShapePort => ({ id: 'image', x: 0, y: portY(0, rowPx), terminal: 'end', dataType: 'image' })
const imageOut = (): ShapePort => ({
	id: 'output',
	x: NODE_WIDTH_PX,
	y: NODE_HEADER_HEIGHT_PX / 2,
	terminal: 'start',
	dataType: 'image',
})

function Preview({
	url,
	loading,
	shape,
}: {
	url: string | null
	error?: string | null
	loading?: boolean
	shape?: NodeShape
}) {
	const editor = useEditor()
	const [open, setOpen] = useState(false)
	return (
		<div
			className={'NodeImagePreview NodeScroll' + (loading ? ' NodeImagePreview_loading' : '')}
			style={{ height: NODE_IMAGE_PREVIEW_HEIGHT_PX - 8 }}
		>
			{url ? (
				<>
					<NodeImage src={url} alt="result" />
					<FieldMax title="Open the image" onClick={() => setOpen(true)} />
				</>
			) : (
				<span className="NodeRow-disconnected">Press ▶ Play</span>
			)}
			{open && url && (
				<ImageZoom src={url} onClose={() => setOpen(false)} editor={editor} nextTo={shape} />
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
	const raw = coerceToText(getInput(inputs, 'image'))
	if (!raw) {
		updateNode<any>(def.editor, shape, (n: N) => ({ ...n, error: 'Connect an image' }), false)
		return { output: STOP_EXECUTION }
	}
	try {
		const src = await toImageUrl(raw)
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
	category = categoryOf('camera')
	override showsOutput = true
	resultKeys = ['lastResultUrl', 'error'] as const
	getDefault(): CameraNode {
		return { type: 'camera', lastResultUrl: null, error: null }
	}
	getBodyHeightPx(shape: NodeShape) {
		return CAMERA_VIEW_PX + getNodeRowHeightPx(shape.props.fontSize)
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
					(node.lastResultUrl ? (
						<NodeImage src={node.lastResultUrl} alt="photo" />
					) : (
						<span className="NodeRow-disconnected">Start the camera, then take a photo</span>
					))}
			</div>
			<NodeRow>
				{/* UI-10: the house UiButton (used everywhere else in this card family — "Load"/
				    "Browse" elsewhere have a clear grey background), not tldraw's own
				    TldrawUiButton. "normal" is the variant without that background on either
				    component (`.tlui-button__normal` carries no chrome in tldraw's own CSS) — it
				    read as inert text either way, so the secondary action uses "low" (grey fill),
				    matching "Load"/"Browse". */}
				{stream ? (
					<UiButton variant="primary" size="sm" label="Take photo" onClick={snap} />
				) : (
					<UiButton variant="low" size="sm" label={node.lastResultUrl ? 'Retake' : 'Start camera'} onClick={start} />
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
	category = categoryOf('crop')
	override showsOutput = true
	resultKeys = ['lastResultUrl', 'error'] as const
	getDefault(): CropNode {
		return { type: 'crop', aspect: '1:1', x: 10, y: 10, w: 80, h: 80, lastResultUrl: null, error: null }
	}
	getBodyHeightPx(shape: NodeShape, node: CropNode) {
		// WP17: x/y/w/h each get their own row instead of sharing one.
		return getNodeRowHeightPx(shape.props.fontSize) * (node.aspect === 'Custom' ? 6 : 2) + NODE_IMAGE_PREVIEW_HEIGHT_PX
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		return { image: imageIn(getNodeRowHeightPx(shape.props.fontSize)), output: imageOut() }
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
			<UiNumberInput value={value} onChange={(next) => onChange(next ?? 0)} />
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
			<WireField shapeId={shape.id} fieldKey="aspect" label="Shape">
				<NodeSelect className="NodeField-select" value={node.aspect} onPointerDown={stopEvent} onChange={(e) => set({ aspect: e.target.value })}>
					{Object.keys(ASPECTS).map((a) => (
						<option key={a} value={a}>
							{a === 'Custom' ? 'Custom box (%)' : `${a} centred`}
						</option>
					))}
				</NodeSelect>
			</WireField>
			{node.aspect === 'Custom' && (
				<>
					<WireField shapeId={shape.id} fieldKey="x" label="X %" dataType="number">
						<NumberField label="X" value={node.x} suffix="%" onChange={(x) => set({ x })} />
					</WireField>
					<WireField shapeId={shape.id} fieldKey="y" label="Y %" dataType="number">
						<NumberField label="Y" value={node.y} suffix="%" onChange={(y) => set({ y })} />
					</WireField>
					<WireField shapeId={shape.id} fieldKey="w" label="W %" dataType="number">
						<NumberField label="W" value={node.w} suffix="%" onChange={(w) => set({ w })} />
					</WireField>
					<WireField shapeId={shape.id} fieldKey="h" label="H %" dataType="number">
						<NumberField label="H" value={node.h} suffix="%" onChange={(h) => set({ h })} />
					</WireField>
				</>
			)}
			<Preview url={node.lastResultUrl} error={node.error} shape={shape} />
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
	category = categoryOf('image_resize')
	override showsOutput = true
	resultKeys = ['lastResultUrl', 'error'] as const
	getDefault(): ImageResizeNode {
		return { type: 'image_resize', mode: 'fit', value: 1024, value2: 1024, lastResultUrl: null, error: null }
	}
	getBodyHeightPx(shape: NodeShape, node: ImageResizeNode) {
		// WP17: value/value2 each get their own row instead of sharing one.
		const needsValue2 = node.mode === 'fit' || node.mode === 'exact'
		return getNodeRowHeightPx(shape.props.fontSize) * (needsValue2 ? 4 : 3) + NODE_IMAGE_PREVIEW_HEIGHT_PX
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		return { image: imageIn(getNodeRowHeightPx(shape.props.fontSize)), output: imageOut() }
	}
	async execute(shape: NodeShape, node: ImageResizeNode, inputs: InputValues) {
		return runImageOp<ImageResizeNode>(this, shape, inputs, (src) =>
			resizeImage(src, { mode: node.mode as 'scale' | 'width' | 'height' | 'fit' | 'exact', value: node.value, value2: node.value2 })
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
			<WireField shapeId={shape.id} fieldKey="mode" label="Mode">
				<NodeSelect
					className="NodeField-select"
					value={node.mode}
					onPointerDown={stopEvent}
					onChange={(e) => {
						const mode = e.target.value
						set({ mode, value: mode === 'scale' ? 50 : 1024, value2: 1024 })
					}}
				>
					<option value="fit">Fit inside box (keep ratio)</option>
					<option value="exact">Exact W × H (stretch, ratio not kept)</option>
					<option value="scale">Scale (%)</option>
					<option value="width">Width (px), keep ratio</option>
					<option value="height">Height (px), keep ratio</option>
				</NodeSelect>
			</WireField>
			<WireField shapeId={shape.id} fieldKey="value" label="Value" dataType="number">
				<NumberField
					label={node.mode === 'fit' || node.mode === 'exact' ? 'W' : node.mode === 'scale' ? 'Scale' : node.mode === 'width' ? 'Width' : 'Height'}
					value={node.value}
					suffix={node.mode === 'scale' ? '%' : 'px'}
					onChange={(value) => set({ value })}
				/>
			</WireField>
			{(node.mode === 'fit' || node.mode === 'exact') && (
				<WireField shapeId={shape.id} fieldKey="value2" label="Value 2" dataType="number">
					<NumberField label="H" value={node.value2} suffix="px" onChange={(value2) => set({ value2 })} />
				</WireField>
			)}
			<Preview url={node.lastResultUrl} error={node.error} shape={shape} />
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
	{ key: 'invert', label: 'Invert', min: 0, max: 100 },
	{ key: 'blur', label: 'Blur', min: 0, max: 20 },
]

/** One slider row with its own `field:<key>` port (WP17), at the slider's compact (26px)
 * height rather than a full card row — `WireField` would be too tall here. */
function WireSlider({
	shapeId,
	fieldKey,
	label,
	value,
	onChange,
	...sliderProps
}: {
	shapeId: NodeShape['id']
	fieldKey: string
	label: string
	value: number
	onChange: (v: number) => void
	min: number
	max: number
}) {
	const ref = useFieldPortAnchor<HTMLLabelElement>(shapeId, fieldKey)
	const { portId, port, sourceName } = useWireField(shapeId, fieldKey)
	return (
		<label ref={ref} className="NodeSlider WireField" onPointerDown={stopEvent}>
			<Port shapeId={shapeId} portId={portId} />
			<span>{label}</span>
			{port ? (
				<span className="NodeRow-connected-value" title={sourceName ? `from ${sourceName}` : String(port.value ?? '')}>
					{sourceName ? `${sourceName} → ` : ''}
					{port.isOutOfDate ? '…' : String(port.value ?? '')}
				</span>
			) : (
				<>
					<UiSlider label={label} min={sliderProps.min} max={sliderProps.max} value={value} onChange={onChange} />
					<span className="NodeSlider-value">{value}</span>
				</>
			)}
		</label>
	)
}

export class ImageFilterNodeDefinition extends NodeDefinition<ImageFilterNode> {
	static type = 'image_filter'
	static validator = ImageFilterNode
	title = 'Filter'
	heading = 'Filter'
	icon = <AdjustIcon />
	category = categoryOf('image_filter')
	override showsOutput = true
	resultKeys = ['lastResultUrl', 'error'] as const
	getDefault(): ImageFilterNode {
		return { type: 'image_filter', ...NO_FILTER, lastResultUrl: null, error: null }
	}
	getBodyHeightPx(shape: NodeShape) {
		// WP17: rotate/flip/restore each get their own row instead of sharing one.
		return getNodeRowHeightPx(shape.props.fontSize) * 6 + SLIDERS.length * 26 + NODE_IMAGE_PREVIEW_HEIGHT_PX
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		return { image: imageIn(getNodeRowHeightPx(shape.props.fontSize)), output: imageOut() }
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
			<WireField shapeId={shape.id} fieldKey="preset" label="Preset">
				<NodeSelect
					className="NodeField-select"
					value={matchPreset(node)}
					onPointerDown={stopEvent}
					onChange={(e) => {
						if (e.target.value === 'Custom') return
						set(applyPreset(e.target.value, { rotate: node.rotate, flipX: node.flipX, flipY: node.flipY }))
					}}
				>
					<option value="Custom">Custom</option>
					{Object.keys(FILTER_PRESETS).map((p) => (
						<option key={p} value={p}>
							{p}
						</option>
					))}
				</NodeSelect>
			</WireField>
			<div className="NodeField-block" style={{ height: SLIDERS.length * 26 }}>
				{SLIDERS.map((s) => (
					<WireSlider
						key={s.key}
						shapeId={shape.id}
						fieldKey={s.key}
						label={s.label}
						min={s.min}
						max={s.max}
						value={node[s.key] as number}
						onChange={(next) => set({ [s.key]: next })}
					/>
				))}
			</div>
			<WireField shapeId={shape.id} fieldKey="rotate" label="Rotate" dataType="number">
				<TldrawUiButton type="normal" onPointerDown={stopEvent} onClick={() => set({ rotate: (node.rotate + 90) % 360 })}>
					⟳ {node.rotate}°
				</TldrawUiButton>
			</WireField>
			<WireField shapeId={shape.id} fieldKey="flipX" label="Flip X">
				<TldrawUiButton type="normal" onPointerDown={stopEvent} onClick={() => set({ flipX: !node.flipX })}>
					{node.flipX ? '⇋ on' : '⇋'}
				</TldrawUiButton>
			</WireField>
			<WireField shapeId={shape.id} fieldKey="flipY" label="Flip Y">
				<TldrawUiButton type="normal" onPointerDown={stopEvent} onClick={() => set({ flipY: !node.flipY })}>
					{node.flipY ? '⇵ on' : '⇵'}
				</TldrawUiButton>
			</WireField>
			<NodeRow>
				<TldrawUiButton type="normal" onPointerDown={stopEvent} onClick={() => set({ ...NO_FILTER })}>
					Restore default
				</TldrawUiButton>
			</NodeRow>
			<Preview url={node.lastResultUrl} error={node.error} shape={shape} />
		</>
	)
}

// ---------------------------------------------------------------------------
// Image tools: info, convert, pixelate, border, round, watermark, square, data URL
// ---------------------------------------------------------------------------

export type ImageToolNode = T.TypeOf<typeof ImageToolNode>
export const ImageToolNode = T.object({
	type: T.literal('image_tool'),
	tool: T.string,
	a: T.string,
	b: T.string,
	lastResultUrl: T.string.nullable(),
	lastText: T.string.nullable(),
	error: T.string.nullable(),
})

export class ImageToolNodeDefinition extends NodeDefinition<ImageToolNode> {
	static type = 'image_tool'
	static validator = ImageToolNode
	title = 'Image tools'
	heading = 'Image tools'
	icon = <AdjustIcon />
	category = categoryOf('image_tool')
	override showsOutput = true
	resultKeys = ['lastResultUrl', 'lastText', 'error'] as const
	getDefault(): ImageToolNode {
		return { type: 'image_tool', tool: 'info', a: '', b: '', lastResultUrl: null, lastText: null, error: null }
	}
	getBodyHeightPx(shape: NodeShape, node: ImageToolNode) {
		// WP17: a/b each get their own row instead of sharing one.
		const tool = IMAGE_TOOLS.find((t) => t.id === node.tool) ?? IMAGE_TOOLS[0]
		const needsB = node.tool !== 'look' && 'b' in tool
		return getNodeRowHeightPx(shape.props.fontSize) * (needsB ? 4 : 3) + NODE_IMAGE_PREVIEW_HEIGHT_PX
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		return { image: imageIn(getNodeRowHeightPx(shape.props.fontSize)), output: { ...imageOut(), dataType: 'any' } }
	}
	async execute(shape: NodeShape, node: ImageToolNode, inputs: InputValues): Promise<ExecutionResult> {
		const raw = coerceToText(getInput(inputs, 'image'))
		if (!raw) {
			updateNode<ImageToolNode>(this.editor, shape, (n) => ({ ...n, error: 'Connect an image' }), false)
			return { output: STOP_EXECUTION }
		}
		try {
			const src = await toImageUrl(raw)
			const r = await imageTool(src, node.tool, node.a, node.b)
			updateNode<ImageToolNode>(this.editor, shape, (n) => ({ ...n, lastResultUrl: r.image ?? null, lastText: r.text ?? null, error: null }))
			return { output: r.image ?? r.text ?? STOP_EXECUTION }
		} catch (e) {
			updateNode<ImageToolNode>(this.editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
			return { output: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: ImageToolNode, inputs: InfoValues): InfoValues {
		return {
			output: {
				value: node.lastResultUrl ?? node.lastText,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: node.lastResultUrl ? 'image' : 'text',
			},
		}
	}
	Component = ImageToolNodeComponent
}

function ImageToolNodeComponent({ shape, node }: NodeComponentProps<ImageToolNode>) {
	const editor = useEditor()
	const set = (patch: Partial<ImageToolNode>) => updateNode<ImageToolNode>(editor, shape, (n) => ({ ...n, ...patch }))
	const tool = IMAGE_TOOLS.find((t) => t.id === node.tool) ?? IMAGE_TOOLS[0]
	return (
		<>
			<PortRow shapeId={shape.id} portId="image" label="Image" dataType="image" />
			<WireField shapeId={shape.id} fieldKey="tool" label="Tool">
				<>
					<NodeSelect
						className="NodeField-select"
						value={node.tool}
						onPointerDown={stopEvent}
						onChange={(e) => set({ tool: e.target.value, a: e.target.value === 'look' ? 'JP 90s' : '', b: '' })}
					>
						{IMAGE_TOOLS.map((t) => (
							<option key={t.id} value={t.id}>
								{t.label}
							</option>
						))}
					</NodeSelect>
					{/* WP39: was a full-text button sharing this row with the Tool select, which
					 * squeezed the select down to "Info (size, t…" — a compact icon button with a
					 * tooltip leaves the select its full width. */}
					<UiIconButton icon={<IconReset />} title="Restore default" onClick={() => set({ tool: 'info', a: '', b: '' })} />
				</>
			</WireField>
			<WireField shapeId={shape.id} fieldKey="a" label="Param A">
				{node.tool === 'look' ? (
					<NodeSelect
						className="NodeField-select"
						value={FILTER_PRESETS[node.a] ? node.a : 'JP 90s'}
						onPointerDown={stopEvent}
						onChange={(e) => set({ a: e.target.value })}
					>
						{Object.keys(FILTER_PRESETS)
							.filter((name) => name !== 'None')
							.map((name) => (
								<option key={name} value={name}>
									{name}
								</option>
							))}
					</NodeSelect>
				) : 'a' in tool ? (
					<UiTextInput placeholder={tool.a} value={node.a} onChange={(a) => set({ a })} />
				) : (
					<span className="NodeRow-disconnected">no options</span>
				)}
			</WireField>
			{node.tool !== 'look' && 'b' in tool && (
				<WireField shapeId={shape.id} fieldKey="b" label="Param B">
					<UiTextInput placeholder={tool.b} value={node.b} onChange={(b) => set({ b })} />
				</WireField>
			)}
			{node.lastText && !node.error ? (
				<div className="NodeOutputView NodeGrow" style={{ height: NODE_IMAGE_PREVIEW_HEIGHT_PX - 8 }}>
					<pre className="ValuePreview-text is-mono">{node.lastText.length > 2000 ? node.lastText.slice(0, 2000) + '…' : node.lastText}</pre>
				</div>
			) : (
				<Preview url={node.lastResultUrl} error={node.error} shape={shape} />
			)}
		</>
	)
}
