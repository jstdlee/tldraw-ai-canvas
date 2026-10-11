/**
 * One-line descriptions and search keywords for every node type, used by the
 * on-canvas node picker (wire-drop search) and reused by node-specific AI help.
 * Covers every type in `NODE_PORTS` (shared/nodeCatalog.ts), including hidden
 * types, so the coverage test can check every key once.
 */

export interface NodeDescription {
	title: string
	description: string
	keywords: string[]
}

export const NODE_DESCRIPTIONS: Record<string, NodeDescription> = {
	prompt: {
		title: 'Prompt',
		description: 'A block of text you type, used as a prompt or any fixed string.',
		keywords: ['text', 'input', 'string', 'write'],
	},
	prompt_concat: {
		title: 'Concat',
		description: 'Joins a prefix, a main value and a suffix into one piece of text.',
		keywords: ['join', 'combine', 'merge', 'text', 'template'],
	},
	text_tool: {
		title: 'Text tools',
		description: 'Splits, joins, replaces, or otherwise transforms one or two text values.',
		keywords: ['text', 'string', 'split', 'replace', 'join', 'transform'],
	},
	http: {
		title: 'HTTP request',
		description: 'Sends a GET/POST/PUT/PATCH/DELETE request and returns the response.',
		keywords: ['web', 'api', 'request', 'fetch', 'rest', 'url'],
	},
	download: {
		title: 'Download URL',
		description: 'Downloads a URL to a file on this machine.',
		keywords: ['web', 'file', 'save', 'url', 'fetch'],
	},
	net_tool: {
		title: 'Network tools',
		description: 'Runs a network check (ping, traceroute, dig, whois, ports, subnet) on a target.',
		keywords: ['network', 'ping', 'dns', 'whois', 'ports', 'diagnostic'],
	},
	postgres: {
		title: 'Postgres',
		description: 'Runs SQL against Postgres, or imports a CSV into a new table.',
		keywords: ['sql', 'database', 'postgres', 'query', 'import', 'csv'],
	},
	text_ai: {
		title: 'AI text',
		description: 'Rewrites, translates, summarizes or otherwise edits text with an LLM.',
		keywords: ['ai', 'llm', 'rewrite', 'translate', 'edit', 'instruction'],
	},
	generate_text: {
		title: 'Generate text',
		description: 'Calls a model to generate text from a prompt, optionally about an image.',
		keywords: ['ai', 'llm', 'generate', 'caption', 'describe', 'vision'],
	},
	chat: {
		title: 'Chat message',
		description: 'One turn of a branching chat conversation with an LLM.',
		keywords: ['ai', 'chat', 'conversation', 'message', 'llm'],
	},
	summarize: {
		title: 'Summarize',
		description: 'Summarizes text, a URL, an image or a video with an LLM.',
		keywords: ['ai', 'summary', 'tldr', 'bullets', 'llm'],
	},
	jev: {
		title: 'JEV decision',
		description: 'Asks a judge model a yes/no, multiple-choice, or scored question and returns probabilities.',
		keywords: ['ai', 'decision', 'classifier', 'judge', 'probability', 'choice'],
	},
	decision_switch: {
		title: 'Decision switch',
		description: 'Routes a value to one output based on a JEV (or other) decision: yes/no, one of several options, or a score band.',
		keywords: ['switch', 'route', 'decide', 'branch', 'yes', 'no', 'choice', 'score', 'band', 'jev'],
	},
	load_image: {
		title: 'Load image',
		description: 'Loads an image from a URL, a file path, a paste, or a drag-and-drop.',
		keywords: ['image', 'upload', 'file', 'url', 'load'],
	},
	camera: {
		title: 'Camera',
		description: 'Takes a photo with the webcam.',
		keywords: ['image', 'webcam', 'photo', 'capture'],
	},
	capture: {
		title: 'Capture',
		description: 'A drawable area: capture anything drawn on the canvas as an image.',
		keywords: ['image', 'draw', 'sketch', 'canvas'],
	},
	crop: {
		title: 'Crop',
		description: 'Crops an image to an aspect ratio or a custom box.',
		keywords: ['image', 'crop', 'aspect', 'trim'],
	},
	image_resize: {
		title: 'Resize',
		description: 'Resizes an image to new dimensions.',
		keywords: ['image', 'resize', 'scale', 'dimensions'],
	},
	image_filter: {
		title: 'Filter',
		description: 'Adjusts brightness, contrast and saturation on an image, or applies a preset.',
		keywords: ['image', 'filter', 'brightness', 'contrast', 'saturation', 'preset'],
	},
	image_tool: {
		title: 'Image tools',
		description: 'Combines two images (blend, overlay, difference…) or runs a single-image tool.',
		keywords: ['image', 'blend', 'overlay', 'combine', 'tool'],
	},
	adjust: {
		title: 'Adjust',
		description: 'Quick image adjustment node (legacy; prefer Filter).',
		keywords: ['image', 'adjust', 'filter'],
	},
	image_gen: {
		title: 'Generate image',
		description: 'Generates one or more images from a prompt with an image model (Google, OpenAI, OpenRouter, or a custom URL).',
		keywords: ['image', 'ai', 'generate', 'txt2img', 'dall-e', 'imagen', 'flux', 'stable diffusion'],
	},
	number: {
		title: 'Number',
		description: 'A single number value, adjustable with a slider or the spinner.',
		keywords: ['number', 'value', 'slider', 'constant'],
	},
	random: {
		title: 'Random',
		description: 'Picks a random number, or a random item from a list.',
		keywords: ['random', 'chance', 'shuffle', 'pick'],
	},
	if: {
		title: 'If / else',
		description: 'Routes a value down one of two outputs based on a condition.',
		keywords: ['logic', 'branch', 'condition', 'if', 'else'],
	},
	logic: {
		title: 'And / Or / Not',
		description: 'Combines two boolean inputs with a logic operator.',
		keywords: ['logic', 'boolean', 'and', 'or', 'not'],
	},
	for_each: {
		title: 'For each',
		description: 'Runs the rest of the graph once per item in a list.',
		keywords: ['loop', 'iterate', 'list', 'each', 'repeat'],
	},
	router: {
		title: 'Router',
		description: 'Sends one input to one of several outputs.',
		keywords: ['logic', 'route', 'switch', 'branch'],
	},
	code: {
		title: 'Code',
		description: 'Runs a small TypeScript, JavaScript or Python function with your own inputs and outputs.',
		keywords: ['code', 'script', 'function', 'typescript', 'python', 'javascript'],
	},
	subgraph: {
		title: 'Packed group',
		description: 'A packed-up group of nodes shown as one box; double-click to open it.',
		keywords: ['group', 'pack', 'collapse', 'subgraph'],
	},
	output: {
		title: 'Output',
		description: 'Shows whatever reaches it (text, image, Markdown, Mermaid, JSON, or a link).',
		keywords: ['preview', 'view', 'result', 'display'],
	},
	save: {
		title: 'Save to file',
		description: 'Saves text or an image to a file on this machine.',
		keywords: ['save', 'export', 'file', 'write'],
	},
	table: {
		title: 'DataPipe',
		description: 'One table operation at a time: filter, sort, add a column, join, and more. Chain several to build a pipeline.',
		keywords: ['table', 'csv', 'tsv', 'xlsx', 'data', 'spreadsheet', 'pipe'],
	},
	chart: {
		title: 'Chart',
		description: 'Draws a bar, line, area, scatter, pie, histogram or heatmap chart from a table.',
		keywords: ['chart', 'graph', 'plot', 'visualization', 'bar', 'line', 'area', 'scatter', 'pie', 'donut', 'histogram', 'heatmap'],
	},
	profile: {
		title: 'Profile',
		description: 'Shows what is in a table: column types, fill rate, distinct values, min/max and a histogram.',
		keywords: ['profile', 'stats', 'statistics', 'summary', 'types', 'histogram', 'quality', 'data quality'],
	},
	database: {
		title: 'Database',
		description: 'Opens a SQLite/.db file and runs a query against it. Click a table to query it.',
		keywords: ['sqlite', 'database', 'sql', 'table', 'query'],
	},
	openrouter: {
		title: 'OpenRouter free',
		description: 'Picks a free model on OpenRouter to use as the model id.',
		keywords: ['ai', 'model', 'openrouter', 'free'],
	},
	raw_model: {
		title: 'Raw model',
		description: 'A model call with every setting on the card: endpoint, model id, key, system prompt.',
		keywords: ['ai', 'model', 'api', 'endpoint', 'raw', 'advanced'],
	},
	model_source: {
		title: 'Model provider',
		description: 'Fetches the models a custom OpenAI-compatible URL serves and outputs the one you pick.',
		keywords: ['ai', 'model', 'provider', 'openai-compatible', 'ollama', 'openrouter', 'fetch models'],
	},
	video: {
		title: 'Video link',
		description: 'Plays a video or YouTube link on the card and passes the link on.',
		keywords: ['video', 'youtube', 'player', 'media'],
	},
	file_in: {
		title: 'Read from',
		description: 'Reads an uploaded file or a URL: text, an image, a spreadsheet (as CSV), or SHA-256 of the bytes.',
		keywords: ['file', 'url', 'upload', 'read', 'hash', 'csv', 'xlsx', 'image'],
	},
	url_in: {
		title: 'URL in',
		description: 'Reads a URL, optionally fetching the page text. Replaced by "Read from"; kept so old canvases still load.',
		keywords: ['url', 'web', 'fetch', 'read'],
	},
	sleep: {
		title: 'Sleep',
		description: 'Waits a number of milliseconds before passing its input on.',
		keywords: ['delay', 'wait', 'pause', 'timer'],
	},
}
