import { useState } from 'react'
import { T, useEditor } from 'tldraw'
import { categoryOf } from '../../../../shared/nodeGroups'
import { ModelSelect } from '../../../ai/aiConfig'
import { apiGenerateImage } from '../../api/pipelineApi'
import { toImageUrl } from '../../imageOps'
import { currentRunSignal, startExecution } from '../../execution/executionState'
import { isAbortError } from '../../../../shared/abort'
import { placeImageOnCanvas } from '../../placeOnCanvas'
import { ImageZoom } from '../../editors/LargeEditor'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX } from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { useFieldPortAnchor, useFieldPortAnchors } from '../../ports/useFieldPortAnchor'
import { NodeShape } from '../NodeShapeUtil'
import { IconChevronDown, IconChevronRight, IconSparkle, UiButton, UiEmpty, UiNumberInput, UiSegmented, UiTextArea, UiTextInput } from '../../../ui'
import { OutputPortRow, PortRow, stopEvent, NodeSelect, useInputConnected, WireField } from './fields'
import { fieldPortId } from '../../../../shared/fieldOverrides'
import {
	DEFAULT_LLM_SETTINGS,
	fillLlmTemplate,
	llmSettingsHeight,
	llmSettingsPorts,
	LlmSettingsFields,
	LlmSettingsPanel,
	llmTemplateVars,
	llmVarPorts,
	llmVarsHeight,
	LlmVarRows,
	parseLlmParams,
} from './llmSettings'
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

// Image generation never reports token usage, and this node already has its own
// (nullable, no-default) `lastUsage` field from before WP10: keep that field and
// take only the other llmSettings fields/defaults, so old canvases keep loading.
const { lastUsage: _llmLastUsageField, ...llmFieldsForImageGen } = LlmSettingsFields
const { lastUsage: _llmLastUsageDefault, ...defaultLlmSettingsForImageGen } = DEFAULT_LLM_SETTINGS

const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
// Enough room for at least 4 lines of prompt text at the default node font.
const PROMPT_AREA_PX = 100
// "More settings" (negative prompt + seed): collapsed is just the title row (WP17: both
// fields' ports anchor there); open gives each its own row.
const MORE_SETTINGS_CLOSED_PX = 28
const moreSettingsOpenPx = (rowPx: number) => MORE_SETTINGS_CLOSED_PX + rowPx * 2
// Empty results: a compact placeholder, about 3 rows. Only the real grid (once there
// are images) takes the full height.
const emptyResultsPx = (rowPx: number) => rowPx * 3
const GRID_AREA_PX = 220

// Row layout, top to bottom: Model, Prompt (grows), count/size, Ref., More settings, results.
const modelRowY = (rowPx: number) => BASE_Y + rowPx * 0.5
const promptTop = (rowPx: number) => BASE_Y + rowPx
const promptPortY = (rowPx: number) => promptTop(rowPx) + rowPx * 0.5
const nsizeTop = (rowPx: number) => promptTop(rowPx) + PROMPT_AREA_PX
// +1 row (WP17): count/size split onto their own rows.
const refTop = (rowPx: number) => nsizeTop(rowPx) + rowPx * 2
const imagePortY = (rowPx: number) => refTop(rowPx) + rowPx * 0.5

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
	...llmFieldsForImageGen,
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
			...defaultLlmSettingsForImageGen,
		}
	}
	private vars(node: ImageGenNode) {
		return llmTemplateVars([node.prompt])
	}
	getBodyHeightPx(shape: NodeShape, node: ImageGenNode) {
		// Model, prompt box, count/size, Ref., More settings, settings panel, variables, then results.
		// The error is not shown here: the card's own error banner already covers it.
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const results = parseImages(node).length ? GRID_AREA_PX : emptyResultsPx(rowPx)
		const moreSettings = node.moreOpen ? moreSettingsOpenPx(rowPx) : MORE_SETTINGS_CLOSED_PX
		// +1 row (WP17): count/size split onto their own rows.
		// +1 row (WP21 follow-up): the "images" output row, above the results grid.
		return rowPx * 5 + PROMPT_AREA_PX + moreSettings + llmSettingsHeight(node, rowPx) + llmVarsHeight(this.vars(node), rowPx) + results
	}
	getPorts(shape: NodeShape, node: ImageGenNode): Record<string, ShapePort> {
		const width = this.getWidthPx(shape, node)
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const moreSettings = node.moreOpen ? moreSettingsOpenPx(rowPx) : MORE_SETTINGS_CLOSED_PX
		const settingsStartY = refTop(rowPx) + rowPx + moreSettings
		const vars = this.vars(node)
		return {
			model: { id: 'model', x: 0, y: modelRowY(rowPx), terminal: 'end', dataType: 'model' },
			prompt: { id: 'prompt', x: 0, y: promptPortY(rowPx), terminal: 'end', dataType: 'text' },
			image: { id: 'image', x: 0, y: imagePortY(rowPx), terminal: 'end', dataType: 'image' },
			...llmSettingsPorts(settingsStartY, !!node.showSettings, rowPx),
			...llmVarPorts(vars, settingsStartY + llmSettingsHeight(node, rowPx), rowPx),
			output: { id: 'output', x: width, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'image' },
			images: { id: 'images', x: width, y: NODE_HEADER_HEIGHT_PX / 2 + 20, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: ImageGenNode, inputs: InputValues): Promise<ExecutionResult> {
		try {
			const vars = this.vars(node)
			const promptSource = getInputText(inputs, 'prompt') || node.prompt
			const { text: prompt } = fillLlmTemplate(promptSource, vars, inputs)
			if (!prompt.trim()) throw new Error('Write a prompt first')
			const modelOverride = getInputText(inputs, 'model').trim()
			const model = modelOverride || node.model || undefined
			const imageFromPort = getInputText(inputs, 'image').trim()
			const referenceSource = imageFromPort || node.referenceImage.trim()
			const referenceImage = referenceSource ? await toImageUrl(referenceSource) : undefined
			const params = parseLlmParams(getInputText(inputs, 'params'))
			const result = await apiGenerateImage(
				{
					model,
					prompt,
					n: Math.max(1, Math.min(8, params.n ?? node.n ?? 1)),
					size: params.size ?? node.size,
					images: referenceImage ? [referenceImage] : undefined,
					negative: node.negative.trim() || undefined,
					seed: params.seed ?? node.seed ?? undefined,
				},
				currentRunSignal(this.editor)
			)
			if (!result.images.length) throw new Error('The model did not return an image')
			updateNode<ImageGenNode>(this.editor, shape, (n) => ({ ...n, images: JSON.stringify(result.images), error: null }))
			return { output: result.images[0], images: result.images.join('\n') }
		} catch (error) {
			updateNode<ImageGenNode>(this.editor, shape, (n) => ({ ...n, error: isAbortError(error) ? null : (error as Error).message }), false)
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

/**
 * WP17: the "More settings" fields (negative, seed) anchor their ports to this section's own
 * header row while it's closed (both at once — `useFieldPortAnchors`), and get their own row
 * each once it's open.
 */
function MoreSettingsSection({
	shape,
	node,
	set,
}: {
	shape: NodeShape
	node: ImageGenNode
	set: (patch: Partial<ImageGenNode>) => void
}) {
	const closedRef = useFieldPortAnchors<HTMLButtonElement>(shape.id, node.moreOpen ? [] : ['negative', 'seed'])
	return (
		<div className="UiSection">
			<button
				ref={closedRef}
				type="button"
				className="UiSection-title"
				onPointerDown={stopEvent}
				onClick={() => set({ moreOpen: !node.moreOpen })}
			>
				{node.moreOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
				More settings
				{!node.moreOpen && (
					<span className="LlmSettings-toggle-ports" title="Negative/Seed inputs (open to see them)">
						<Port shapeId={shape.id} portId={fieldPortId('negative')} />
						<Port shapeId={shape.id} portId={fieldPortId('seed')} />
					</span>
				)}
			</button>
			{node.moreOpen && (
				<div className="UiSection-body">
					<WireField shapeId={shape.id} fieldKey="negative" label="Negative">
						<UiTextInput placeholder="negative prompt (optional)" value={node.negative} onChange={(negative) => set({ negative })} />
					</WireField>
					<WireField shapeId={shape.id} fieldKey="seed" label="Seed" dataType="number">
						<UiNumberInput placeholder="seed" value={node.seed} onChange={(seed) => set({ seed })} />
					</WireField>
				</div>
			)}
		</div>
	)
}

function ImageGenNodeComponent({ shape, node }: NodeComponentProps<ImageGenNode>) {
	const editor = useEditor()
	const [zoom, setZoom] = useState<string | null>(null)
	const imageWired = useInputConnected(shape.id, 'image')
	const modelWired = useInputConnected(shape.id, 'model')
	const set = (patch: Partial<ImageGenNode>) => updateNode<ImageGenNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const images = parseImages(node)
	const run = () => void startExecution(editor, new Set([shape.id]))

	const resultsHeight = (images.length ? GRID_AREA_PX : emptyResultsPx(getNodeRowHeightPx(shape.props.fontSize))) - 8
	const modelRowRef = useFieldPortAnchor<HTMLDivElement>(shape.id, 'model')

	return (
		<>
			{modelWired ? (
				<PortRow shapeId={shape.id} portId="model" label="Model" dataType="model" />
			) : (
				<NodeRow ref={modelRowRef}>
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
			<WireField shapeId={shape.id} fieldKey="n" label="Count" dataType="number">
				<UiSegmented value={String(node.n)} options={[1, 2, 4].map((n) => ({ value: String(n), label: String(n) }))} onChange={(n) => set({ n: Number(n) })} />
			</WireField>
			<WireField shapeId={shape.id} fieldKey="size" label="Size">
				<NodeSelect className="NodeField-select" value={node.size} onPointerDown={stopEvent} onChange={(e) => set({ size: e.target.value })}>
					{SIZES.map((s) => (
						<option key={s.value} value={s.value}>
							{s.label}
						</option>
					))}
				</NodeSelect>
			</WireField>
			{imageWired ? (
				<PortRow shapeId={shape.id} portId="image" label="Reference" dataType="image" />
			) : (
				<NodeRow>
					<PortRow shapeId={shape.id} portId="image" label="Ref." dataType="image" hint="optional" />
					<UiTextInput placeholder="reference image URL (optional)" value={node.referenceImage} onChange={(referenceImage) => set({ referenceImage })} />
				</NodeRow>
			)}
			<MoreSettingsSection shape={shape} node={node} set={set} />
			<LlmSettingsPanel editor={editor} shape={shape} node={node} modelWired={modelWired} />
			<LlmVarRows shapeId={shape.id} vars={llmTemplateVars([node.prompt])} />
			<OutputPortRow shapeId={shape.id} portId="images" label="All images (JSON) →" dataType="text" />
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
