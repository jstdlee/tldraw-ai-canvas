import { categoryOf } from '../../../../shared/nodeGroups'
import { normalizeUrl } from '../../../../shared/contentKind'
import { T, useEditor } from 'tldraw'
import { ModelSelect } from '../../../ai/aiConfig'
import { RANDOM_MODES, randomValue } from '../../../../shared/random'
import { apiGenerateText, apiNetTool } from '../../api/pipelineApi'
import { formatLlmUsage } from '../../../../shared/llmUsage'
import { GenerateTextIcon } from '../../components/icons/GenerateTextIcon'
import { NumberIcon } from '../../components/icons/NumberIcon'
import { UpscaleIcon } from '../../components/icons/UpscaleIcon'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX, NODE_WIDTH_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { isImageValue, PortRow, stopEvent, useInputConnected } from './fields'
import {
	DEFAULT_LLM_SETTINGS,
	LlmSettingsFields,
	LlmSettingsPanel,
	llmRequestSettings,
	llmSettingsHeight,
} from './llmSettings'
import {
	areAnyInputsOutOfDate,
	coerceToText,
	ExecutionResult,
	getInput,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	STOP_EXECUTION,
	updateNode,
} from './shared'

const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
const portY = (row: number) => BASE_Y + NODE_ROW_HEIGHT_PX * (row + 0.5)
const out = (dataType: ShapePort['dataType'] = 'text', x = NODE_WIDTH_PX): ShapePort => ({
	id: 'output',
	x,
	y: NODE_HEADER_HEIGHT_PX / 2,
	terminal: 'start',
	dataType,
})

function textOutput(shape: NodeShape, value: string | null, inputs: InfoValues): InfoValues {
	return { output: { value, isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate, dataType: 'text' } }
}

// ---------------------------------------------------------------------------
// Random: number, pick from list, shuffle, coin, dice, UUID, password
// ---------------------------------------------------------------------------

/** Cryptographically strong [0, 1) when available. */
function strongRandom() {
	const buf = new Uint32Array(1)
	crypto.getRandomValues(buf)
	return buf[0] / 2 ** 32
}

export type RandomNode = T.TypeOf<typeof RandomNode>
export const RandomNode = T.object({
	type: T.literal('random'),
	mode: T.string,
	a: T.string,
	b: T.string,
	list: T.string,
	lastValue: T.string.nullable(),
})

export class RandomNodeDefinition extends NodeDefinition<RandomNode> {
	static type = 'random'
	static validator = RandomNode
	title = 'Random'
	heading = 'Random'
	icon = <NumberIcon />
	category = categoryOf('random')
	resultKeys = ['lastValue'] as const
	getDefault(): RandomNode {
		return { type: 'random', mode: 'number', a: '1', b: '100', list: 'red\ngreen\nblue', lastValue: null }
	}
	getBodyHeightPx(_s: NodeShape, node: RandomNode) {
		return NODE_ROW_HEIGHT_PX * 5 + (node.mode === 'pick' || node.mode === 'shuffle' ? 80 : 0)
	}
	getPorts(): Record<string, ShapePort> {
		return {
			list: { id: 'list', x: 0, y: portY(0), terminal: 'end', dataType: 'any' },
			a: { id: 'a', x: 0, y: portY(1), terminal: 'end', dataType: 'any' },
			b: { id: 'b', x: 0, y: portY(2), terminal: 'end', dataType: 'any' },
			output: out(),
		}
	}
	async execute(shape: NodeShape, node: RandomNode, inputs: InputValues): Promise<ExecutionResult> {
		// A wired value wins over the field it stands for (min/max, sides, length…).
		const list = getInput(inputs, 'list') != null ? coerceToText(getInput(inputs, 'list')) : node.list
		const a = getInput(inputs, 'a') != null ? coerceToText(getInput(inputs, 'a')) : node.a
		const b = getInput(inputs, 'b') != null ? coerceToText(getInput(inputs, 'b')) : node.b
		const value = randomValue(node.mode, a, b, list, strongRandom)
		updateNode<RandomNode>(this.editor, shape, (n) => ({ ...n, lastValue: value }))
		return { output: value }
	}
	getOutputInfo(shape: NodeShape, node: RandomNode, inputs: InfoValues) {
		return textOutput(shape, node.lastValue, inputs)
	}
	Component = RandomNodeComponent
}

function RandomNodeComponent({ shape, node }: NodeComponentProps<RandomNode>) {
	const editor = useEditor()
	const listWired = useInputConnected(shape.id, 'list')
	const aWired = useInputConnected(shape.id, 'a')
	const bWired = useInputConnected(shape.id, 'b')
	const set = (patch: Partial<RandomNode>) => updateNode<RandomNode>(editor, shape, (n) => ({ ...n, ...patch }))
	const needsList = node.mode === 'pick' || node.mode === 'shuffle'
	const fields: Record<string, [string, string] | [string]> = {
		number: ['min', 'max'],
		pick: ['how many'],
		dice: ['sides'],
		password: ['length'],
	}
	const f = fields[node.mode]
	return (
		<>
			<PortRow shapeId={shape.id} portId="list" label="List" dataType="any" hint={needsList ? 'or type below' : 'not used'} />
			<PortRow shapeId={shape.id} portId="a" label={f?.[0] ?? 'A'} dataType="any" hint={f ? f[0] : 'not used'} />
			<PortRow shapeId={shape.id} portId="b" label={f?.[1] ?? 'B'} dataType="any" hint={f?.[1] ?? 'not used'} />
			<NodeRow>
				<select className="NodeField-select" value={node.mode} onPointerDown={stopEvent} onChange={(e) => set({ mode: e.target.value })}>
					{RANDOM_MODES.map((m) => (
						<option key={m.id} value={m.id}>
							{m.label}
						</option>
					))}
				</select>
			</NodeRow>
			<NodeRow>
				{f ? (
					f.map((label, i) => {
						const wired = i === 0 ? aWired : bWired
						return (
							<input
								key={label}
								className="NodeField-input"
								placeholder={label}
								disabled={wired}
								value={wired ? `(${label} wired)` : i === 0 ? node.a : node.b}
								onPointerDown={stopEvent}
								onKeyDown={stopEvent}
								onChange={(e) => set(i === 0 ? { a: e.target.value } : { b: e.target.value })}
							/>
						)
					})
				) : (
					<span className="NodeRow-disconnected">new value on every run</span>
				)}
			</NodeRow>
			{needsList && (
				<div className="NodeField-block" style={{ height: 80 }}>
					<textarea
						className="NodeField-textarea"
						disabled={listWired}
						placeholder="One item per line"
						value={listWired ? '(from the List input)' : node.list}
						onPointerDown={stopEvent}
						onKeyDown={stopEvent}
						onChange={(e) => set({ list: e.target.value })}
					/>
				</div>
			)}
		</>
	)
}

// ---------------------------------------------------------------------------
// Network tools: ping, traceroute, dig, DNS, whois, ports, headers, subnet…
// ---------------------------------------------------------------------------

export const NET_TOOL_OPTIONS = [
	{ id: 'ping', label: 'Ping', target: 'host or IP', option: 'count (4)' },
	{ id: 'traceroute', label: 'Traceroute', target: 'host or IP' },
	{ id: 'dig', label: 'Dig (DNS record)', target: 'domain', option: 'type: A, AAAA, MX, TXT, NS…' },
	{ id: 'dns', label: 'DNS lookup (all common)', target: 'domain' },
	{ id: 'reverse_dns', label: 'Reverse DNS', target: 'IP address' },
	{ id: 'port', label: 'Port check (TCP)', target: 'host or IP', option: 'ports, e.g. 22,80,443' },
	{ id: 'whois', label: 'Whois', target: 'domain or IP' },
	{ id: 'http_headers', label: 'HTTP headers & redirects', target: 'URL' },
	{ id: 'my_ips', label: 'My IP addresses (this machine)' },
	{ id: 'subnet', label: 'Subnet calculator', target: '192.168.1.10/24' },
	{ id: 'subnet_split', label: 'Split subnet', target: '10.0.0.0/24', option: 'new prefix, e.g. 26' },
	{ id: 'ip_info', label: 'IP info (type, binary, hex)', target: 'IP address' },
] as const

export type NetToolNode = T.TypeOf<typeof NetToolNode>
export const NetToolNode = T.object({
	type: T.literal('net_tool'),
	tool: T.string,
	target: T.string,
	option: T.string,
	lastOutput: T.string.nullable(),
	lastMs: T.number.nullable(),
	error: T.string.nullable(),
})

const NET_RESULT_PX = 160

export class NetToolNodeDefinition extends NodeDefinition<NetToolNode> {
	static type = 'net_tool'
	static validator = NetToolNode
	title = 'Network tools'
	heading = 'Network'
	icon = <UpscaleIcon />
	category = categoryOf('net_tool')
	resultKeys = ['lastOutput', 'lastMs', 'error'] as const
	getDefault(): NetToolNode {
		return { type: 'net_tool', tool: 'ping', target: '1.1.1.1', option: '', lastOutput: null, lastMs: null, error: null }
	}
	override getWidthPx() {
		return 340
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 4
	}
	getPorts(): Record<string, ShapePort> {
		return { target: { id: 'target', x: 0, y: portY(0), terminal: 'end', dataType: 'text' }, output: out('text', 340) }
	}
	async execute(shape: NodeShape, node: NetToolNode, inputs: InputValues): Promise<ExecutionResult> {
		const target = (coerceToText(getInput(inputs, 'target')) || node.target).trim()
		try {
			const r = await apiNetTool({ tool: node.tool, target, option: node.option })
			updateNode<NetToolNode>(this.editor, shape, (n) => ({ ...n, lastOutput: r.output, lastMs: r.ms, error: null }))
			return { output: r.output }
		} catch (e) {
			updateNode<NetToolNode>(this.editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
			return { output: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: NetToolNode, inputs: InfoValues) {
		return textOutput(shape, node.lastOutput, inputs)
	}
	Component = NetToolNodeComponent
}

function NetToolNodeComponent({ shape, node }: NodeComponentProps<NetToolNode>) {
	const editor = useEditor()
	const targetWired = useInputConnected(shape.id, 'target')
	const set = (patch: Partial<NetToolNode>) => updateNode<NetToolNode>(editor, shape, (n) => ({ ...n, ...patch }))
	const tool = NET_TOOL_OPTIONS.find((t) => t.id === node.tool) ?? NET_TOOL_OPTIONS[0]
	return (
		<>
			{targetWired || !('target' in tool) ? (
				<PortRow shapeId={shape.id} portId="target" label="Target" dataType="text" hint="not needed" />
			) : (
				<PortRow shapeId={shape.id} portId="target" label="Target" dataType="text" hint="or type below" />
			)}
			<NodeRow>
				<select className="NodeField-select" value={node.tool} onPointerDown={stopEvent} onChange={(e) => set({ tool: e.target.value, option: '' })}>
					{NET_TOOL_OPTIONS.map((t) => (
						<option key={t.id} value={t.id}>
							{t.label}
						</option>
					))}
				</select>
			</NodeRow>
			<NodeRow>
				{'target' in tool && !targetWired ? (
					<input
						className="NodeField-input"
						placeholder={tool.target}
						value={node.target}
						onPointerDown={stopEvent}
						onKeyDown={stopEvent}
						onChange={(e) => set({ target: e.target.value })}
					/>
				) : (
					<span className="NodeRow-disconnected">{targetWired ? 'target from input' : 'no target needed'}</span>
				)}
			</NodeRow>
			<NodeRow>
				{'option' in tool ? (
					<input
						className="NodeField-input"
						placeholder={tool.option}
						value={node.option}
						onPointerDown={stopEvent}
						onKeyDown={stopEvent}
						onChange={(e) => set({ option: e.target.value })}
					/>
				) : (
					<span className="NodeStatus">{node.lastMs != null ? `took ${node.lastMs} ms` : 'Runs on this machine'}</span>
				)}
			</NodeRow>
			{node.error && (
				<NodeRow>
					<span className="NodeStatus is-error">{node.error}</span>
				</NodeRow>
			)}
		</>
	)
}

// ---------------------------------------------------------------------------
// Summarize: text, web page (URL), image, or video (frames)
// ---------------------------------------------------------------------------

export type SummarizeNode = T.TypeOf<typeof SummarizeNode>
export const SummarizeNode = T.object({
	type: T.literal('summarize'),
	length: T.string,
	format: T.string,
	language: T.string,
	focus: T.string,
	model: T.string,
	lastResultText: T.string.nullable(),
	lastKind: T.string.nullable(),
	error: T.string.nullable(),
	...LlmSettingsFields,
})

const SUM_RESULT_PX = 150

function isVideoValue(v: string) {
	// blob: URLs come from video shapes on the canvas (images arrive as data URLs).
	return /^(data:video\/|blob:)/.test(v) || /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(v)
}

/** Take evenly spaced frames from a video as JPEG data URLs. */
export async function videoFrames(src: string, count = 6): Promise<string[]> {
	const video = document.createElement('video')
	video.crossOrigin = 'anonymous'
	video.muted = true
	video.preload = 'auto'
	video.src = src
	await new Promise<void>((resolve, reject) => {
		video.onloadedmetadata = () => resolve()
		video.onerror = () => reject(new Error('Cannot load the video'))
	})
	const duration = Number.isFinite(video.duration) ? video.duration : 0
	const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
	const canvas = document.createElement('canvas')
	canvas.width = Math.round(video.videoWidth * scale)
	canvas.height = Math.round(video.videoHeight * scale)
	const ctx = canvas.getContext('2d')!
	const frames: string[] = []
	for (let i = 0; i < count; i++) {
		video.currentTime = duration ? (duration * (i + 0.5)) / count : 0
		await new Promise<void>((resolve) => (video.onseeked = () => resolve()))
		ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
		frames.push(canvas.toDataURL('image/jpeg', 0.8))
	}
	return frames
}

export class SummarizeNodeDefinition extends NodeDefinition<SummarizeNode> {
	static type = 'summarize'
	static validator = SummarizeNode
	title = 'Summarize (text, URL, image, video)'
	heading = 'Summarize'
	icon = <GenerateTextIcon />
	category = categoryOf('summarize')
	resultKeys = ['lastResultText', 'lastKind', 'error'] as const
	getDefault(): SummarizeNode {
		return {
			type: 'summarize',
			length: 'short',
			format: 'bullets',
			language: '',
			focus: '',
			model: '',
			lastResultText: null,
			lastKind: null,
			error: null,
			...DEFAULT_LLM_SETTINGS,
		}
	}
	getBodyHeightPx(_s: NodeShape, node: SummarizeNode) {
		return NODE_ROW_HEIGHT_PX * 5 + llmSettingsHeight(node)
	}
	getPorts(): Record<string, ShapePort> {
		return { input: { id: 'input', x: 0, y: portY(0), terminal: 'end', dataType: 'any' }, output: out() }
	}
	async execute(shape: NodeShape, node: SummarizeNode, inputs: InputValues): Promise<ExecutionResult> {
		// Bare hosts (www.wikipedia.com) get a scheme so they are read as a web page.
		const value = normalizeUrl(coerceToText(getInput(inputs, 'input')).trim())
		if (!value) {
			updateNode<SummarizeNode>(this.editor, shape, (n) => ({ ...n, error: 'Connect something to summarize' }), false)
			return { output: STOP_EXECUTION }
		}
		const kind = isVideoValue(value) ? 'video' : isImageValue(value) ? 'image' : /^https?:\/\/\S+$/.test(value) ? 'web page' : 'text'
		const lengths: Record<string, string> = { short: '2-3 sentences', medium: 'one paragraph', long: 'several paragraphs' }
		const formats: Record<string, string> = {
			bullets: 'as bullet points',
			paragraph: 'as plain paragraphs',
			tldr: 'as a one-line TL;DR followed by key points',
			outline: 'as a Markdown outline with headings',
		}
		const what = kind === 'video' ? 'this video (frames in order)' : kind === 'image' ? 'this image' : `this ${kind}`
		const prompt =
			`Summarize ${what} in ${lengths[node.length] ?? lengths.short}, ${formats[node.format] ?? formats.bullets}.` +
			(node.focus ? ` Focus on: ${node.focus}.` : '') +
			(node.language ? ` Write in ${node.language}.` : '')
		try {
			const images = kind === 'video' ? await videoFrames(value) : undefined
			const result = await apiGenerateText({
				input: kind === 'video' ? undefined : value,
				images,
				prompt,
				model: node.model || undefined,
				...llmRequestSettings(node),
			})
			const usage = result.usage ? formatLlmUsage(result.usage) : ''
			updateNode<SummarizeNode>(this.editor, shape, (n) => ({
				...n,
				lastResultText: result.text,
				lastKind: kind,
				lastUsage: usage || undefined,
				error: null,
			}))
			return { output: result.text }
		} catch (e) {
			updateNode<SummarizeNode>(this.editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
			return { output: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: SummarizeNode, inputs: InfoValues) {
		return textOutput(shape, node.lastResultText, inputs)
	}
	Component = SummarizeNodeComponent
}

function SummarizeNodeComponent({ shape, node }: NodeComponentProps<SummarizeNode>) {
	const editor = useEditor()
	const set = (patch: Partial<SummarizeNode>, outOfDate = true) =>
		updateNode<SummarizeNode>(editor, shape, (n) => ({ ...n, ...patch }), outOfDate)
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="Input" dataType="any" hint="text, URL, image, video" />
			<NodeRow>
				<select className="NodeField-select" value={node.length} onPointerDown={stopEvent} onChange={(e) => set({ length: e.target.value })}>
					<option value="short">Short</option>
					<option value="medium">Medium</option>
					<option value="long">Long</option>
				</select>
				<select className="NodeField-select" value={node.format} onPointerDown={stopEvent} onChange={(e) => set({ format: e.target.value })}>
					<option value="bullets">Bullets</option>
					<option value="paragraph">Paragraph</option>
					<option value="tldr">TL;DR + points</option>
					<option value="outline">Outline</option>
				</select>
			</NodeRow>
			<NodeRow>
				<input className="NodeField-input" placeholder="Focus (optional)" value={node.focus} onPointerDown={stopEvent} onKeyDown={stopEvent} onChange={(e) => set({ focus: e.target.value })} />
				<input className="NodeField-input" placeholder="Language" value={node.language} onPointerDown={stopEvent} onKeyDown={stopEvent} onChange={(e) => set({ language: e.target.value })} />
			</NodeRow>
			<NodeRow>
				<span className="NodeInputRow-label">Model</span>
				<ModelSelect className="node-model-select" capability="vision" value={node.model} onChange={(model) => set({ model }, false)} />
			</NodeRow>
			<NodeRow>
				<span className="NodeStatus">{node.lastKind ? `Last input: ${node.lastKind}` : 'Videos: 6 frames are read'}</span>
			</NodeRow>
			<LlmSettingsPanel editor={editor} shape={shape} node={node} />
		</>
	)
}
