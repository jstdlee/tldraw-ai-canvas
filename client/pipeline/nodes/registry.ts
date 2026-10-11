import { Editor, T, WeakCache } from 'tldraw'
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
import { ChartNodeDefinition, TableNodeDefinition } from './types/DataNodes'
import { DatabaseNodeDefinition } from './types/DatabaseNode'
import { FileInNodeDefinition, UrlInNodeDefinition } from './types/InputNodes'
import { ImageGenNodeDefinition } from './types/ImageGenNode'
import { ModelSourceNodeDefinition } from './types/ModelSourceNode'
import { RawModelNodeDefinition } from './types/RawModelNode'
import { OpenRouterNodeDefinition, SleepNodeDefinition, VideoNodeDefinition } from './types/ToolNodes'
import { NodeDefinition, NodeDefinitionConstructor } from './types/shared'

/**
 * The node type registry: every node type definition, and the lookup helpers built from it.
 *
 * This file (not `nodeTypes.tsx`) is the one that imports every file under `types/`, including
 * `SubgraphNode.tsx`. Keeping that big import list here, instead of in `nodeTypes.tsx`, means
 * `NodeShapeUtil.tsx` and `subgraph.ts` can depend on just the small lookup functions below
 * without pulling in the whole node-type graph at module load — `SubgraphNode.tsx` (which needs
 * `openGroup` from `subgraph.ts`, and `subgraph.ts` needs `getNodeDefinition` from here) no
 * longer closes a cycle back through them. Vite's dev server can then hot-reload a single node
 * file without "Cannot access … before initialization".
 */

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
	model_source: ModelSourceNodeDefinition,
	prompt_concat: PromptConcatNodeDefinition,
	// Image (runs in the browser)
	crop: CropNodeDefinition,
	image_resize: ImageResizeNodeDefinition,
	image_filter: ImageFilterNodeDefinition,
	image_tool: ImageToolNodeDefinition,
	adjust: AdjustNodeDefinition,
	image_gen: ImageGenNodeDefinition,
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
	database: DatabaseNodeDefinition,
	openrouter: OpenRouterNodeDefinition,
	raw_model: RawModelNodeDefinition,
	video: VideoNodeDefinition,
	file_in: FileInNodeDefinition,
	url_in: UrlInNodeDefinition,
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
	emoji: removedNodeDefinition('emoji', 'Emoji'),
	motion: removedNodeDefinition('motion', 'Motion'),
	hf: removedNodeDefinition('hf', 'Hugging Face'),
	opencode_go: removedNodeDefinition('opencode_go', 'OpenCode Go'),
	model_pick: removedNodeDefinition('model_pick', 'Pick a model'),
	terminal: removedNodeDefinition('terminal', 'Terminal'),
	agent_run: removedNodeDefinition('agent_run', 'Local agent'),
	local_tool: removedNodeDefinition('local_tool', 'Local tool'),
	sqlite_in: removedNodeDefinition('sqlite_in', 'SQLite import'),
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
