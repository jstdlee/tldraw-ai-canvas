import { Editor, T, useEditor, WeakCache } from 'tldraw'
import {
	NODE_FOOTER_HEIGHT_PX,
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_BOTTOM_PADDING_PX,
	NODE_ROW_HEADER_GAP_PX,
} from '../constants'
import { PortId, ShapePort } from '../ports/Port'
import { NodeShape } from './NodeShapeUtil'
import { AdjustNodeDefinition } from './types/AdjustNode'
import { CaptureNodeDefinition } from './types/CaptureNode'
import { ChatNodeDefinition } from './types/ChatNode'
import { TextAINodeDefinition } from './types/TextAINode'
import { TextToolNodeDefinition } from './types/TextNodes'
import { OutputNodeDefinition } from './types/OutputNode'
import {
	CameraNodeDefinition,
	CropNodeDefinition,
	ImageFilterNodeDefinition,
	ImageResizeNodeDefinition,
	ImageToolNodeDefinition,
} from './types/ImageNodes'
import { ForEachNodeDefinition, IfNodeDefinition, LogicNodeDefinition } from './types/LogicNodes'
import { CodeNodeDefinition } from './types/CodeNode'
import { SubgraphNodeDefinition } from './types/SubgraphNode'
import { removedNodeDefinition } from './types/RemovedNode'
import { JevNodeDefinition } from './types/JevNode'
import { NetToolNodeDefinition, RandomNodeDefinition, SummarizeNodeDefinition } from './types/UtilityNodes'
import { DownloadNodeDefinition, HttpNodeDefinition, SaveNodeDefinition } from './types/WebNodes'
import { PostgresNodeDefinition } from './types/PostgresNode'
import { GenerateTextNodeDefinition } from './types/GenerateTextNode'
import { LoadImageNodeDefinition } from './types/LoadImageNode'
import { NumberNodeDefinition } from './types/NumberNode'
import { PromptConcatNodeDefinition } from './types/PromptConcatNode'
import { PromptNodeDefinition } from './types/PromptNode'
import { RouterNodeDefinition } from './types/RouterNode'
import { ChartNodeDefinition, SqliteNodeDefinition, TableNodeDefinition } from './types/DataNodes'
import {
	AgentNodeDefinition,
	EmojiNodeDefinition,
	HfNodeDefinition,
	LocalToolNodeDefinition,
	ModelPickNodeDefinition,
	MotionNodeDefinition,
	OpenCodeNodeDefinition,
	OpenRouterNodeDefinition,
	SleepNodeDefinition,
	TerminalNodeDefinition,
	VideoNodeDefinition,
} from './types/ToolNodes'
import {
	ExecutionResult,
	InfoValues,
	NodeDefinition,
	NodeDefinitionConstructor,
} from './types/shared'

/** All our node types */
export const NodeDefinitions = {
	// Input
	prompt: PromptNodeDefinition,
	number: NumberNodeDefinition,
	load_image: LoadImageNodeDefinition,
	camera: CameraNodeDefinition,
	random: RandomNodeDefinition,
	capture: CaptureNodeDefinition,
	// Text & AI
	text_ai: TextAINodeDefinition,
	summarize: SummarizeNodeDefinition,
	text_tool: TextToolNodeDefinition,
	generate_text: GenerateTextNodeDefinition,
	chat: ChatNodeDefinition,
	prompt_concat: PromptConcatNodeDefinition,
	// Image (runs in the browser)
	crop: CropNodeDefinition,
	image_resize: ImageResizeNodeDefinition,
	image_filter: ImageFilterNodeDefinition,
	image_tool: ImageToolNodeDefinition,
	adjust: AdjustNodeDefinition,
	// Logic & code
	jev: JevNodeDefinition,
	if: IfNodeDefinition,
	logic: LogicNodeDefinition,
	for_each: ForEachNodeDefinition,
	router: RouterNodeDefinition,
	code: CodeNodeDefinition,
	subgraph: SubgraphNodeDefinition,
	// Web
	http: HttpNodeDefinition,
	download: DownloadNodeDefinition,
	net_tool: NetToolNodeDefinition,
	postgres: PostgresNodeDefinition,
	// Output
	output: OutputNodeDefinition,
	save: SaveNodeDefinition,
	table: TableNodeDefinition,
	chart: ChartNodeDefinition,
	sqlite_in: SqliteNodeDefinition,
	openrouter: OpenRouterNodeDefinition,
	opencode_go: OpenCodeNodeDefinition,
	model_pick: ModelPickNodeDefinition,
	hf: HfNodeDefinition,
	video: VideoNodeDefinition,
	emoji: EmojiNodeDefinition,
	motion: MotionNodeDefinition,
	local_tool: LocalToolNodeDefinition,
	terminal: TerminalNodeDefinition,
	agent_run: AgentNodeDefinition,
	sleep: SleepNodeDefinition,
} satisfies Record<string, NodeDefinitionConstructor<any>>

/**
 * Removed node types. Not part of the typed NodeType union, but still accepted
 * at runtime, so canvases saved with them keep loading (they show as cards to delete).
 */
const RemovedNodeDefinitions: Record<string, NodeDefinitionConstructor<any>> = {
	model: removedNodeDefinition('model', 'Image model'),
	generate: removedNodeDefinition('generate', 'Generate image'),
	controlnet: removedNodeDefinition('controlnet', 'ControlNet'),
	ip_adapter: removedNodeDefinition('ip_adapter', 'IP-Adapter'),
	style_transfer: removedNodeDefinition('style_transfer', 'Style transfer'),
	upscale: removedNodeDefinition('upscale', 'Upscale'),
	iterator: removedNodeDefinition('iterator', 'Iterator'),
	blend: removedNodeDefinition('blend', 'Blend'),
	preview: removedNodeDefinition('preview', 'Preview'),
	text_view: removedNodeDefinition('text_view', 'Text view'),
}

const AllNodeDefinitions: Record<string, NodeDefinitionConstructor<any>> = {
	...NodeDefinitions,
	...RemovedNodeDefinitions,
}

/**
 * A union type of all our node types.
 */
export type NodeType = T.TypeOf<typeof NodeType>
export const NodeType = T.union(
	'type',
	Object.fromEntries(Object.values(AllNodeDefinitions).map((type) => [type.type, type.validator])) as {
		[K in keyof typeof NodeDefinitions as (typeof NodeDefinitions)[K]['type']]: (typeof NodeDefinitions)[K]['validator']
	}
)

const nodeDefinitions = new WeakCache<
	Editor,
	{ [K in keyof typeof NodeDefinitions]: InstanceType<(typeof NodeDefinitions)[K]> }
>()
export function getNodeDefinitions(editor: Editor) {
	return nodeDefinitions.get(editor, () => {
		return Object.fromEntries(
			Object.values(AllNodeDefinitions).map((value) => [value.type, new value(editor)])
		) as any
	})
}

export function getNodeDefinition(
	editor: Editor,
	node: NodeType | NodeType['type']
): NodeDefinition<NodeType> {
	return getNodeDefinitions(editor)[
		typeof node === 'string' ? node : node.type
	] as NodeDefinition<NodeType>
}

/** The node's own width, before the user resized it. */
export function getNodeBaseWidthPx(editor: Editor, shape: NodeShape): number {
	return getNodeDefinition(editor, shape.props.node).getWidthPx(shape, shape.props.node)
}

export function getNodeWidthPx(editor: Editor, shape: NodeShape): number {
	const base = getNodeBaseWidthPx(editor, shape)
	return shape.props.w ? Math.max(shape.props.w, 200) : base
}

export function getNodeBodyHeightPx(editor: Editor, shape: NodeShape): number {
	if (shape.props.collapsed) return 0
	return (
		getNodeDefinition(editor, shape.props.node).getBodyHeightPx(shape, shape.props.node) +
		(shape.props.extraH ?? 0)
	)
}

export function getNodeHeightPx(editor: Editor, shape: NodeShape): number {
	if (shape.props.collapsed) return NODE_HEADER_HEIGHT_PX + NODE_FOOTER_HEIGHT_PX
	return (
		NODE_HEADER_HEIGHT_PX +
		NODE_ROW_HEADER_GAP_PX +
		getNodeBodyHeightPx(editor, shape) +
		NODE_ROW_BOTTOM_PADDING_PX +
		NODE_FOOTER_HEIGHT_PX
	)
}

export function getNodeTypePorts(editor: Editor, shape: NodeShape): Record<string, ShapePort> {
	const ports = getNodeDefinition(editor, shape.props.node).getPorts(shape, shape.props.node)
	const baseW = getNodeBaseWidthPx(editor, shape)
	const w = getNodeWidthPx(editor, shape)
	const list = Object.values(ports)
	if (shape.props.collapsed) {
		// Collapsed: spread the ports over the header + footer strip, inputs left, outputs right.
		const h = NODE_HEADER_HEIGHT_PX + NODE_FOOTER_HEIGHT_PX
		const place = (side: ShapePort[], x: number) =>
			side.map((p, i) => [p.id, { ...p, x, y: (h * (i + 1)) / (side.length + 1) }] as const)
		return Object.fromEntries([
			...place(list.filter((p) => p.terminal === 'end'), 0),
			...place(list.filter((p) => p.terminal === 'start'), w),
		])
	}
	if (w === baseW) return ports
	// Resized: keep output ports on the right edge.
	return Object.fromEntries(
		list.map((p) => [p.id, p.x >= baseW - 1 ? { ...p, x: w } : p])
	)
}

export async function executeNode(
	editor: Editor,
	shape: NodeShape,
	inputs: Record<string, string | number | null | (string | number | null)[]>
): Promise<ExecutionResult> {
	return await getNodeDefinition(editor, shape.props.node).execute(shape, shape.props.node, inputs)
}

export function getNodeOutputInfo(
	editor: Editor,
	shape: NodeShape,
	inputs: InfoValues
): InfoValues {
	return getNodeDefinition(editor, shape.props.node).getOutputInfo(shape, shape.props.node, inputs)
}

export function onNodePortConnect(editor: Editor, shape: NodeShape, port: PortId) {
	getNodeDefinition(editor, shape.props.node).onPortConnect?.(shape, shape.props.node, port)
}

export function onNodePortDisconnect(editor: Editor, shape: NodeShape, port: PortId) {
	getNodeDefinition(editor, shape.props.node).onPortDisconnect?.(shape, shape.props.node, port)
}

export function NodeBody({ shape }: { shape: NodeShape }) {
	const editor = useEditor()
	const node = shape.props.node
	if (shape.props.collapsed) return null
	const { Component } = getNodeDefinition(editor, node)
	return (
		<div className="NodeBody" style={{ height: getNodeBodyHeightPx(editor, shape) }}>
			<Component shape={shape} node={node} />
		</div>
	)
}
