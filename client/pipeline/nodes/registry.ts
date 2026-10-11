import { Editor, T } from 'tldraw'
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
import type { NodeDefinition, NodeDefinitionConstructor } from './types/shared'
import {
	getNodeDefinition as getNodeDefinitionFromStore,
	getNodeDefinitions as getNodeDefinitionsFromStore,
	setNodeDefinitionClasses,
} from './definitionStore'

/**
 * The node type registry: every node type definition, and the `NodeType` validator union built
 * from them.
 *
 * This is the one file that imports every file under `types/`, including `SubgraphNode.tsx`.
 * Anything under `types/*.tsx` (directly, or via `nodePorts.tsx` -> `nodeTypes.tsx`) used to
 * import `getNodeDefinition`/`getNodeDefinitions` from here too, which closed a cycle back into
 * this file while it was still initialising — Vite's dev server then failed a hot reload of a
 * single node file with "Cannot access … before initialization". The lookup functions now live
 * in the leaf module `definitionStore.ts`, which has no imports of `types/*.tsx` or of this file;
 * at the bottom of this module's own load we hand it the class map with
 * `setNodeDefinitionClasses`. Everywhere except `NodeShapeUtil.tsx` (which needs the `NodeType`
 * validator for the shape's `props`) and tests should import `getNodeDefinition`/
 * `getNodeDefinitions` from `definitionStore.ts` (or re-exports of them, e.g. `nodeTypes.tsx`),
 * never from this file.
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

// Hand the class map to the leaf definitionStore module once, at load time, so every other
// file can look definitions up without importing this one (see definitionStore.ts's comment).
// registry.ts is guaranteed to run before any editor is created because NodeShapeUtil.tsx
// (imported by App.tsx before <Tldraw> mounts) imports this file for the NodeType validator.
setNodeDefinitionClasses(AllNodeDefinitions)

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

export function getNodeDefinitions(
	editor: Editor
): { [K in keyof typeof NodeDefinitions]: InstanceType<(typeof NodeDefinitions)[K]> } {
	return getNodeDefinitionsFromStore<NodeType>(editor) as any
}

export function getNodeDefinition(
	editor: Editor,
	node: NodeType | NodeType['type']
): NodeDefinition<NodeType> {
	return getNodeDefinitionFromStore<NodeType>(editor, node)
}
