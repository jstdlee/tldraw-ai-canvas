/** Sidebar groups, in the order a workflow is built: bring data in, shape it, think, show it. */

export const NODE_GROUPS = [
	{ id: 'input', label: 'Input' },
	{ id: 'text', label: 'Text' },
	{ id: 'llm', label: 'AI' },
	{ id: 'image', label: 'Image' },
	{ id: 'data', label: 'Data' },
	{ id: 'net', label: 'Net' },
	{ id: 'logic', label: 'Logic & code' },
	{ id: 'media', label: 'Media' },
	{ id: 'output', label: 'Output' },
] as const

export type NodeGroupId = (typeof NODE_GROUPS)[number]['id']

export const NODE_GROUP_LABELS: Record<string, string> = Object.fromEntries(
	NODE_GROUPS.map((g) => [g.id, g.label])
)

export const NODE_GROUP_ORDER: string[] = NODE_GROUPS.map((g) => g.id)

/** Which group each node type belongs to. */
export const NODE_CATEGORY: Record<string, NodeGroupId> = {
	// Input: where a value comes from
	prompt: 'input',
	number: 'input',
	random: 'input',
	file_in: 'input',
	url_in: 'input',
	load_image: 'input',
	camera: 'input',
	capture: 'input',
	// Text
	prompt_concat: 'text',
	text_tool: 'text',
	// AI
	generate_text: 'llm',
	chat: 'llm',
	summarize: 'llm',
	text_ai: 'llm',
	raw_model: 'llm',
	jev: 'llm',
	openrouter: 'llm',
	// Image
	crop: 'image',
	image_resize: 'image',
	image_filter: 'image',
	image_tool: 'image',
	adjust: 'image',
	// Data
	table: 'data',
	chart: 'data',
	postgres: 'data',
	sqlite_in: 'data',
	// Net
	http: 'net',
	download: 'net',
	net_tool: 'net',
	// Logic & code
	if: 'logic',
	logic: 'logic',
	for_each: 'logic',
	router: 'logic',
	sleep: 'logic',
	code: 'logic',
	subgraph: 'logic',
	// Media
	video: 'media',
	// Output
	output: 'output',
	save: 'output',
}

export function categoryOf(type: string): string {
	return NODE_CATEGORY[type] ?? 'logic'
}
