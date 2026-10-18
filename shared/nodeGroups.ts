/**
 * One taxonomy for every card: used by the library drawer, the wire-drop picker, the
 * command palette, the Build-with-AI type chips, and the AI specs. Groups are in the
 * order a workflow is usually built: bring data/text/images in, shape and think about
 * them, reach out to the web, decide, then show the result.
 */

export const NODE_GROUPS = [
	{ id: 'sources', label: 'Sources' },
	{ id: 'data', label: 'Data' },
	{ id: 'text', label: 'Text' },
	{ id: 'ai', label: 'AI models' },
	{ id: 'decide', label: 'Decide' },
	{ id: 'web', label: 'Web' },
	{ id: 'image', label: 'Image' },
	{ id: 'flow', label: 'Flow & code' },
	{ id: 'output', label: 'Output' },
] as const

export type NodeGroupId = (typeof NODE_GROUPS)[number]['id']

export const NODE_GROUP_LABELS: Record<string, string> = Object.fromEntries(
	NODE_GROUPS.map((g) => [g.id, g.label])
)

export const NODE_GROUP_ORDER: string[] = NODE_GROUPS.map((g) => g.id)

/** Which group each node type belongs to. Every type in `shared/nodeCatalog.ts` has one entry. */
export const NODE_CATEGORY: Record<string, NodeGroupId> = {
	// Sources: where a value comes from
	prompt: 'sources',
	file_in: 'sources',
	url_in: 'sources', // superseded by file_in ("Read from"), kept for old canvases
	load_image: 'sources',
	camera: 'sources',
	capture: 'sources',
	random: 'sources',
	number: 'sources',
	html_form: 'sources',
	// Data: tables, databases, charts
	table: 'data',
	database: 'data',
	postgres: 'data', // superseded by database, kept hidden for old canvases
	chart: 'data',
	profile: 'data',
	json_fields: 'data',
	// Text
	prompt_concat: 'text',
	text_tool: 'text',
	extract: 'text',
	template: 'text',
	// AI models
	generate_text: 'ai',
	text_ai: 'ai',
	chat: 'ai',
	agent: 'ai',
	raw_model: 'ai',
	model_source: 'ai',
	openrouter: 'ai',
	image_gen: 'ai',
	// Decide
	jev: 'decide',
	decision_switch: 'decide',
	if: 'decide',
	logic: 'decide',
	router: 'decide',
	// Web
	http: 'web',
	download: 'web',
	net_tool: 'web',
	video: 'web',
	web_search: 'web',
	// Image
	crop: 'image',
	image_resize: 'image',
	image_filter: 'image',
	image_tool: 'image',
	adjust: 'image', // legacy, prefer image_filter
	// Flow & code
	for_each: 'flow',
	code: 'flow',
	sleep: 'flow',
	subgraph: 'flow', // "Group boxes"
	merge: 'flow',
	// Output
	output: 'output',
	save: 'output',
	table_view: 'output',
	html_preview: 'output',
	gallery: 'output',
}

export function categoryOf(type: string): string {
	return NODE_CATEGORY[type] ?? 'flow'
}
