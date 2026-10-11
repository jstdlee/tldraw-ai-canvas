/**
 * One rich, static description per node type: the single source for AI prompts
 * (per-node specialist and "Build with AI") and for plan validation (shared/aiPlan.ts).
 * Pure data + pure functions only — no tldraw import, so this is testable in Node.
 */

import { NODE_PORTS } from './nodeCatalog'
import { NODE_DESCRIPTIONS } from './nodeDescriptions'
import { TABLE_OPS, opSpec } from './tableOps'
import { TEXT_TOOL_OPS } from './textTools'
import { TEXT_AI_OPERATIONS } from './textAiOps'
import { CHART_KINDS } from './chartOption'
import { JEV_KINDS } from './jevKinds'
import { FILTER_PRESETS } from './imageFilters'

export type FieldKind = 'text' | 'longtext' | 'code' | 'sql' | 'number' | 'boolean' | 'enum' | 'model' | 'json' | 'url'

export interface FieldSpec {
	key: string
	kind: FieldKind
	label: string
	description: string
	options?: string[]
	default?: unknown
	/** WP17: every field can be wired (an input port overrides it) unless this is false.
	 * Secrets (keyRef, apiKey, passwords) are never wirable. */
	wire?: boolean
}

export interface PortSpec {
	id: string
	dataType: string
	description: string
}

export interface NodeSpec {
	type: string
	title: string
	group: string
	purpose: string
	useWhen: string
	inputs: PortSpec[]
	outputs: PortSpec[]
	fields: FieldSpec[]
	assistant: {
		role: string
		chips: string[]
		rules?: string[]
	}
	/** Hidden from the toolbar / on-canvas picker: the AI may not add one. */
	hidden?: boolean
}

function port(id: string, dataType: string, description: string): PortSpec {
	return { id, dataType, description }
}

function field(
	key: string,
	kind: FieldKind,
	label: string,
	description: string,
	options?: string[],
	def?: unknown,
	wire: boolean = true
): FieldSpec {
	return { key, kind, label, description, options, default: def, wire }
}

const TEXT_AI_OP_IDS = TEXT_AI_OPERATIONS.map((o) => o.id)
const CHART_KIND_IDS = CHART_KINDS.map((k) => k.id)
const JEV_KIND_IDS = JEV_KINDS.map((k) => k.id)

const TABLE_OP_IDS = TABLE_OPS.filter((spec) => !spec.hidden).map((spec) => spec.id)
const FILTER_PRESET_NAMES = Object.keys(FILTER_PRESETS)
const TEXT_TOOL_OP_IDS = TEXT_TOOL_OPS.map((o) => o.id)

const NET_TOOL_IDS = [
	'ping', 'traceroute', 'dig', 'dns', 'reverse_dns', 'port', 'whois',
	'http_headers', 'my_ips', 'subnet', 'subnet_split', 'ip_info',
]

const IMAGE_TOOL_IDS = ['info', 'convert', 'pixelate', 'border', 'round', 'watermark', 'square', 'data_url', 'look']

function title(type: string): string {
	return NODE_DESCRIPTIONS[type]?.title ?? type
}

function purpose(type: string): string {
	return NODE_DESCRIPTIONS[type]?.description ?? ''
}

/** shared/nodeGroups.ts duplicated here (no tldraw import boundary issue, but this
 * file must stay pure too, and importing it is fine — it's shared/ already). */
import { NODE_CATEGORY } from './nodeGroups'

function groupOf(type: string): string {
	return NODE_CATEGORY[type] ?? 'flow'
}

const llmFields = (modelLabel = 'Model'): FieldSpec[] => [
	field('model', 'model', modelLabel, 'The model to call. Empty uses the default model for this job.'),
	field('system', 'longtext', 'System prompt', 'Extra instructions sent before the user content.'),
]

export const NODE_SPECS: Record<string, NodeSpec> = {
	prompt: {
		type: 'prompt',
		title: title('prompt'),
		group: groupOf('prompt'),
		purpose: purpose('prompt'),
		useWhen: 'Use for any fixed piece of text: a prompt, a template, a constant string to feed another node.',
		inputs: [],
		outputs: [port('output', 'text', 'The text typed into the box.')],
		fields: [field('text', 'longtext', 'Text', 'The literal text this node outputs.')],
		assistant: {
			role: 'You write the text this node should output. Keep it focused on what the user asked for.',
			chips: ['Write a short prompt for…', 'A constant value for…', 'A template with {{placeholders}}'],
		},
	},
	prompt_concat: {
		type: 'prompt_concat',
		title: title('prompt_concat'),
		group: groupOf('prompt_concat'),
		purpose: purpose('prompt_concat'),
		useWhen: 'Use to join a prefix, a main value and a suffix into one piece of text.',
		inputs: [port('prefix', 'text', 'Text placed before the main value.'), port('main', 'text', 'The main value.'), port('suffix', 'text', 'Text placed after the main value.')],
		outputs: [port('output', 'text', 'prefix + separator + main + separator + suffix.')],
		fields: [field('separator', 'text', 'Separator', 'Inserted between the joined parts.', undefined, ' ')],
		assistant: {
			role: 'You choose the separator used to join the three inputs.',
			chips: ['Join with a space', 'Join with a new line', 'No separator'],
		},
	},
	text_tool: {
		type: 'text_tool',
		title: title('text_tool'),
		group: groupOf('text_tool'),
		purpose: purpose('text_tool'),
		useWhen: 'Use for a no-AI text transform: splitting, replacing, encoding, case, counting, extracting.',
		inputs: [port('input', 'text', 'The main text.'), port('input2', 'text', 'A second text, used by tools that compare or append two values.')],
		outputs: [port('output', 'text', 'The transformed text.')],
		fields: [
			field('op', 'enum', 'Tool', 'Which text operation to run.', TEXT_TOOL_OP_IDS),
			field('a', 'text', 'Param A', 'First parameter the chosen tool needs (varies by tool, e.g. a pattern or separator).'),
			field('b', 'text', 'Param B', 'Second parameter the chosen tool needs (varies by tool).'),
		],
		assistant: {
			role: 'You pick one text tool (op) and its parameters (a, b) to do what the user asked, from the fixed list of tools.',
			chips: ['Extract e-mail addresses', 'Find and replace…', 'Convert to Title Case', 'Count words'],
			rules: ['Only use a tool id from the given list.'],
		},
	},
	http: {
		type: 'http',
		title: title('http'),
		group: groupOf('http'),
		purpose: purpose('http'),
		useWhen: 'Use to call a web API or fetch a page; the server makes the request (no CORS limits).',
		inputs: [port('url', 'text', 'Overrides the URL field when wired.'), port('body', 'text', 'Overrides the body field when wired.')],
		outputs: [port('output', 'text', 'Response text, or extracted readable text.')],
		fields: [
			field('method', 'enum', 'Method', 'HTTP method.', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], 'GET'),
			field('url', 'url', 'URL', 'The address to call.'),
			field('query', 'text', 'Query', 'Query string appended to the URL, e.g. a=1&b=2.'),
			field('headers', 'longtext', 'Headers', 'One "Name: value" header per line.'),
			field('body', 'longtext', 'Body', 'Request body, sent for POST/PUT/PATCH.'),
			field('auth', 'enum', 'Auth', 'Authorization style.', ['', 'bearer', 'basic']),
			field('authValue', 'text', 'Auth value', 'The token or user:password for the chosen auth style. Secret — never set or shown by AI.', undefined, undefined, false),
			field('extractText', 'boolean', 'Extract text', 'Read the readable text out of an HTML response instead of raw HTML.'),
		],
		assistant: {
			role: 'You configure one HTTP request: method, URL, query, headers and body.',
			chips: ['GET this URL', 'POST JSON to…', 'Add a bearer token field', 'Extract page text'],
			rules: ['Never write a real API key or token into headers or body; leave it for the user to fill in.'],
		},
	},
	download: {
		type: 'download',
		title: title('download'),
		group: groupOf('download'),
		purpose: purpose('download'),
		useWhen: 'Use to save a URL to a file on this machine.',
		inputs: [port('url', 'text', 'Overrides the URL field when wired.')],
		outputs: [port('output', 'text', 'The saved file path.')],
		fields: [
			field('url', 'url', 'URL', 'The file to download.'),
			field('fileName', 'text', 'File name', 'Name to save as; empty guesses one from the URL.'),
		],
		assistant: {
			role: 'You set the URL to download and, optionally, the file name to save it as.',
			chips: ['Download this URL', 'Name the file…'],
		},
	},
	net_tool: {
		type: 'net_tool',
		title: title('net_tool'),
		group: groupOf('net_tool'),
		purpose: purpose('net_tool'),
		useWhen: 'Use for a network diagnostic: ping, DNS, whois, port check, subnet math.',
		inputs: [port('target', 'text', 'Overrides the target field when wired.')],
		outputs: [port('output', 'text', 'The tool output.')],
		fields: [
			field('tool', 'enum', 'Tool', 'Which network tool to run.', NET_TOOL_IDS),
			field('target', 'text', 'Target', 'Host, IP, domain or CIDR the tool runs against.'),
			field('option', 'text', 'Option', 'Extra parameter some tools need (count, record type, ports…).'),
		],
		assistant: {
			role: 'You pick the network tool and its target/option.',
			chips: ['Ping this host', 'DNS lookup for…', 'Check if port 443 is open'],
		},
	},
	postgres: {
		type: 'postgres',
		title: title('postgres'),
		group: groupOf('postgres'),
		purpose: purpose('postgres'),
		useWhen: 'Use to run SQL against a Postgres database the user has configured.',
		inputs: [port('input', 'text', 'CSV/TSV to import, when mode is import.')],
		outputs: [port('output', 'text', 'Query result as text/CSV.')],
		fields: [
			field('mode', 'enum', 'Mode', 'Run SQL, or import CSV into a new table.', ['sql', 'import']),
			field('sql', 'sql', 'SQL', 'The statement to run (mode = sql).'),
			field('csv', 'longtext', 'CSV', 'Literal CSV used when nothing is wired into the input (mode = import).'),
			field('sourceUrl', 'url', 'Source URL', 'Fetch this CSV/TSV URL when nothing is wired in (mode = import).'),
		],
		assistant: {
			role: 'You write the SQL statement, or the import mode settings, for this node.',
			chips: ['Select rows where…', 'Create a table from this CSV', 'Count rows grouped by…'],
			rules: ['Never invent a table or column name you were not given.'],
		},
	},
	text_ai: {
		type: 'text_ai',
		title: title('text_ai'),
		group: groupOf('text_ai'),
		purpose: purpose('text_ai'),
		useWhen: 'Use for one common text job (summarize, translate, rewrite, classify…) picked from a fixed list.',
		inputs: [
			port('input', 'text', 'The text (or image/URL) to work on.'),
			port('model', 'text', 'Overrides the model field when wired.'),
			port('system', 'text', 'Overrides the system prompt field when wired.'),
			port('params', 'text', 'JSON overrides for temperature/maxTokens/thinking.'),
		],
		outputs: [port('output', 'text', 'The model’s answer.')],
		fields: [
			field('operation', 'enum', 'Operation', 'The canned job to run.', TEXT_AI_OP_IDS),
			field('option', 'text', 'Option', 'The operation’s one parameter (e.g. target language, max points).'),
			field('instruction', 'longtext', 'Extra instruction', 'Added on top of the operation’s own prompt.'),
			field('promptOverride', 'longtext', 'Prompt override', 'Replaces the generated job prompt entirely, when set.'),
			...llmFields(),
		],
		assistant: {
			role: 'You pick the operation and its option so the result matches what the user asked for, or write a custom instruction for "Custom instruction".',
			chips: ['Summarize in 3 sentences', 'Translate to…', 'Make it friendlier', 'Classify as…'],
		},
	},
	generate_text: {
		type: 'generate_text',
		title: title('generate_text'),
		group: groupOf('generate_text'),
		purpose: purpose('generate_text'),
		useWhen: 'Use for a free-form prompt to a model, optionally about an image; the most general text/vision call.',
		inputs: [
			port('input', 'any', 'Text, an image, or a URL to read.'),
			port('prompt', 'text', 'Overrides the prompt field when wired.'),
			port('model', 'text', 'Overrides the model field when wired.'),
			port('system', 'text', 'Overrides the system prompt field when wired.'),
			port('params', 'text', 'JSON overrides for temperature/maxTokens/thinking.'),
		],
		outputs: [port('output', 'text', 'The model’s reply.')],
		fields: [field('promptText', 'longtext', 'Prompt', 'What to ask the model, used when the prompt port is not wired.'), ...llmFields()],
		assistant: {
			role: 'You write the prompt this node sends to the model.',
			chips: ['Describe the input in detail', 'Write a caption', 'Answer: …'],
		},
	},
	chat: {
		type: 'chat',
		title: title('chat'),
		group: groupOf('chat'),
		purpose: purpose('chat'),
		useWhen: 'Use for one turn of a branching conversation; chain several to build multi-turn chat.',
		inputs: [
			port('parent', 'text', 'The previous turn, continuing the conversation.'),
			port('attach', 'image', 'An image attached to this turn.'),
			port('model', 'text', 'Overrides the model field when wired.'),
			port('system', 'text', 'Overrides the system prompt field when wired.'),
			port('params', 'text', 'JSON overrides for temperature/maxTokens/thinking.'),
		],
		outputs: [port('output', 'text', 'The assistant’s reply for this turn.')],
		fields: [field('userMessage', 'longtext', 'Message', 'What the user says in this turn.'), ...llmFields()],
		assistant: {
			role: 'You write the user message for this turn of the conversation.',
			chips: ['Ask it to…', 'Follow up about…'],
		},
	},
	model_source: {
		type: 'model_source',
		title: title('model_source'),
		group: groupOf('model_source'),
		purpose: purpose('model_source'),
		useWhen: 'Use to pick a model from a custom OpenAI-compatible endpoint (Ollama, OpenRouter, a local server) and output its id.',
		inputs: [],
		outputs: [port('model', 'model', 'The chosen model id, ready to wire into another node’s model port.')],
		fields: [
			field('baseURL', 'url', 'Base URL', 'The OpenAI-compatible /v1 endpoint to fetch models from.'),
			field('model', 'text', 'Model', 'The model id to output, chosen from the fetched list.'),
			field('filter', 'text', 'Filter', 'Only show fetched models whose id contains this text.'),
			field('kind', 'enum', 'For', 'What the chosen model is used for (informational only).', ['chat', 'image']),
			field('keyRef', 'text', 'Key', 'API key for the endpoint. Secret — never set or shown by AI.', undefined, undefined, false),
		],
		assistant: {
			role: 'You set the base URL and filter to find the right model for the user’s goal. You cannot fetch models yourself; say what to click.',
			chips: ['Use Ollama on this machine', 'Use OpenRouter', 'Filter to vision models'],
		},
	},
	summarize: {
		type: 'summarize',
		title: title('summarize'),
		group: groupOf('summarize'),
		purpose: purpose('summarize'),
		useWhen: 'Use for a dedicated summary of text, a URL, an image or a video, with length/format/language controls.',
		inputs: [port('input', 'any', 'Text, a URL, an image or a video to summarize.')],
		outputs: [port('output', 'text', 'The summary.')],
		fields: [
			field('length', 'enum', 'Length', 'How long the summary should be.', ['short', 'medium', 'long']),
			field('format', 'enum', 'Format', 'Shape of the summary.', ['bullets', 'paragraph', 'tldr', 'outline']),
			field('language', 'text', 'Language', 'Output language; empty keeps the input’s language.'),
			field('focus', 'text', 'Focus', 'What to pay special attention to.'),
			...llmFields(),
		],
		assistant: {
			role: 'You set length, format, language and focus for this summary.',
			chips: ['Short bullet summary', 'One paragraph TL;DR', 'Focus on…'],
		},
	},
	jev: {
		type: 'jev',
		title: title('jev'),
		group: groupOf('jev'),
		purpose: purpose('jev'),
		useWhen: 'Use to turn free-form input into a yes/no, a choice among options, or a score, with probabilities.',
		inputs: [port('context', 'text', 'Background text the question is about.'), port('question', 'text', 'Overrides the question field when wired.'), port('input', 'any', 'Alternate input, e.g. an image to judge.')],
		outputs: [
			port('output', 'text', 'The chosen answer (label or score).'),
			port('probs', 'text', 'Probabilities per option, as JSON.'),
			port('final', 'text', 'Only emits on the winning branch (yes/no kind); use to gate downstream nodes.'),
		],
		fields: [
			field('kind', 'enum', 'Kind', 'Yes/no, multiple choice, or a score.', JEV_KIND_IDS),
			field('question', 'longtext', 'Question', 'The question to decide.'),
			field('options', 'longtext', 'Options', 'One option per line (choice), or one level per line, worst first (score).'),
			field('filter', 'boolean', 'Pre-filter', 'Run an extra filter pass (filterInstruction/filterModel) before deciding.'),
		],
		assistant: {
			role: 'You write the question and, for choice/score, the options/levels, so the decision matches the user’s goal.',
			chips: ['Is this about cats? (yes/no)', 'Pick a category…', 'Score the sentiment 1-5'],
		},
	},
	load_image: {
		type: 'load_image',
		title: title('load_image'),
		group: groupOf('load_image'),
		purpose: purpose('load_image'),
		useWhen: 'Use to bring an image onto the canvas from a URL, a paste, or a drag-and-drop.',
		inputs: [],
		outputs: [port('output', 'image', 'The loaded image.')],
		fields: [
			field('imageUrl', 'url', 'Image URL', 'The image to load (URL or data URL).'),
			field('source', 'text', 'Source', 'How the image arrived (upload, url, paste, drop); informational.'),
		],
		assistant: {
			role: 'You set the image URL for this node.',
			chips: ['Load this image URL'],
		},
	},
	camera: {
		type: 'camera',
		title: title('camera'),
		group: groupOf('camera'),
		purpose: purpose('camera'),
		useWhen: 'Use to capture a photo from the webcam at run time; no fields to set.',
		inputs: [],
		outputs: [port('output', 'image', 'The captured photo.')],
		fields: [],
		assistant: {
			role: 'This node has no fields the AI can set; say so and suggest what to wire it into.',
			chips: [],
		},
	},
	capture: {
		type: 'capture',
		title: title('capture'),
		group: groupOf('capture'),
		purpose: purpose('capture'),
		useWhen: 'Use for a drawable area the user sketches on, captured as an image; no fields to set.',
		inputs: [],
		outputs: [port('output', 'image', 'A snapshot of what was drawn.')],
		fields: [],
		assistant: {
			role: 'This node has no fields the AI can set; say so and suggest what to wire it into.',
			chips: [],
		},
	},
	crop: {
		type: 'crop',
		title: title('crop'),
		group: groupOf('crop'),
		purpose: purpose('crop'),
		useWhen: 'Use to crop an image to an aspect ratio, or a custom box in percent.',
		inputs: [port('image', 'image', 'The image to crop.')],
		outputs: [port('output', 'image', 'The cropped image.')],
		fields: [
			field('aspect', 'enum', 'Shape', 'Aspect ratio, or Custom for a manual box.', ['Custom', '1:1', '4:3', '3:2', '16:9', '9:16', '3:4']),
			field('x', 'number', 'X %', 'Left edge of the custom box, in percent (Custom only).'),
			field('y', 'number', 'Y %', 'Top edge of the custom box, in percent (Custom only).'),
			field('w', 'number', 'W %', 'Width of the custom box, in percent (Custom only).'),
			field('h', 'number', 'H %', 'Height of the custom box, in percent (Custom only).'),
		],
		assistant: {
			role: 'You pick the aspect ratio, or the custom box percentages.',
			chips: ['Crop to square', 'Crop to 16:9', 'Crop the top-left quarter'],
		},
	},
	image_resize: {
		type: 'image_resize',
		title: title('image_resize'),
		group: groupOf('image_resize'),
		purpose: purpose('image_resize'),
		useWhen: 'Use to resize an image by a percent scale, a target width/height (keeping ratio), or exact dimensions.',
		inputs: [port('image', 'image', 'The image to resize.')],
		outputs: [port('output', 'image', 'The resized image.')],
		fields: [
			field('mode', 'enum', 'Mode', 'How value/value2 are interpreted.', ['fit', 'exact', 'scale', 'width', 'height']),
			field('value', 'number', 'Value', 'Width (fit/exact), scale % (scale), width px (width), or height px (height).'),
			field('value2', 'number', 'Value 2', 'Height, used by fit and exact.'),
		],
		assistant: {
			role: 'You pick the resize mode and its value(s).',
			chips: ['Resize to 1024px wide', 'Scale to 50%', 'Fit inside 800x600'],
		},
	},
	image_filter: {
		type: 'image_filter',
		title: title('image_filter'),
		group: groupOf('image_filter'),
		purpose: purpose('image_filter'),
		useWhen: 'Use to tweak brightness/contrast/colour, or apply a film-look preset, to one image.',
		inputs: [port('image', 'image', 'The image to filter.')],
		outputs: [port('output', 'image', 'The filtered image.')],
		fields: [
			field('preset', 'enum', 'Preset', 'A ready-made look; sets several sliders at once.', FILTER_PRESET_NAMES),
			field('brightness', 'number', 'Brightness', 'Percent, 100 = unchanged.'),
			field('contrast', 'number', 'Contrast', 'Percent, 100 = unchanged.'),
			field('saturate', 'number', 'Saturation', 'Percent, 100 = unchanged.'),
			field('hue', 'number', 'Hue', 'Degrees of hue rotation.'),
			field('grayscale', 'number', 'Grayscale', 'Percent, 0 = colour, 100 = fully grey.'),
			field('sepia', 'number', 'Sepia', 'Percent sepia tone.'),
			field('invert', 'number', 'Invert', 'Percent colour inversion.'),
			field('blur', 'number', 'Blur', 'Blur radius in pixels.'),
			field('rotate', 'number', 'Rotate', 'Degrees to rotate the image.'),
			field('flipX', 'boolean', 'Flip horizontal', 'Mirror left-right.'),
			field('flipY', 'boolean', 'Flip vertical', 'Mirror top-bottom.'),
		],
		assistant: {
			role: 'You pick a preset, or set individual sliders, to get the look the user asked for.',
			chips: ['Black & white', 'Warm film look', 'More contrast'],
		},
	},
	image_tool: {
		type: 'image_tool',
		title: title('image_tool'),
		group: groupOf('image_tool'),
		purpose: purpose('image_tool'),
		useWhen: 'Use for a single-image utility: info, format conversion, pixelate, border, round corners, watermark, pad to square, data URL, film look.',
		inputs: [port('image', 'image', 'The image to process.')],
		outputs: [port('output', 'image', 'The processed image (most tools); text tools write to the card instead.')],
		fields: [
			field('tool', 'enum', 'Tool', 'Which image tool to run.', IMAGE_TOOL_IDS),
			field('a', 'text', 'Param A', 'First parameter the chosen tool needs.'),
			field('b', 'text', 'Param B', 'Second parameter the chosen tool needs.'),
		],
		assistant: {
			role: 'You pick the tool and its parameters.',
			chips: ['Pixelate it', 'Add a white border', 'Round the corners', 'Convert to webp'],
		},
	},
	adjust: {
		type: 'adjust',
		title: title('adjust'),
		group: groupOf('adjust'),
		purpose: purpose('adjust'),
		useWhen: 'Legacy node; prefer Filter for new work. Use only if the canvas already has one.',
		inputs: [port('image', 'image', 'The image to adjust.')],
		outputs: [port('output', 'image', 'The adjusted image.')],
		fields: [
			field('brightness', 'number', 'Brightness', 'Slider, -50..50.'),
			field('contrast', 'number', 'Contrast', 'Slider, -50..50.'),
			field('saturation', 'number', 'Saturation', 'Slider, -50..50.'),
		],
		assistant: {
			role: 'You set brightness/contrast/saturation. Prefer suggesting the Filter node instead for new work.',
			chips: ['More contrast', 'Less saturated'],
		},
		hidden: true,
	},
	image_gen: {
		type: 'image_gen',
		title: title('image_gen'),
		group: groupOf('image_gen'),
		purpose: purpose('image_gen'),
		useWhen: 'Use to generate new images from a text prompt with an image model (Google, OpenAI, OpenRouter, or a custom URL).',
		inputs: [
			port('prompt', 'text', 'Overrides the prompt field when wired.'),
			port('image', 'image', 'A reference image for image-to-image.'),
			port('model', 'text', 'Overrides the model field when wired.'),
			port('system', 'text', 'Overrides the system prompt field when wired.'),
			port('params', 'text', 'JSON overrides for temperature/maxTokens/thinking.'),
		],
		outputs: [port('output', 'image', 'The first generated image.'), port('images', 'text', 'All generated image URLs, as JSON.')],
		fields: [
			field('prompt', 'longtext', 'Prompt', 'What to generate.'),
			field('n', 'number', 'Count', 'How many images to generate (1, 2 or 4).'),
			field('size', 'enum', 'Size', 'Output image size.', ['1024x1024', '1536x1024', '1024x1536', 'auto']),
			field('negative', 'text', 'Negative prompt', 'What to avoid showing.'),
			field('seed', 'number', 'Seed', 'Fixed seed for reproducible results; empty is random.'),
			field('model', 'model', 'Model', 'The image model to call.'),
		],
		assistant: {
			role: 'You write the prompt (and negative prompt, size, count) for the image this node should generate.',
			chips: ['A photo of…', 'An illustration of…, square', 'Generate 4 variations'],
		},
	},
	number: {
		type: 'number',
		title: title('number'),
		group: groupOf('number'),
		purpose: purpose('number'),
		useWhen: 'Legacy constant-number node; prefer Prompt or a DataPipe value for new work.',
		inputs: [],
		outputs: [port('output', 'number', 'The number.')],
		fields: [field('value', 'number', 'Value', 'The constant number.')],
		assistant: {
			role: 'You set the constant value.',
			chips: ['Set to…'],
		},
		hidden: true,
	},
	random: {
		type: 'random',
		title: title('random'),
		group: groupOf('random'),
		purpose: purpose('random'),
		useWhen: 'Use to pick a random number, or a random item from a list.',
		inputs: [port('list', 'text', 'Overrides the list field when wired.'), port('a', 'text', 'Overrides the low bound (number mode).'), port('b', 'text', 'Overrides the high bound (number mode).')],
		outputs: [port('output', 'text', 'The random result.')],
		fields: [
			field('mode', 'enum', 'Mode', 'What to randomize.', ['number', 'pick', 'shuffle']),
			field('a', 'text', 'Low / n/a', 'Low bound for number mode.'),
			field('b', 'text', 'High / n/a', 'High bound for number mode.'),
			field('list', 'longtext', 'List', 'One item per line, for pick/shuffle mode.'),
		],
		assistant: {
			role: 'You set the mode and its parameters (range, or list).',
			chips: ['Random number 1-100', 'Pick one of…', 'Shuffle this list'],
		},
	},
	if: {
		type: 'if',
		title: title('if'),
		group: groupOf('if'),
		purpose: purpose('if'),
		useWhen: 'Use to route a value down one of two branches based on a condition.',
		inputs: [port('input', 'any', 'The value to test and pass through.'), port('test', 'text', 'Overrides the operand field when wired.')],
		outputs: [port('then', 'any', 'Emits the input when the condition is true.'), port('else', 'any', 'Emits the input when the condition is false.')],
		fields: [
			field('condition', 'enum', 'Condition', 'How the input is compared to the operand.', ['truthy', 'empty', 'equals', 'not_equals', 'contains', 'starts', 'ends', 'regex', 'gt', 'gte', 'lt', 'lte', 'is_image', 'is_json']),
			field('operand', 'text', 'Operand', 'The value to compare the input against.'),
		],
		assistant: {
			role: 'You pick the condition and operand for this branch.',
			chips: ['If it contains…', 'If it equals…', 'If empty'],
		},
	},
	logic: {
		type: 'logic',
		title: title('logic'),
		group: groupOf('logic'),
		purpose: purpose('logic'),
		useWhen: 'Use to combine two boolean inputs (or negate one) with and/or/not/xor/nand.',
		inputs: [port('a', 'any', 'First boolean-ish input.'), port('b', 'any', 'Second input; unused for not.')],
		outputs: [port('output', 'text', 'true or false.')],
		fields: [field('op', 'enum', 'Operator', 'The boolean operator.', ['and', 'or', 'not', 'xor', 'nand'])],
		assistant: {
			role: 'You pick the boolean operator.',
			chips: ['AND', 'OR', 'NOT'],
		},
	},
	for_each: {
		type: 'for_each',
		title: title('for_each'),
		group: groupOf('for_each'),
		purpose: purpose('for_each'),
		useWhen: 'Use to run the rest of the graph once per item in a list, then collect the results.',
		inputs: [port('list', 'text', 'The list to iterate; split by the separator.'), port('result', 'any', 'Wire the per-item result back in here.')],
		outputs: [port('item', 'text', 'The current item.'), port('output', 'text', 'All collected results, joined.')],
		fields: [
			field('split', 'enum', 'Split by', 'How the list field is split into items.', ['lines', 'separator', 'json', 'regex']),
			field('separator', 'text', 'Separator', 'Custom split separator.'),
			field('joiner', 'text', 'Join with', 'How collected results are joined back together.'),
		],
		assistant: {
			role: 'You set how the list is split and the results re-joined.',
			chips: ['One per line', 'Comma separated', 'Join results with…'],
		},
	},
	router: {
		type: 'router',
		title: title('router'),
		group: groupOf('router'),
		purpose: purpose('router'),
		useWhen: 'Legacy node: sends one input to one of several numbered outputs.',
		inputs: [port('input', 'any', 'The value to route.')],
		outputs: [port('out_0', 'any', 'Output slot 0.'), port('out_1', 'any', 'Output slot 1.'), port('out_2', 'any', 'Output slot 2.')],
		fields: [field('outputCount', 'number', 'Outputs', 'How many output slots this node has.')],
		assistant: {
			role: 'You set how many output slots this router has.',
			chips: ['3 outputs'],
		},
		hidden: true,
	},
	code: {
		type: 'code',
		title: title('code'),
		group: groupOf('code'),
		purpose: purpose('code'),
		useWhen: 'Use when no other node does the transform: a small custom function with your own inputs/outputs.',
		inputs: [port('a', 'any', 'Input 1.'), port('b', 'any', 'Input 2.'), port('c', 'any', 'Input 3.'), port('d', 'any', 'Input 4.')],
		outputs: [port('output', 'any', 'Output 1.'), port('out2', 'any', 'Output 2.'), port('out3', 'any', 'Output 3.')],
		fields: [
			field('lang', 'enum', 'Language', 'The language this code runs in.', ['ts', 'js', 'py']),
			field('code', 'code', 'Code', 'The function body: read the named inputs, return the named outputs.'),
			field('inputCount', 'number', 'Input count', 'How many input ports this node has (1-4).'),
			field('outputCount', 'number', 'Output count', 'How many output ports this node has (1-3).'),
			// wire: false — the card stores these as a `string[]` (one name per port), not the
			// comma-separated string this spec describes for the AI; wiring a plain text value in
			// would corrupt that array. Revisit if/when the AI-facing shape and the stored shape
			// are unified.
			field('inputNames', 'text', 'Input names', 'Comma-separated names for the input ports, read as arguments in code.', undefined, undefined, false),
			field('outputNames', 'text', 'Output names', 'Comma-separated names for the output ports, returned from code.', undefined, undefined, false),
		],
		assistant: {
			role: 'You write the code for this node: a small TypeScript/JavaScript/Python function matching the input/output count.',
			chips: ['Parse this JSON and pick a field', 'Compute…', 'Combine the two inputs'],
			rules: ['The code must only use its declared inputs and return its declared outputs; no network or file access.'],
		},
	},
	subgraph: {
		type: 'subgraph',
		title: title('subgraph'),
		group: groupOf('subgraph'),
		purpose: purpose('subgraph'),
		useWhen: 'Not addable directly: created by packing a group of nodes into a box. The AI should never add one.',
		inputs: [],
		outputs: [],
		// wire: false — the box title is only read for display (the heading rename control
		// edits it directly); execute()/getOutputInfo() never read it, so a wired override
		// would have no visible effect.
		fields: [field('title', 'text', 'Title', 'Label shown on the box.', undefined, undefined, false)],
		assistant: {
			role: 'This node is a packed group; its contents are the nodes it wraps, not fields to fill here.',
			chips: [],
		},
		hidden: true,
	},
	output: {
		type: 'output',
		title: title('output'),
		group: groupOf('output'),
		purpose: purpose('output'),
		useWhen: 'Use as the last node of a chain, to show the result (text, image, Markdown, Mermaid, JSON, or a link).',
		inputs: [port('input', 'any', 'Whatever reaches this node is shown.')],
		outputs: [port('output', 'any', 'Passes the input straight through.')],
		fields: [field('kind', 'enum', 'Show as', 'How to render the input.', ['auto', 'text', 'markdown', 'mermaid', 'image', 'url', 'json'])],
		assistant: {
			role: 'You pick how the incoming value should be rendered.',
			chips: ['Show as Markdown', 'Show as an image', 'Auto-detect'],
		},
	},
	save: {
		type: 'save',
		title: title('save'),
		group: groupOf('save'),
		purpose: purpose('save'),
		useWhen: 'Use to write text or an image reaching this node to a file on this machine.',
		inputs: [port('input', 'any', 'The value to save.')],
		outputs: [port('output', 'text', 'The saved file path.')],
		fields: [field('fileName', 'text', 'File name', 'Name to save as.')],
		assistant: {
			role: 'You set the file name to save as.',
			chips: ['Save as result.txt', 'Save as output.png'],
		},
	},
	table: {
		type: 'table',
		title: title('table'),
		group: groupOf('table'),
		purpose: purpose('table'),
		useWhen: 'Use for one table step: filter, sort, add a column, join, summarise, etc. Chain several DataPipe nodes for a multi-step pipeline (one operation per node).',
		inputs: [port('data', 'text', 'The input table (CSV/TSV).'), port('extra', 'text', 'A second table, used by append/lookup/newcol.')],
		outputs: [port('output', 'text', 'The transformed table (CSV/TSV).')],
		fields: [
			field('text', 'longtext', 'Table text', 'Literal input table (CSV/TSV), used when the data port is not wired.'),
			field('format', 'enum', 'Format', 'Input/output delimiter; auto detects tab vs comma.', ['auto', 'csv', 'tsv']),
			field('op', 'enum', 'Operation', 'Which single table operation this step runs. See the operation list below for each op’s own parameters.', TABLE_OP_IDS),
			field('columns', 'text', 'Columns', 'Comma-separated column names (op-dependent).'),
			field('column', 'text', 'Column', 'A single column name, or a comma list of group/row columns (op-dependent).'),
			field('as', 'text', 'As', 'Condition/order/convert-to/fill-with/join-kind/summary value (op-dependent enum; see the operation list).'),
			field('expr', 'text', 'Formula', 'A small formula, e.g. upper(name) or round(score * 1.2, 1) (formula/newcol ops).'),
			field('sep', 'text', 'Separator', 'Separator used by split/concat (op-dependent).'),
			field('pattern', 'text', 'Pattern', 'A regular expression, or a JSON mapping array (regexp/replace/case ops).'),
			field('with', 'text', 'Value', 'A literal value, count, bucket size/edges, or second/group key (op-dependent).'),
			field('name', 'text', 'New name', 'Name for a new or renamed column (op-dependent).'),
			field('columns2', 'text', 'Columns 2', 'A second comma list of column names (unpivot’s value columns).'),
			field('totals', 'boolean', 'Add totals', 'Pivot only: add a totals row and column.'),
		],
		assistant: {
			role: 'You configure one DataPipe step: choose the operation and fill only the parameters that operation needs. Read the operation list for exactly which of columns/column/as/expr/sep/pattern/with/name apply, and what values "as" accepts for that op.',
			chips: ['Keep rows where…', 'Total per group', 'Sort by…', 'Clean up numbers'],
			rules: [
				'Set only the fields the chosen operation actually uses; leave the rest untouched.',
				'Only use column names that exist in the input, when known.',
				'If the user asks for several steps, say so in `needs` (another DataPipe node) rather than cramming multiple operations into one.',
			],
		},
	},
	chart: {
		type: 'chart',
		title: title('chart'),
		group: groupOf('chart'),
		purpose: purpose('chart'),
		useWhen: 'Use to draw a chart (bar, line, area, scatter, pie, histogram, heatmap, …) from a table; usually the last step after a DataPipe.',
		inputs: [port('data', 'text', 'The table to chart (CSV/TSV).')],
		outputs: [port('output', 'image', 'A PNG of the chart.')],
		fields: [
			field('text', 'longtext', 'Table text', 'Literal input table (CSV/TSV), used when the data port is not wired.'),
			field('kind', 'enum', 'Kind', 'Chart type.', CHART_KIND_IDS),
			field('xCol', 'text', 'X column', 'Column used for the category/x axis.'),
			field('yCol', 'text', 'Y column(s)', 'Comma-separated column(s) to plot; one series per column.'),
			field('series', 'text', 'Split by', 'Split into one series per distinct value of this column ("long" data).'),
			field('aggregate', 'enum', 'Summary', 'Combine rows sharing the same x (and split) before drawing.', ['none', 'sum', 'avg', 'count', 'min', 'max']),
			field('stack', 'boolean', 'Stack', 'Stack bar/area series on top of each other.'),
			field('dualScale', 'boolean', 'Dual axis', 'With 2+ series, plot the first on the left axis and the rest on the right.'),
			field('sort', 'enum', 'Sort', 'Order categories by x, or by value.', ['none', 'x', 'value-asc', 'value-desc']),
			field('top', 'number', 'Top N', 'Keep only the top N categories by value (0 = all).'),
			field('otherRow', 'boolean', 'Other', 'Sum whatever Top N drops into a trailing "Other" category, instead of dropping it.'),
			field('bins', 'number', 'Bins', 'Histogram bucket count.'),
			field('title', 'text', 'Title', 'Chart title.'),
			field('xLabel', 'text', 'X label', 'X axis label.'),
			field('yLabel', 'text', 'Y label', 'Y axis label.'),
			field('labels', 'boolean', 'Data labels', 'Show a value label on each mark.'),
			field('smooth', 'boolean', 'Smooth', 'Smooth the line/area curve.'),
		],
		assistant: {
			role: 'You pick the chart kind and x/y columns from the input table’s headers.',
			chips: ['Bar chart of…', 'Line chart over time', 'Pie chart of…', 'Histogram of…', 'Scatter of… vs …'],
			rules: ['Only use column names that exist in the input, when known.'],
		},
	},
	profile: {
		type: 'profile',
		title: title('profile'),
		group: groupOf('profile'),
		purpose: purpose('profile'),
		useWhen: 'Use to see what is in a table before working on it: column types, fill rate, distinct values, min/max/mean and a histogram.',
		inputs: [port('data', 'text', 'The table to profile (CSV/TSV).')],
		outputs: [port('output', 'text', 'One row per column: type, filled %, empty count, distinct count, min/max, mean, top values.')],
		fields: [
			field('text', 'longtext', 'Table text', 'Literal input table (CSV/TSV), used when the data port is not wired.'),
			field('format', 'enum', 'Format', 'Input delimiter; auto detects tab vs comma.', ['auto', 'csv', 'tsv']),
		],
		assistant: {
			role: 'This node has nothing to configure beyond the input table; suggest it to inspect data before other DataPipe steps.',
			chips: ['What is in this table?', 'Show column types and histograms'],
		},
	},
	database: {
		type: 'database',
		title: title('database'),
		group: groupOf('database'),
		purpose: purpose('database'),
		useWhen: 'Use to query an uploaded SQLite/.db file.',
		inputs: [port('sql', 'text', 'Overrides the sql field when wired.')],
		outputs: [port('output', 'text', 'Query result as CSV.'), port('schema', 'text', 'The database’s table/column schema, as JSON.')],
		fields: [field('sql', 'sql', 'SQL', 'The query to run against the uploaded database.')],
		assistant: {
			role: 'You write the SQL query, using only the tables/columns given in the context (never invent names).',
			chips: ['Select all from…', 'Count rows in…', 'Join … and …'],
			rules: ['Only reference tables and columns that appear in the database’s own schema context.'],
		},
	},
	openrouter: {
		type: 'openrouter',
		title: title('openrouter'),
		group: groupOf('openrouter'),
		purpose: purpose('openrouter'),
		useWhen: 'Use to pick a free OpenRouter model id to wire into another node’s model port.',
		inputs: [],
		outputs: [port('output', 'text', 'The chosen model id.')],
		fields: [field('model', 'model', 'Model', 'The free OpenRouter model id to use.')],
		assistant: {
			role: 'You cannot browse OpenRouter’s live list yourself; tell the user which free model to pick, or leave it for them.',
			chips: [],
		},
	},
	raw_model: {
		type: 'raw_model',
		title: title('raw_model'),
		group: groupOf('raw_model'),
		purpose: purpose('raw_model'),
		useWhen: 'Use for full manual control of a model call: custom endpoint, model id, system prompt, temperature, thinking.',
		inputs: [port('prompt', 'text', 'The prompt to send.'), port('model', 'text', 'Overrides the model field when wired.')],
		outputs: [port('output', 'text', 'The model’s reply.')],
		fields: [
			field('url', 'url', 'Endpoint', 'OpenAI-compatible chat completions URL.'),
			field('model', 'model', 'Model', 'The model id to call.'),
			field('system', 'longtext', 'System prompt', 'Sent before the user prompt.'),
			field('temperature', 'text', 'Temperature', 'Empty uses the model’s default.'),
			field('thinking', 'enum', 'Thinking', 'Reasoning effort.', ['', 'none', 'low', 'medium', 'high']),
			field('maxTokens', 'text', 'Max tokens', 'Output token limit; empty uses the model’s default.'),
			field('keyRef', 'text', 'Key', 'API key for the endpoint. Secret — never set or shown by AI.', undefined, undefined, false),
		],
		assistant: {
			role: 'You set the endpoint, model and call settings; never write a real API key.',
			chips: ['Use a local Ollama endpoint', 'Set system prompt to…', 'High reasoning effort'],
		},
	},
	video: {
		type: 'video',
		title: title('video'),
		group: groupOf('video'),
		purpose: purpose('video'),
		useWhen: 'Use to play a video or YouTube link on the card.',
		inputs: [port('url', 'text', 'Overrides the url field when wired.')],
		outputs: [port('output', 'text', 'Passes the URL through.')],
		fields: [field('url', 'url', 'URL', 'Video or YouTube link.'), field('autoplay', 'boolean', 'Autoplay', 'Start playing automatically.')],
		assistant: {
			role: 'You set the video URL.',
			chips: ['Play this video'],
		},
	},
	file_in: {
		type: 'file_in',
		title: title('file_in'),
		group: groupOf('file_in'),
		purpose: purpose('file_in'),
		useWhen: 'Use to bring a file (uploaded) or a URL into the pipeline as text, an image, a spreadsheet-as-CSV, or a hash.',
		inputs: [port('url', 'text', 'Overrides the url field when the source is URL.')],
		outputs: [port('output', 'any', 'The file’s content (text, image, CSV, or hash), depending on action.')],
		fields: [
			field('source', 'enum', 'Source', 'Upload a file, or read a URL.', ['upload', 'url']),
			field('url', 'url', 'URL', 'The file/page to read (source = url).'),
			field('action', 'enum', 'Output', 'Output the content as text, or its SHA-256 hash.', ['text', 'sha256']),
			field('asText', 'boolean', 'As text', 'Read a spreadsheet as CSV text instead of leaving it as a binary file.'),
		],
		assistant: {
			role: 'You set the source and output mode. You cannot upload a file yourself; put "the user needs to upload a file here" in notes when a file is needed and none is attached.',
			chips: ['Read from a URL', 'Output the file’s hash'],
		},
	},
	url_in: {
		type: 'url_in',
		title: title('url_in'),
		group: groupOf('url_in'),
		purpose: purpose('url_in'),
		useWhen: 'Replaced by "Read from"; never add this type, only old canvases may still have one.',
		inputs: [],
		outputs: [port('output', 'text', 'The URL, or fetched page text.')],
		fields: [field('url', 'url', 'URL', 'The address.'), field('fetchBody', 'boolean', 'Fetch page text', 'Fetch the page and output its readable text instead of the address.')],
		assistant: {
			role: 'This node type is replaced by "Read from"; suggest that instead of changing this one, unless it is already on the canvas.',
			chips: [],
		},
		hidden: true,
	},
	sleep: {
		type: 'sleep',
		title: title('sleep'),
		group: groupOf('sleep'),
		purpose: purpose('sleep'),
		useWhen: 'Use to pause the pipeline for a fixed time before passing its input on.',
		inputs: [port('input', 'any', 'Passed through after the delay.')],
		outputs: [port('output', 'any', 'The same value, delayed.')],
		fields: [field('ms', 'number', 'Milliseconds', 'How long to wait.')],
		assistant: {
			role: 'You set the delay in milliseconds.',
			chips: ['Wait 1 second', 'Wait 500ms'],
		},
	},
}

/** Whether every NODE_PORTS type has a spec (used by the coverage test). */
export function hasSpecForEveryPort(): boolean {
	return Object.keys(NODE_PORTS).every((type) => !!NODE_SPECS[type])
}

function clamp(text: string, max = 400): string {
	return text.length > max ? text.slice(0, max - 1) + '…' : text
}

function fieldLine(f: FieldSpec): string {
	const options = f.options?.length ? ` {${clamp(f.options.join(', '), 160)}}` : ''
	return `    - ${f.key} (${f.kind}): ${f.description}${options}`
}

function portLine(p: PortSpec): string {
	return `${p.id}:${p.dataType}`
}

/** One node's full spec as compact text, for a prompt. */
export function nodeSpecText(type: string): string {
	const spec = NODE_SPECS[type]
	if (!spec) return ''
	const lines = [
		`### ${type} — ${spec.title}`,
		spec.purpose,
		`Use when: ${spec.useWhen}`,
		`Inputs: ${spec.inputs.length ? spec.inputs.map(portLine).join(', ') : 'none'}`,
		`Outputs: ${spec.outputs.length ? spec.outputs.map(portLine).join(', ') : 'none'}`,
		'Fields:',
		...(spec.fields.length ? spec.fields.map(fieldLine) : ['    none']),
	]
	if (type === 'table') {
		lines.push('Operations (op) and their own parameters:')
		for (const op of TABLE_OPS) {
			if (op.hidden) continue
			const params = op.params.map((p) => p.field + (p.options ? `=[${p.options.map((o) => o.value).join('|')}]` : '')).join(', ')
			lines.push(`    - ${op.id}: ${op.description}${params ? ` (${params})` : ''}`)
		}
	}
	return lines.join('\n')
}

/**
 * Compact text covering the given types (default: all), for the "Build with AI"
 * and node-specialist prompts. Kept under the budget by trimming field option lists.
 */
export function specPrompt(types?: string[]): string {
	const list = (types && types.length ? types : Object.keys(NODE_SPECS)).filter((type) => NODE_SPECS[type])
	return list.map(nodeSpecText).join('\n\n')
}

export { opSpec }
