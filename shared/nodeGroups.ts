/** Sidebar groups. Concat and prompts sit with Text. Net, LLM and Image are separate. */

export const NODE_GROUPS = [
	{ id: 'text', label: 'Text' },
	{ id: 'data', label: 'Data' },
	{ id: 'net', label: 'Net' },
	{ id: 'llm', label: 'LLM' },
	{ id: 'image', label: 'Image' },
	{ id: 'media', label: 'Media' },
	{ id: 'tools', label: 'Tools' },
	{ id: 'logic', label: 'Logic & code' },
	{ id: 'input', label: 'Input' },
	{ id: 'output', label: 'Output' },
] as const

export type NodeGroupId = (typeof NODE_GROUPS)[number]['id']

export const NODE_GROUP_LABELS: Record<string, string> = Object.fromEntries(
	NODE_GROUPS.map((g) => [g.id, g.label])
)

export const NODE_GROUP_ORDER: string[] = NODE_GROUPS.map((g) => g.id)

/** Which group each node type belongs to. */
export const NODE_CATEGORY: Record<string, NodeGroupId> = {
	prompt: 'text',
	prompt_concat: 'text',
	text_tool: 'text',
	http: 'net',
	download: 'net',
	net_tool: 'net',
	postgres: 'net',
	text_ai: 'llm',
	generate_text: 'llm',
	chat: 'llm',
	summarize: 'llm',
	jev: 'llm',
	load_image: 'image',
	camera: 'image',
	capture: 'image',
	crop: 'image',
	image_resize: 'image',
	image_filter: 'image',
	image_tool: 'image',
	adjust: 'image',
	number: 'input',
	random: 'input',
	if: 'logic',
	logic: 'logic',
	for_each: 'logic',
	router: 'logic',
	code: 'logic',
	subgraph: 'logic',
	output: 'output',
	save: 'output',
	table: 'data',
	chart: 'data',
	sqlite_in: 'data',
	openrouter: 'llm',
	opencode_go: 'llm',
	model_pick: 'llm',
	hf: 'llm',
	video: 'media',
	emoji: 'media',
	motion: 'media',
	local_tool: 'tools',
	terminal: 'tools',
	agent_run: 'tools',
	sleep: 'logic',
}

export function categoryOf(type: string): string {
	return NODE_CATEGORY[type] ?? 'logic'
}
