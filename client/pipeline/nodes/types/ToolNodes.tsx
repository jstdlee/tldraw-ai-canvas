import { useEffect, useState } from 'react'
import { categoryOf } from '../../../../shared/nodeGroups'
import { HubModel } from '../../../../shared/modelPick'
import { T, useEditor, useValue } from 'tldraw'
import { youtubeEmbed } from '../../../../shared/youtube'
import { getNodeInputPortValues } from '../nodePorts'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX, NODE_WIDTH_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { sleep } from '../../utils/sleep'
import { NodeShape } from '../NodeShapeUtil'
import { PortRow, stopEvent, NodeSelect } from './fields'
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

function Line({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
	return (
		<NodeRow>
			<span className="NodeInputRow-label">{label}</span>
			<input className="NodeField-input" value={value} onPointerDown={stopEvent} onKeyDown={stopEvent} onChange={(e) => onChange(e.target.value)} />
		</NodeRow>
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
		// Row for the link, then a 16:9 frame at the card width (260 - 16 margin).
		return NODE_ROW_HEIGHT_PX * 2 + Math.ceil(((NODE_WIDTH_PX - 16) * 9) / 16) + 12
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
	// A wired link wins over the typed one, so the player shows what the run will pass on.
	const wired = useValue(
		'video link',
		() => {
			const value = getNodeInputPortValues(editor, shape.id).url?.value
			return typeof value === 'string' ? value : ''
		},
		[editor, shape.id]
	)
	const url = (wired || node.url).trim()
	const embed = youtubeEmbed(url)
	return (
		<>
			<PortRow shapeId={shape.id} portId="url" label="Link" dataType="text" />
			<NodeRow>
				<input className="NodeField-input" placeholder="https://…/clip.mp4 or a YouTube link" value={node.url} onPointerDown={stopEvent} onKeyDown={stopEvent} onChange={(e) => set({ url: e.target.value })} />
				<button type="button" className={'NodeField-button' + (node.autoplay ? ' is-on' : '')} title="Autoplay (muted)" onPointerDown={stopEvent} onClick={() => set({ autoplay: !node.autoplay })}>
					▶
				</button>
			</NodeRow>
			{embed ? (
				<iframe
					key={`${embed}-${node.autoplay}`}
					className="VideoNode-player VideoNode-frame"
					src={`${embed}?rel=0${node.autoplay ? '&autoplay=1&mute=1' : ''}`}
					title="YouTube video"
					allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
					allowFullScreen
					referrerPolicy="strict-origin-when-cross-origin"
					onPointerDown={stopEvent}
				/>
			) : (
				url && <video className="VideoNode-player" src={url} controls autoPlay={node.autoplay} muted={node.autoplay} loop={node.autoplay} onPointerDown={stopEvent} />
			)}
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
			<NodeSelect className="NodeField-select" value={node.model} onPointerDown={stopEvent} onChange={(e) => updateNode<OpenRouterNode>(editor, shape, (n) => ({ ...n, model: e.target.value }), false)}>
				<option value="">{error || (models.length ? 'Free models' : 'Loading free models…')}</option>
				{models.map((model) => (
					<option key={model.id} value={model.id}>{model.name}</option>
				))}
			</NodeSelect>
		</NodeRow>
	)
}

