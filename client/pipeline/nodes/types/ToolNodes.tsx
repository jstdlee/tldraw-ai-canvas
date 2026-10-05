import { useEffect, useState } from 'react'
import { categoryOf } from '../../../../shared/nodeGroups'
import { HubModel, ModelPick } from '../../../../shared/modelPick'
import { T, useEditor } from 'tldraw'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX, NODE_WIDTH_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { sleep } from '../../utils/sleep'
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
	updateNode,
} from './shared'

const mark = <span className="NodeShape-emoji">▹</span>
const BASE = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX

function end(id: string, row: number, dataType: 'text' | 'any' = 'text'): ShapePort {
	return { id, x: 0, y: BASE + NODE_ROW_HEIGHT_PX * (row + 0.5), terminal: 'end', dataType }
}
function out(dataType: 'text' | 'any' = 'text'): ShapePort {
	return { id: 'output', x: NODE_WIDTH_PX, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType }
}
function info(shape: NodeShape, value: string | null, inputs: InfoValues, dataType: 'text' | 'any' = 'text'): InfoValues {
	return { output: { value, isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate, dataType } }
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
	const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
	const payload = (await response.json()) as Record<string, unknown>
	if (!response.ok) throw new Error(String(payload.error || response.statusText))
	return payload
}

function Line({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
	return (
		<NodeRow>
			<span className="NodeInputRow-label">{label}</span>
			<input className="NodeField-input" value={value} onPointerDown={stopEvent} onKeyDown={stopEvent} onChange={(e) => onChange(e.target.value)} />
		</NodeRow>
	)
}

export type LocalToolNode = T.TypeOf<typeof LocalToolNode>
export const LocalToolNode = T.object({
	type: T.literal('local_tool'),
	tool: T.string,
	args: T.string,
	error: T.string.nullable(),
})

export class LocalToolNodeDefinition extends NodeDefinition<LocalToolNode> {
	static type = 'local_tool'
	static validator = LocalToolNode
	title = 'Local tool'
	heading = 'gawk / grep'
	icon = mark
	category = categoryOf('local_tool')
	getDefault(): LocalToolNode {
		return { type: 'local_tool', tool: 'grep', args: '-i canvas', error: null }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 3
	}
	getPorts(): Record<string, ShapePort> {
		return { stdin: end('stdin', 0), output: out() }
	}
	async execute(shape: NodeShape, node: LocalToolNode, inputs: InputValues): Promise<ExecutionResult> {
		const payload = await postJson('/api/tool', { tool: node.tool, args: node.args, stdin: getInputText(inputs, 'stdin') })
		updateNode<LocalToolNode>(this.editor, shape, (n) => ({ ...n, error: null }), false)
		return { output: String(payload.output ?? '') }
	}
	getOutputInfo(shape: NodeShape, _node: LocalToolNode, inputs: InfoValues): InfoValues {
		return info(shape, null, inputs)
	}
	Component = LocalToolComponent
}

function LocalToolComponent({ shape, node }: NodeComponentProps<LocalToolNode>) {
	const editor = useEditor()
	const set = (patch: Partial<LocalToolNode>) => updateNode<LocalToolNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	return (
		<>
			<PortRow shapeId={shape.id} portId="stdin" label="Text in" dataType="text" />
			<NodeRow>
				<select className="NodeField-select" value={node.tool} onPointerDown={stopEvent} onChange={(e) => set({ tool: e.target.value })}>
					{['grep', 'gawk', 'awk', 'sed', 'cut', 'sort', 'uniq', 'wc'].map((tool) => (
						<option key={tool} value={tool}>{tool}</option>
					))}
				</select>
			</NodeRow>
			<Line label="Args" value={node.args} onChange={(args) => set({ args })} />
		</>
	)
}

export type TerminalNode = T.TypeOf<typeof TerminalNode>
export const TerminalNode = T.object({
	type: T.literal('terminal'),
	command: T.string,
	host: T.string,
	log: T.string,
	error: T.string.nullable(),
})

export class TerminalNodeDefinition extends NodeDefinition<TerminalNode> {
	static type = 'terminal'
	static validator = TerminalNode
	title = 'Terminal'
	heading = 'Terminal'
	icon = mark
	category = categoryOf('terminal')
	getDefault(): TerminalNode {
		return { type: 'terminal', command: 'wc -l', host: '', log: '', error: null }
	}
	override getWidthPx() {
		return 360
	}
	getBodyHeightPx(_shape: NodeShape, _node: TerminalNode) {
		return NODE_ROW_HEIGHT_PX * 4 + 140
	}
	getPorts(): Record<string, ShapePort> {
		return { stdin: end('stdin', 0), output: { ...out(), x: 360 } }
	}
	async execute(shape: NodeShape, node: TerminalNode, inputs: InputValues): Promise<ExecutionResult> {
		const stdin = getInputText(inputs, 'stdin')
		const remote = node.host.trim().length > 0
		const payload = await postJson('/api/tool', {
			remote,
			host: node.host,
			tool: remote ? 'ssh' : (node.command.trim().split(/\s+/)[0] || 'wc'),
			args: remote ? node.command : node.command.trim().split(/\s+/).slice(1).join(' '),
			stdin,
		})
		const log = String(payload.output ?? '')
		updateNode<TerminalNode>(this.editor, shape, (n) => ({ ...n, log, error: null }), false)
		return { output: log }
	}
	getOutputInfo(shape: NodeShape, node: TerminalNode, inputs: InfoValues): InfoValues {
		return info(shape, node.log || null, inputs)
	}
	Component = TerminalComponent
}

function fit(editor: ReturnType<typeof useEditor>, shape: NodeShape, mode: 'h' | 'w' | 'both') {
	editor.updateShape<NodeShape>({
		id: shape.id,
		type: 'node',
		props: {
			w: mode === 'h' ? shape.props.w : 760,
			extraH: mode === 'w' ? shape.props.extraH ?? 0 : 280,
		},
	})
}

function TerminalComponent({ shape, node }: NodeComponentProps<TerminalNode>) {
	const editor = useEditor()
	const set = (patch: Partial<TerminalNode>) => updateNode<TerminalNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const suggest = async () => {
		const { apiGenerateText } = await import('../../api/pipelineApi')
		const { text } = await apiGenerateText({
			temperature: 0.1,
			system: 'Reply with one command only. Tools: gawk, grep, sed, cut, sort, uniq, wc. No shell operators.',
			prompt: node.command || 'Count lines',
		})
		set({ command: text.trim().split('\n')[0] })
	}
	return (
		<>
			<PortRow shapeId={shape.id} portId="stdin" label="stdin" dataType="text" />
			<Line label="Host" value={node.host} onChange={(host) => set({ host })} />
			<Line label="Command" value={node.command} onChange={(command) => set({ command })} />
			<NodeRow>
				<button type="button" className="NodeField-button" onPointerDown={stopEvent} onClick={() => void suggest()}>Suggest</button>
				<button type="button" className="NodeField-button" title="Max height" onPointerDown={stopEvent} onClick={() => fit(editor, shape, 'h')}>H</button>
				<button type="button" className="NodeField-button" title="Max width" onPointerDown={stopEvent} onClick={() => fit(editor, shape, 'w')}>W</button>
				<button type="button" className="NodeField-button" title="Max both" onPointerDown={stopEvent} onClick={() => fit(editor, shape, 'both')}>HW</button>
			</NodeRow>
			<pre className="TerminalNode-log">{node.error || node.log || (node.host ? 'One SSH command. Batch mode, no password prompt.' : 'Local allowlisted command.')}</pre>
		</>
	)
}

export type VideoNode = T.TypeOf<typeof VideoNode>
export const VideoNode = T.object({
	type: T.literal('video'),
	url: T.string,
	autoplay: T.boolean,
})

export class VideoNodeDefinition extends NodeDefinition<VideoNode> {
	static type = 'video'
	static validator = VideoNode
	title = 'Video link'
	heading = 'Video'
	icon = mark
	category = categoryOf('video')
	getDefault(): VideoNode {
		return { type: 'video', url: '', autoplay: false }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 2 + 160
	}
	getPorts(): Record<string, ShapePort> {
		return { url: end('url', 0), output: out() }
	}
	async execute(_shape: NodeShape, node: VideoNode, inputs: InputValues): Promise<ExecutionResult> {
		return { output: getInputText(inputs, 'url') || node.url }
	}
	getOutputInfo(shape: NodeShape, node: VideoNode, inputs: InfoValues): InfoValues {
		return info(shape, node.url || null, inputs)
	}
	Component = VideoComponent
}

function VideoComponent({ shape, node }: NodeComponentProps<VideoNode>) {
	const editor = useEditor()
	const set = (patch: Partial<VideoNode>) => updateNode<VideoNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const url = node.url
	return (
		<>
			<PortRow shapeId={shape.id} portId="url" label="Link" dataType="text" />
			<NodeRow>
				<input className="NodeField-input" placeholder="https://…/clip.mp4" value={url} onPointerDown={stopEvent} onKeyDown={stopEvent} onChange={(e) => set({ url: e.target.value })} />
				<button type="button" className={'NodeField-button' + (node.autoplay ? ' is-on' : '')} title="Autoplay" onPointerDown={stopEvent} onClick={() => set({ autoplay: !node.autoplay })}>
					▶
				</button>
			</NodeRow>
			{url && <video className="VideoNode-player" src={url} controls autoPlay={node.autoplay} muted={node.autoplay} loop={node.autoplay} />}
		</>
	)
}

export type SleepNode = T.TypeOf<typeof SleepNode>
export const SleepNode = T.object({ type: T.literal('sleep'), ms: T.number })

export class SleepNodeDefinition extends NodeDefinition<SleepNode> {
	static type = 'sleep'
	static validator = SleepNode
	title = 'Sleep'
	heading = 'Sleep'
	icon = mark
	category = categoryOf('sleep')
	getDefault(): SleepNode {
		return { type: 'sleep', ms: 500 }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 2
	}
	getPorts(): Record<string, ShapePort> {
		return { input: end('input', 0, 'any'), output: out('any') }
	}
	async execute(_shape: NodeShape, node: SleepNode, inputs: InputValues): Promise<ExecutionResult> {
		await sleep(Math.max(0, Math.min(node.ms, 60_000)))
		return { output: getInputText(inputs, 'input') }
	}
	getOutputInfo(shape: NodeShape, _node: SleepNode, inputs: InfoValues): InfoValues {
		return info(shape, null, inputs, 'any')
	}
	Component = SleepComponent
}

function SleepComponent({ shape, node }: NodeComponentProps<SleepNode>) {
	const editor = useEditor()
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="In" dataType="any" />
			<Line label="ms" value={String(node.ms)} onChange={(value) => updateNode<SleepNode>(editor, shape, (n) => ({ ...n, ms: Number(value) || 0 }), false)} />
		</>
	)
}

export type EmojiNode = T.TypeOf<typeof EmojiNode>
export const EmojiNode = T.object({ type: T.literal('emoji'), emoji: T.string })

export class EmojiNodeDefinition extends NodeDefinition<EmojiNode> {
	static type = 'emoji'
	static validator = EmojiNode
	title = 'Emoji'
	heading = 'Emoji'
	icon = mark
	category = categoryOf('emoji')
	getDefault(): EmojiNode {
		return { type: 'emoji', emoji: '✨' }
	}
	getBodyHeightPx() {
		return 72
	}
	getPorts(): Record<string, ShapePort> {
		return { input: end('input', 0), output: out() }
	}
	async execute(_shape: NodeShape, node: EmojiNode, inputs: InputValues): Promise<ExecutionResult> {
		return { output: getInputText(inputs, 'input') || node.emoji || '✨' }
	}
	getOutputInfo(shape: NodeShape, node: EmojiNode, inputs: InfoValues): InfoValues {
		return info(shape, node.emoji, inputs)
	}
	Component = EmojiComponent
}

function EmojiComponent({ shape, node }: NodeComponentProps<EmojiNode>) {
	const editor = useEditor()
	return (
		<div className="EmojiNode">
			<PortRow shapeId={shape.id} portId="input" label="" dataType="text" />
			<input className="EmojiNode-input" value={node.emoji} onPointerDown={stopEvent} onKeyDown={stopEvent} onChange={(e) => updateNode<EmojiNode>(editor, shape, (n) => ({ ...n, emoji: e.target.value }), false)} />
		</div>
	)
}

export type MotionNode = T.TypeOf<typeof MotionNode>
export const MotionNode = T.object({
	type: T.literal('motion'),
	direction: T.string,
	speed: T.number,
	content: T.string,
})

export class MotionNodeDefinition extends NodeDefinition<MotionNode> {
	static type = 'motion'
	static validator = MotionNode
	title = 'Motion'
	heading = 'Motion'
	icon = mark
	category = categoryOf('motion')
	getDefault(): MotionNode {
		return { type: 'motion', direction: 'up', speed: 1, content: '✦' }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 2 + 80
	}
	getPorts(): Record<string, ShapePort> {
		return { input: end('input', 0, 'any'), output: out('any') }
	}
	async execute(_shape: NodeShape, node: MotionNode, inputs: InputValues): Promise<ExecutionResult> {
		return { output: getInputText(inputs, 'input') || node.content }
	}
	getOutputInfo(shape: NodeShape, node: MotionNode, inputs: InfoValues): InfoValues {
		return info(shape, node.content, inputs, 'any')
	}
	Component = MotionComponent
}

function MotionComponent({ shape, node }: NodeComponentProps<MotionNode>) {
	const editor = useEditor()
	const set = (patch: Partial<MotionNode>) => updateNode<MotionNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const text = node.content
	const image = /^data:image\/|\/api\/images\/|\.(png|jpe?g|gif|webp)(\?|$)/i.test(text)
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="Content" dataType="any" />
			<NodeRow>
				<select className="NodeField-select" value={node.direction} onPointerDown={stopEvent} onChange={(e) => set({ direction: e.target.value })}>
					{['up', 'down', 'left', 'right'].map((direction) => (
						<option key={direction} value={direction}>{direction}</option>
					))}
				</select>
				<input className="NodeField-input" type="number" value={node.speed} onPointerDown={stopEvent} onKeyDown={stopEvent} onChange={(e) => set({ speed: Number(e.target.value) || 1 })} />
			</NodeRow>
			<div className={`MotionNode MotionNode-${node.direction}`} style={{ animationDuration: `${Math.max(0.2, 2 / Math.max(node.speed, 0.2))}s` }}>
				{image ? <img src={text} alt="" /> : <span>{text}</span>}
			</div>
		</>
	)
}

export type HfNode = T.TypeOf<typeof HfNode>
export const HfNode = T.object({
	type: T.literal('hf'),
	task: T.string,
	model: T.string,
	token: T.string,
	error: T.string.nullable(),
})

export class HfNodeDefinition extends NodeDefinition<HfNode> {
	static type = 'hf'
	static validator = HfNode
	title = 'Hugging Face'
	heading = 'HF'
	icon = mark
	category = categoryOf('hf')
	getDefault(): HfNode {
		return { type: 'hf', task: 'text', model: '', token: '', error: null }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 4
	}
	getPorts(): Record<string, ShapePort> {
		return { input: end('input', 0, 'any'), output: out('any') }
	}
	async execute(shape: NodeShape, node: HfNode, inputs: InputValues): Promise<ExecutionResult> {
		const payload = await postJson('/api/hf', { model: node.model, input: getInputText(inputs, 'input'), token: node.token })
		updateNode<HfNode>(this.editor, shape, (n) => ({ ...n, error: null }), false)
		return { output: String(payload.output ?? '') }
	}
	getOutputInfo(shape: NodeShape, _node: HfNode, inputs: InfoValues): InfoValues {
		return info(shape, null, inputs, 'any')
	}
	Component = HfComponent
}

function HfComponent({ shape, node }: NodeComponentProps<HfNode>) {
	const editor = useEditor()
	const set = (patch: Partial<HfNode>) => updateNode<HfNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="Input" dataType="any" />
			<NodeRow>
				<select className="NodeField-select" value={node.task} onPointerDown={stopEvent} onChange={(e) => set({ task: e.target.value })}>
					{['text', 'image', 'audio', 'video'].map((task) => (
						<option key={task} value={task}>{task}</option>
					))}
				</select>
			</NodeRow>
			<Line label="Model" value={node.model} onChange={(model) => set({ model })} />
			<Line label="Token" value={node.token} onChange={(token) => set({ token })} />
		</>
	)
}

function useHub(url: string) {
	const [models, setModels] = useState<HubModel[]>([])
	const [error, setError] = useState<string | null>(null)
	useEffect(() => {
		let dead = false
		void fetch(url)
			.then((response) => response.json())
			.then((payload: { models?: HubModel[]; error?: string }) => {
				if (dead) return
				if (payload.error) setError(payload.error)
				setModels(payload.models ?? [])
			})
			.catch((cause) => !dead && setError((cause as Error).message))
		return () => {
			dead = true
		}
	}, [url])
	return { models, error }
}

export type OpenRouterNode = T.TypeOf<typeof OpenRouterNode>
export const OpenRouterNode = T.object({ type: T.literal('openrouter'), model: T.string })

export class OpenRouterNodeDefinition extends NodeDefinition<OpenRouterNode> {
	static type = 'openrouter'
	static validator = OpenRouterNode
	title = 'OpenRouter free'
	heading = 'OpenRouter'
	icon = mark
	category = categoryOf('openrouter')
	getDefault(): OpenRouterNode {
		return { type: 'openrouter', model: '' }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 2
	}
	getPorts(): Record<string, ShapePort> {
		return { output: out() }
	}
	async execute(shape: NodeShape, node: OpenRouterNode): Promise<ExecutionResult> {
		let model = node.model
		if (!model) {
			const response = await fetch('/api/hub/openrouter')
			const payload = (await response.json()) as { models?: HubModel[]; error?: string }
			if (!response.ok) throw new Error(payload.error || 'OpenRouter failed')
			model = payload.models?.[0]?.id ?? ''
			if (!model) throw new Error('OpenRouter returned no free model')
			updateNode<OpenRouterNode>(this.editor, shape, (n) => ({ ...n, model }), false)
		}
		return { output: model }
	}
	getOutputInfo(shape: NodeShape, node: OpenRouterNode, inputs: InfoValues): InfoValues {
		return info(shape, node.model || null, inputs)
	}
	Component = OpenRouterComponent
}

function OpenRouterComponent({ shape, node }: NodeComponentProps<OpenRouterNode>) {
	const editor = useEditor()
	const { models, error } = useHub('/api/hub/openrouter')
	return (
		<NodeRow>
			<select className="NodeField-select" value={node.model} onPointerDown={stopEvent} onChange={(e) => updateNode<OpenRouterNode>(editor, shape, (n) => ({ ...n, model: e.target.value }), false)}>
				<option value="">{error || (models.length ? 'Free models' : 'Loading free models…')}</option>
				{models.map((model) => (
					<option key={model.id} value={model.id}>{model.name}</option>
				))}
			</select>
		</NodeRow>
	)
}

export type OpenCodeNode = T.TypeOf<typeof OpenCodeNode>
export const OpenCodeNode = T.object({ type: T.literal('opencode_go'), model: T.string })

export class OpenCodeNodeDefinition extends NodeDefinition<OpenCodeNode> {
	static type = 'opencode_go'
	static validator = OpenCodeNode
	title = 'OpenCode Go'
	heading = 'OpenCode Go'
	icon = mark
	category = categoryOf('opencode_go')
	getDefault(): OpenCodeNode {
		return { type: 'opencode_go', model: '' }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 2
	}
	getPorts(): Record<string, ShapePort> {
		return { output: out() }
	}
	async execute(shape: NodeShape, node: OpenCodeNode): Promise<ExecutionResult> {
		let model = node.model
		if (!model) {
			const response = await fetch('/api/hub/opencode-go')
			const payload = (await response.json()) as { models?: HubModel[]; error?: string }
			if (!response.ok) throw new Error(payload.error || 'OpenCode Go failed')
			model = payload.models?.[0]?.id ?? ''
			if (!model) throw new Error('OpenCode Go returned no model')
			updateNode<OpenCodeNode>(this.editor, shape, (n) => ({ ...n, model }), false)
		}
		return { output: model }
	}
	getOutputInfo(shape: NodeShape, node: OpenCodeNode, inputs: InfoValues): InfoValues {
		return info(shape, node.model || null, inputs)
	}
	Component = OpenCodeComponent
}

function OpenCodeComponent({ shape, node }: NodeComponentProps<OpenCodeNode>) {
	const editor = useEditor()
	const { models, error } = useHub('/api/hub/opencode-go')
	return (
		<NodeRow>
			<select className="NodeField-select" value={node.model} onPointerDown={stopEvent} onChange={(e) => updateNode<OpenCodeNode>(editor, shape, (n) => ({ ...n, model: e.target.value }), false)}>
				<option value="">{error || 'OpenCode Go models'}</option>
				{models.map((model) => (
					<option key={model.id} value={model.id}>{model.free ? `${model.name} · free` : model.name}</option>
				))}
			</select>
		</NodeRow>
	)
}

export type ModelPickNode = T.TypeOf<typeof ModelPickNode>
export const ModelPickNode = T.object({
	type: T.literal('model_pick'),
	task: T.string,
	band: T.string,
	model: T.string,
	note: T.string,
})

export class ModelPickNodeDefinition extends NodeDefinition<ModelPickNode> {
	static type = 'model_pick'
	static validator = ModelPickNode
	title = 'Pick a model'
	heading = 'Pick model'
	icon = mark
	category = categoryOf('model_pick')
	getDefault(): ModelPickNode {
		return { type: 'model_pick', task: 'chat', band: 'low', model: '', note: '' }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 3
	}
	getPorts(): Record<string, ShapePort> {
		return { output: out() }
	}
	async execute(shape: NodeShape, node: ModelPickNode): Promise<ExecutionResult> {
		const response = await fetch(`/api/hub/candidates?task=${encodeURIComponent(node.task)}&band=${encodeURIComponent(node.band)}`)
		const payload = (await response.json()) as { picks?: ModelPick[]; note?: string; error?: string }
		if (!response.ok) throw new Error(payload.error || 'No candidates')
		const first = payload.picks?.[0]
		if (!first) throw new Error('No model matched')
		updateNode<ModelPickNode>(this.editor, shape, (n) => ({ ...n, model: first.id, note: payload.note || first.reason }), false)
		return { output: first.id }
	}
	getOutputInfo(shape: NodeShape, node: ModelPickNode, inputs: InfoValues): InfoValues {
		return info(shape, node.model || null, inputs)
	}
	Component = ModelPickComponent
}

function ModelPickComponent({ shape, node }: NodeComponentProps<ModelPickNode>) {
	const editor = useEditor()
	const set = (patch: Partial<ModelPickNode>) => updateNode<ModelPickNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const [picks, setPicks] = useState<ModelPick[]>([])
	useEffect(() => {
		let dead = false
		void fetch(`/api/hub/candidates?task=${encodeURIComponent(node.task)}&band=${encodeURIComponent(node.band)}`)
			.then((response) => response.json())
			.then((payload: { picks?: ModelPick[] }) => !dead && setPicks(payload.picks ?? []))
			.catch(() => !dead && setPicks([]))
		return () => {
			dead = true
		}
	}, [node.task, node.band])
	return (
		<>
			<NodeRow>
				<select className="NodeField-select" value={node.task} onPointerDown={stopEvent} onChange={(e) => set({ task: e.target.value })}>
					{['chat', 'daily', 'coding', 'vision', 'think'].map((task) => (
						<option key={task} value={task}>{task}</option>
					))}
				</select>
				<select className="NodeField-select" value={node.band} onPointerDown={stopEvent} onChange={(e) => set({ band: e.target.value })}>
					<option value="low">low cost</option>
					<option value="medium">mid cost</option>
					<option value="high">high cost</option>
				</select>
			</NodeRow>
			<select className="NodeField-select" value={node.model} onPointerDown={stopEvent} onChange={(e) => set({ model: e.target.value })}>
				<option value="">Candidates</option>
				{picks.map((pick) => (
					<option key={pick.id} value={pick.id}>{pick.name}</option>
				))}
			</select>
			{node.note && <p className="NodeHint">{node.note}</p>}
		</>
	)
}

export type AgentNode = T.TypeOf<typeof AgentNode>
export const AgentNode = T.object({
	type: T.literal('agent_run'),
	cli: T.string,
	prompt: T.string,
	progress: T.string,
	error: T.string.nullable(),
})

export class AgentNodeDefinition extends NodeDefinition<AgentNode> {
	static type = 'agent_run'
	static validator = AgentNode
	title = 'Local agent'
	heading = 'Agent'
	icon = mark
	category = categoryOf('agent_run')
	getDefault(): AgentNode {
		return { type: 'agent_run', cli: 'grok', prompt: '', progress: '', error: null }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 4 + 36
	}
	getPorts(): Record<string, ShapePort> {
		return { prompt: end('prompt', 0), output: out() }
	}
	async execute(shape: NodeShape, node: AgentNode, inputs: InputValues): Promise<ExecutionResult> {
		const prompt = getInputText(inputs, 'prompt') || node.prompt
		const started = await postJson('/api/agent-job', { cli: node.cli, prompt })
		const id = String(started.id)
		let last = ''
		for (let i = 0; i < 120; i++) {
			await sleep(500)
			const response = await fetch(`/api/agent-job/${id}`)
			const job = (await response.json()) as { lines?: string[]; done?: boolean; error?: string; code?: number }
			last = (job.lines ?? []).join('\n')
			const width = job.done ? 100 : Math.min(95, (job.lines ?? []).length * 8)
			updateNode<AgentNode>(this.editor, shape, (n) => ({ ...n, progress: `${width}`, error: job.error ?? null }), false)
			if (job.done) {
				if (job.code && job.code !== 0) throw new Error(job.error || last || `${node.cli} exited ${job.code}`)
				return { output: last }
			}
		}
		throw new Error('Agent is still running')
	}
	getOutputInfo(shape: NodeShape, _node: AgentNode, inputs: InfoValues): InfoValues {
		return info(shape, null, inputs)
	}
	Component = AgentComponent
}

function AgentComponent({ shape, node }: NodeComponentProps<AgentNode>) {
	const editor = useEditor()
	const set = (patch: Partial<AgentNode>) => updateNode<AgentNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const pct = Math.max(0, Math.min(100, Number(node.progress) || 0))
	return (
		<>
			<PortRow shapeId={shape.id} portId="prompt" label="Task" dataType="text" />
			<NodeRow>
				<select className="NodeField-select" value={node.cli} onPointerDown={stopEvent} onChange={(e) => set({ cli: e.target.value })}>
					<option value="grok">grok</option>
					<option value="pi">pi</option>
					<option value="omp">omp</option>
				</select>
			</NodeRow>
			<Line label="Prompt" value={node.prompt} onChange={(prompt) => set({ prompt })} />
			<div className="ProgressBar" title={`${pct}%`}>
				<span style={{ width: `${pct}%` }} />
			</div>
			{node.error && <span className="NodeStatus is-error">{node.error}</span>}
		</>
	)
}
