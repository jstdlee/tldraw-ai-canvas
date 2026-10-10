import { useState } from 'react'
import { T, useEditor } from 'tldraw'
import { categoryOf } from '../../../../shared/nodeGroups'
import { ModelSelect } from '../../../ai/aiConfig'
import { apiGenerateImage } from '../../api/pipelineApi'
import { toImageUrl } from '../../imageOps'
import { startExecution } from '../../execution/executionState'
import { placeImageOnCanvas } from '../../placeOnCanvas'
import { ImageZoom } from '../../editors/LargeEditor'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { IconChevronDown, IconChevronRight, IconSparkle, UiButton, UiEmpty, UiNumberInput, UiSegmented, UiTextArea, UiTextInput } from '../../../ui'
import { PortRow, stopEvent, NodeSelect, useInputConnected } from './fields'
import {
	areAnyInputsOutOfDate,
	ExecutionResult,
	getInputText,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeImage,
	NodeRow,
	updateNode,
} from './shared'

const ROW = NODE_ROW_HEIGHT_PX
const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
// Enough room for at least 4 lines of prompt text at the default node font.
const PROMPT_AREA_PX = 100
// "More settings" (negative prompt + seed): collapsed is just the title row; open adds one content row.
const MORE_SETTINGS_CLOSED_PX = 28
const MORE_SETTINGS_OPEN_PX = MORE_SETTINGS_CLOSED_PX + ROW
// Empty results: a compact placeholder, about 3 rows. Only the real grid (once there
// are images) takes the full height.
const EMPTY_RESULTS_PX = ROW * 3
const GRID_AREA_PX = 220

// Row layout, top to bottom: Model, Prompt (grows), count/size, Ref., More settings, results.
const MODEL_ROW_Y = BASE_Y + ROW * 0.5
const PROMPT_TOP = BASE_Y + ROW
const PROMPT_PORT_Y = PROMPT_TOP + ROW * 0.5
const NSIZE_TOP = PROMPT_TOP + PROMPT_AREA_PX
const REF_TOP = NSIZE_TOP + ROW
const IMAGE_PORT_Y = REF_TOP + ROW * 0.5

const SIZES = [
	{ value: '1024x1024', label: 'Square (1024×1024)' },
	{ value: '1536x1024', label: 'Landscape (1536×1024)' },
	{ value: '1024x1536', label: 'Portrait (1024×1536)' },
	{ value: 'auto', label: 'Auto' },
]

export type ImageGenNode = T.TypeOf<typeof ImageGenNode>
export const ImageGenNode = T.object({
	type: T.literal('image_gen'),
	model: T.string,
	prompt: T.string,
	n: T.number,
	size: T.string,
	negative: T.string,
	seed: T.number.nullable(),
	/** "More settings" (negative prompt + seed) section open/closed. */
	moreOpen: T.boolean.optional(),
	/** A reference image: a URL, data URL, or /api/images/… path. */
	referenceImage: T.string,
	/** JSON array of /api/images/… result URLs. */
	images: T.string,
	lastUsage: T.string.nullable(),
	error: T.string.nullable(),
})

function parseImages(node: ImageGenNode): string[] {
	if (!node.images) return []
	try {
		const parsed = JSON.parse(node.images)
		return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
	} catch {
		return []
	}
}

export class ImageGenNodeDefinition extends NodeDefinition<ImageGenNode> {
	static type = 'image_gen'
	static validator = ImageGenNode
	title = 'Generate image'
	heading = 'Generate image'
	icon = <IconSparkle />
	category = categoryOf('image_gen')
	override showsOutput = true
	override defaultWidthPx = 380
	resultKeys = ['images', 'lastUsage', 'error'] as const
	getDefault(): ImageGenNode {
		return {
			type: 'image_gen',
			model: '',
			prompt: '',
			n: 1,
			size: '1024x1024',
			negative: '',
			seed: null,
			moreOpen: false,
			referenceImage: '',
			images: '',
			lastUsage: null,
			error: null,
		}
	}
	getBodyHeightPx(_shape: NodeShape, node: ImageGenNode) {
		// Model, prompt box, count/size, Ref., More settings, then the results area.
		// The error is not shown here: the card's own error banner already covers it.
		const results = parseImages(node).length ? GRID_AREA_PX : EMPTY_RESULTS_PX
		const moreSettings = node.moreOpen ? MORE_SETTINGS_OPEN_PX : MORE_SETTINGS_CLOSED_PX
		return ROW * 3 + PROMPT_AREA_PX + moreSettings + results
	}
	getPorts(shape: NodeShape, node: ImageGenNode): Record<string, ShapePort> {
		const width = this.getWidthPx(shape, node)
		return {
			model: { id: 'model', x: 0, y: MODEL_ROW_Y, terminal: 'end', dataType: 'text' },
			prompt: { id: 'prompt', x: 0, y: PROMPT_PORT_Y, terminal: 'end', dataType: 'text' },
			image: { id: 'image', x: 0, y: IMAGE_PORT_Y, terminal: 'end', dataType: 'image' },
			output: { id: 'output', x: width, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'image' },
			images: { id: 'images', x: width, y: NODE_HEADER_HEIGHT_PX / 2 + 20, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: ImageGenNode, inputs: InputValues): Promise<ExecutionResult> {
		try {
			const prompt = getInputText(inputs, 'prompt') || node.prompt
			if (!prompt.trim()) throw new Error('Write a prompt first')
			const modelOverride = getInputText(inputs, 'model').trim()
			const model = modelOverride || node.model || undefined
			const imageFromPort = getInputText(inputs, 'image').trim()
			const referenceSource = imageFromPort || node.referenceImage.trim()
			const referenceImage = referenceSource ? await toImageUrl(referenceSource) : undefined
			const result = await apiGenerateImage({
				model,
				prompt,
				n: Math.max(1, Math.min(8, node.n || 1)),
				size: node.size,
				images: referenceImage ? [referenceImage] : undefined,
				negative: node.negative.trim() || undefined,
				seed: node.seed ?? undefined,
			})
			if (!result.images.length) throw new Error('The model did not return an image')
			updateNode<ImageGenNode>(this.editor, shape, (n) => ({ ...n, images: JSON.stringify(result.images), error: null }))
			return { output: result.images[0], images: result.images.join('\n') }
		} catch (error) {
			updateNode<ImageGenNode>(this.editor, shape, (n) => ({ ...n, error: (error as Error).message }), false)
			throw error
		}
	}
	getOutputInfo(shape: NodeShape, node: ImageGenNode, inputs: InfoValues): InfoValues {
		const images = parseImages(node)
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return {
			output: { value: images[0] ?? null, isOutOfDate, dataType: 'image' },
			images: { value: images.length ? images.join('\n') : null, isOutOfDate, dataType: 'text' },
		}
	}
	Component = ImageGenNodeComponent
}

function download(url: string, name: string) {
	const a = document.createElement('a')
	a.href = url
	a.download = name
	a.rel = 'noopener'
	document.body.appendChild(a)
	a.click()
	a.remove()
}

function ImageGenNodeComponent({ shape, node }: NodeComponentProps<ImageGenNode>) {
	const editor = useEditor()
	const [zoom, setZoom] = useState<string | null>(null)
	const imageWired = useInputConnected(shape.id, 'image')
	const modelWired = useInputConnected(shape.id, 'model')
	const set = (patch: Partial<ImageGenNode>) => updateNode<ImageGenNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const images = parseImages(node)
	const run = () => void startExecution(editor, new Set([shape.id]))

	const resultsHeight = (images.length ? GRID_AREA_PX : EMPTY_RESULTS_PX) - 8

	return (
		<>
			{modelWired ? (
				<PortRow shapeId={shape.id} portId="model" label="Model" dataType="text" />
			) : (
				<NodeRow>
					<span className="NodeInputRow-label">Model</span>
					<ModelSelect className="node-model-select" capability="image" value={node.model} onChange={(model) => set({ model })} />
				</NodeRow>
			)}
			<div style={{ height: PROMPT_AREA_PX, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
				<UiTextArea
					className="NodeField-textarea"
					placeholder="Describe the image to generate… (Enter to run, Shift+Enter for a new line)"
					rows={4}
					grow
					value={node.prompt}
					onChange={(prompt) => set({ prompt })}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault()
							run()
						}
					}}
				/>
			</div>
			<NodeRow>
				<UiSegmented value={String(node.n)} options={[1, 2, 4].map((n) => ({ value: String(n), label: String(n) }))} onChange={(n) => set({ n: Number(n) })} />
				<NodeSelect className="NodeField-select" value={node.size} onPointerDown={stopEvent} onChange={(e) => set({ size: e.target.value })}>
					{SIZES.map((s) => (
						<option key={s.value} value={s.value}>
							{s.label}
						</option>
					))}
				</NodeSelect>
			</NodeRow>
			{imageWired ? (
				<PortRow shapeId={shape.id} portId="image" label="Reference" dataType="image" />
			) : (
				<NodeRow>
					<PortRow shapeId={shape.id} portId="image" label="Ref." dataType="image" hint="optional" />
					<UiTextInput placeholder="reference image URL (optional)" value={node.referenceImage} onChange={(referenceImage) => set({ referenceImage })} />
				</NodeRow>
			)}
			<div className="UiSection">
				<button
					type="button"
					className="UiSection-title"
					onPointerDown={stopEvent}
					onClick={() => set({ moreOpen: !node.moreOpen })}
				>
					{node.moreOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
					More settings
				</button>
				{node.moreOpen && (
					<div className="UiSection-body">
						<NodeRow>
							<UiTextInput placeholder="negative prompt (optional)" value={node.negative} onChange={(negative) => set({ negative })} />
							<UiNumberInput placeholder="seed" value={node.seed} onChange={(seed) => set({ seed })} />
						</NodeRow>
					</div>
				)}
			</div>
			<div className="ImageGenNode-grid NodeScroll" style={{ height: resultsHeight }} onPointerDown={stopEvent}>
				{images.length ? (
					<div className={`ImageGenNode-tiles${images.length > 1 ? ' is-grid' : ''}`}>
						{images.map((src, i) => (
							<div key={src + i} className="ImageGenNode-tile">
								<NodeImage src={src} alt={`result ${i + 1}`} />
								<div className="ImageGenNode-tile-actions">
									<UiButton size="sm" variant="low" label="Enlarge" onClick={() => setZoom(src)} />
									<UiButton size="sm" variant="low" label="Place" onClick={() => void placeImageOnCanvas(editor, shape, src)} />
									<UiButton size="sm" variant="low" label="Use as ref." onClick={() => set({ referenceImage: src })} />
									<UiButton size="sm" variant="low" label="Download" onClick={() => download(src, `image-${i + 1}.png`)} />
								</div>
							</div>
						))}
					</div>
				) : (
					<UiEmpty text="Write a prompt and press Run" />
				)}
			</div>
			{zoom && <ImageZoom src={zoom} onClose={() => setZoom(null)} editor={editor} nextTo={shape} />}
		</>
	)
}
