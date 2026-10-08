import { T, useEditor } from 'tldraw'
import type { LlmUsage } from '../../../../shared/llmUsage'
import { formatLlmUsage } from '../../../../shared/llmUsage'
import { categoryOf } from '../../../../shared/nodeGroups'
import { GenerateTextIcon } from '../../components/icons/GenerateTextIcon'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEIGHT_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { PortRow, stopEvent } from './fields'
import {
	areAnyInputsOutOfDate,
	ExecutionResult,
	getInputText,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	STOP_EXECUTION,
	updateNode,
} from './shared'

const WIDTH = 320
const BASE_Y = NODE_HEADER_HEIGHT_PX + 8

/**
 * A model call with every setting on the card: endpoint, model id, key, system
 * prompt, temperature, thinking, max tokens. Any OpenAI-compatible endpoint works.
 * The key is stored in this node, so it is saved with the canvas.
 */
export type RawModelNode = T.TypeOf<typeof RawModelNode>
export const RawModelNode = T.object({
	type: T.literal('raw_model'),
	url: T.string,
	model: T.string,
	apiKey: T.string,
	system: T.string,
	/** Empty means the model's default. */
	temperature: T.string,
	/** '' | none | low | medium | high */
	thinking: T.string,
	maxTokens: T.string,
	lastText: T.string.nullable(),
	lastUsage: T.string.nullable(),
	error: T.string.nullable(),
})

export class RawModelNodeDefinition extends NodeDefinition<RawModelNode> {
	static type = 'raw_model'
	static validator = RawModelNode
	title = 'Raw model'
	heading = 'Raw model'
	icon = (<GenerateTextIcon />)
	category = categoryOf('raw_model')
	resultKeys = ['lastText', 'lastUsage', 'error'] as const
	getDefault(): RawModelNode {
		return {
			type: 'raw_model',
			url: 'https://api.openai.com/v1',
			model: '',
			apiKey: '',
			system: '',
			temperature: '',
			thinking: '',
			maxTokens: '',
			lastText: null,
			lastUsage: null,
			error: null,
		}
	}
	override getWidthPx() {
		return WIDTH
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 6 + 96
	}
	getPorts(): Record<string, ShapePort> {
		return {
			prompt: { id: 'prompt', x: 0, y: BASE_Y + NODE_ROW_HEIGHT_PX * 0.5, terminal: 'end', dataType: 'text' },
			output: { id: 'output', x: WIDTH, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: RawModelNode, inputs: InputValues): Promise<ExecutionResult> {
		try {
			const prompt = getInputText(inputs, 'prompt')
			if (!prompt.trim()) throw new Error('Connect a prompt')
			if (!node.model.trim()) throw new Error('Set a model id')
			const response = await fetch('/api/raw-model', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					url: node.url,
					model: node.model,
					apiKey: node.apiKey || undefined,
					system: node.system || undefined,
					temperature: node.temperature === '' ? undefined : Number(node.temperature),
					thinking: node.thinking || undefined,
					maxTokens: node.maxTokens === '' ? undefined : Number(node.maxTokens),
					prompt,
				}),
			})
			const payload = (await response.json()) as { text?: string; usage?: LlmUsage; error?: string }
			if (!response.ok) throw new Error(payload.error || response.statusText)
			const text = payload.text ?? ''
			const usage = payload.usage ? formatLlmUsage(payload.usage) : null
			updateNode<RawModelNode>(this.editor, shape, (n) => ({ ...n, lastText: text, lastUsage: usage, error: null }), false)
			return { output: text }
		} catch (error) {
			updateNode<RawModelNode>(this.editor, shape, (n) => ({ ...n, error: (error as Error).message }), false)
			return { output: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: RawModelNode, inputs: InfoValues): InfoValues {
		return {
			output: { value: node.lastText, isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate, dataType: 'text' },
		}
	}
	Component = RawModelComponent
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<NodeRow>
			<span className="NodeInputRow-label">{label}</span>
			{children}
		</NodeRow>
	)
}

function RawModelComponent({ shape, node }: NodeComponentProps<RawModelNode>) {
	const editor = useEditor()
	const set = (patch: Partial<RawModelNode>) => updateNode<RawModelNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const text = (key: 'url' | 'model' | 'apiKey' | 'temperature' | 'maxTokens', placeholder: string, type = 'text') => (
		<input
			className="NodeField-input"
			type={type}
			placeholder={placeholder}
			autoComplete="off"
			value={node[key]}
			onPointerDown={stopEvent}
			onKeyDown={stopEvent}
			onChange={(e) => set({ [key]: e.target.value })}
		/>
	)
	return (
		<>
			<PortRow shapeId={shape.id} portId="prompt" label="Prompt" dataType="text" />
			<Field label="URL">{text('url', 'https://api.openai.com/v1')}</Field>
			<Field label="Model">{text('model', 'model id')}</Field>
			<Field label="Key">{text('apiKey', 'optional', 'password')}</Field>
			<textarea
				className="NodeField-textarea"
				placeholder="System prompt"
				style={{ height: 72 }}
				value={node.system}
				onPointerDown={stopEvent}
				onKeyDown={stopEvent}
				onChange={(e) => set({ system: e.target.value })}
			/>
			<Field label="Temp">{text('temperature', 'default', 'number')}</Field>
			<Field label="Max tok">{text('maxTokens', 'default', 'number')}</Field>
			<Field label="Think">
				<select className="NodeField-select" value={node.thinking} onPointerDown={stopEvent} onChange={(e) => set({ thinking: e.target.value })}>
					<option value="">default</option>
					<option value="none">none</option>
					<option value="low">low</option>
					<option value="medium">medium</option>
					<option value="high">high</option>
				</select>
			</Field>
			{node.lastUsage && <span className="NodeHint">{node.lastUsage}</span>}
			{node.error && (
				<NodeRow>
					<span className="NodeStatus is-error">{node.error}</span>
				</NodeRow>
			)}
		</>
	)
}
