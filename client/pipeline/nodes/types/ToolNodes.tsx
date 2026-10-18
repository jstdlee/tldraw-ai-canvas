import { useEffect, useState } from 'react'
import { categoryOf } from '../../../../shared/nodeGroups'
import { HubModel } from '../../../../shared/modelPick'
import { T, useEditor, useValue } from 'tldraw'
import { youtubeEmbed } from '../../../../shared/youtube'
import { getNodeInputPortValues } from '../nodePorts'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_WIDTH_PX } from '../../constants'
import { currentRunSignal } from '../../execution/executionState'
import { ShapePort } from '../../ports/Port'
import { sleep } from '../../utils/sleep'
import { NodeShape } from '../NodeShapeUtil'
import { IconPlay, UiButton, UiIconButton, UiTextInput } from '../../../ui'
import { PortRow, stopEvent, NodeSelect, WireField } from './fields'
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

function end(id: string, row: number, rowPx: number, dataType: 'text' | 'any' = 'text'): ShapePort {
	return { id, x: 0, y: BASE + rowPx * (row + 0.5), terminal: 'end', dataType }
}
function out(dataType: 'text' | 'any' = 'text'): ShapePort {
	return { id: 'output', x: NODE_WIDTH_PX, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType }
}
function info(shape: NodeShape, value: string | null, inputs: InfoValues, dataType: 'text' | 'any' = 'text'): InfoValues {
	return { output: { value, isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate, dataType } }
}

function Line({
	shapeId,
	fieldKey,
	label,
	value,
	onChange,
}: {
	shapeId: NodeShape['id']
	fieldKey: string
	label: string
	value: string
	onChange: (value: string) => void
}) {
	return (
		<WireField shapeId={shapeId} fieldKey={fieldKey} label={label} dataType="number">
			<UiTextInput value={value} onChange={onChange} />
		</WireField>
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
	override showsOutput = true
	getDefault(): VideoNode {
		return { type: 'video', url: '', autoplay: false }
	}
	getBodyHeightPx(shape: NodeShape) {
		// Link row + autoplay row (WP17: its own row), then a 16:9 frame at the card width.
		return getNodeRowHeightPx(shape.props.fontSize) * 3 + Math.ceil(((NODE_WIDTH_PX - 16) * 9) / 16) + 12
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return { url: end('url', 0, rowPx), output: out() }
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
				<UiTextInput placeholder="https://…/clip.mp4 or a YouTube link" value={node.url} onChange={(url) => set({ url })} />
			</NodeRow>
			<WireField shapeId={shape.id} fieldKey="autoplay" label="Autoplay">
				<UiIconButton icon={<IconPlay />} title="Autoplay (muted)" active={node.autoplay} onClick={() => set({ autoplay: !node.autoplay })} />
			</WireField>
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
	getBodyHeightPx(shape: NodeShape) {
		return getNodeRowHeightPx(shape.props.fontSize) * 2
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return { input: end('input', 0, rowPx, 'any'), output: out('any') }
	}
	async execute(_shape: NodeShape, node: SleepNode, inputs: InputValues): Promise<ExecutionResult> {
		// FLOW-04: wait abortably, so Stop interrupts the wait itself (not just whatever was
		// downstream of it) and the run reports "stopped" rather than running to completion.
		await sleep(Math.max(0, Math.min(node.ms, 60_000)), currentRunSignal(this.editor))
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
			<Line
				shapeId={shape.id}
				fieldKey="ms"
				label="ms"
				value={String(node.ms)}
				onChange={(value) => updateNode<SleepNode>(editor, shape, (n) => ({ ...n, ms: Number(value) || 0 }), false)}
			/>
		</>
	)
}

/** UI-02: a failed fetch used to leave `response.json()` to throw a raw browser exception
 * ("Failed to execute 'json' on 'Response'...") straight into the dropdown's own text. Check
 * the response before parsing it, and never show the raw exception message — only a generic,
 * friendly one, with a Retry affordance (`reload`). */
function useHub(url: string) {
	const [models, setModels] = useState<HubModel[]>([])
	const [error, setError] = useState<string | null>(null)
	const [attempt, setAttempt] = useState(0)
	useEffect(() => {
		let dead = false
		setError(null)
		fetch(url)
			.then(async (response) => {
				let payload: { models?: HubModel[]; error?: string } | null = null
				try {
					payload = await response.json()
				} catch {
					// Not JSON at all (a proxy error page, a truncated/aborted body, …).
				}
				if (dead) return
				if (!response.ok || !payload || payload.error) {
					throw new Error(payload?.error || `Request failed (${response.status})`)
				}
				setModels(payload.models ?? [])
			})
			.catch((cause) => {
				if (dead) return
				setModels([])
				setError(`Couldn't load free models: ${(cause as Error).message || 'network error'}`)
			})
		return () => {
			dead = true
		}
	}, [url, attempt])
	return { models, error, reload: () => setAttempt((n) => n + 1) }
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
	getBodyHeightPx(shape: NodeShape) {
		return getNodeRowHeightPx(shape.props.fontSize)
	}
	getPorts(): Record<string, ShapePort> {
		return { output: out() }
	}
	async execute(shape: NodeShape, node: OpenRouterNode): Promise<ExecutionResult> {
		let model = node.model
		if (!model) {
			let payload: { models?: HubModel[]; error?: string } | null = null
			try {
				const response = await fetch('/api/hub/openrouter')
				payload = await response.json()
				if (!response.ok && !payload?.error) throw new Error(`Request failed (${response.status})`)
			} catch (e) {
				throw new Error(payload?.error || `Couldn't load free models: ${(e as Error).message}`)
			}
			if (payload?.error) throw new Error(payload.error)
			model = payload?.models?.[0]?.id ?? ''
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
	const { models, error, reload } = useHub('/api/hub/openrouter')
	return (
		<WireField shapeId={shape.id} fieldKey="model" label="Model" dataType="model">
			{error ? (
				<>
					<span className="NodeStatus is-error" title={error}>
						Couldn't load free models
					</span>
					<UiButton size="sm" variant="low" label="Retry" onClick={reload} />
				</>
			) : (
				<NodeSelect className="NodeField-select" value={node.model} onPointerDown={stopEvent} onChange={(e) => updateNode<OpenRouterNode>(editor, shape, (n) => ({ ...n, model: e.target.value }), false)}>
					<option value="">{models.length ? 'Free models' : 'Loading free models…'}</option>
					{models.map((model) => (
						<option key={model.id} value={model.id}>{model.name}</option>
					))}
				</NodeSelect>
			)}
		</WireField>
	)
}

