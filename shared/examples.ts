/** Small example workflows, plus one longer desk. Every node type appears at least once. */

export interface ExampleNode {
	id: string
	type: string
	x: number
	y: number
	props?: Record<string, unknown>
}

export interface ExampleWire {
	from: string
	fromPort: string
	to: string
	toPort: string
}

export interface CanvasExample {
	id: string
	title: string
	blurb: string
	nodes: ExampleNode[]
	wires: ExampleWire[]
}

const WORD_COUNT = `export default async function run({ a }: Record<string, string>) {
  const words = (a ?? '').split(/\\s+/).filter(Boolean)
  return String(words.length)
}
`

function step(id: string, title: string, blurb: string, nodes: ExampleNode[], wires: ExampleWire[] = []): CanvasExample {
	return { id, title, blurb, nodes, wires }
}

export const EXAMPLES: CanvasExample[] = [
	step('text-join', 'Join two texts', 'Two prompts go into Concat. Concat is a text node.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'Local-first software' } },
		{ id: 'b', type: 'prompt', x: 0, y: 220, props: { text: 'keeps your data on this machine.' } },
		{ id: 'c', type: 'prompt_concat', x: 460, y: 80, props: { separator: ' ' } },
	], [
		{ from: 'a', fromPort: 'output', to: 'c', toPort: 'prefix' },
		{ from: 'b', fromPort: 'output', to: 'c', toPort: 'main' },
	]),
	step('text-clean', 'Clean text', 'A prompt feeds the Trim text tool.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: '  hello   world  ' } },
		{ id: 'b', type: 'text_tool', x: 460, y: 0, props: { op: 'trim' } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	step('llm-draft', 'Draft with a model', 'A prompt feeds Generate text. The card shows tokens, time and tok/s.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'Write two sentences about a paper notebook.' } },
		{ id: 'b', type: 'generate_text', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'prompt' }]),
	step('llm-chat', 'Chat message', 'A prompt is the first message in a chat node.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'Say hello in one short sentence.' } },
		{ id: 'b', type: 'chat', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'parent' }]),
	step('llm-task', 'AI text job', 'AI text summarizes whatever the prompt sends.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'Canvas nodes, wires, and a local model.' } },
		{ id: 'b', type: 'text_ai', x: 460, y: 0, props: { operation: 'summarize' } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	step('llm-sum', 'Summarize', 'Summarize reads the prompt and writes a short note.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'A small app for drawing and running node workflows offline.' } },
		{ id: 'b', type: 'summarize', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	step('llm-jev', 'JEV decision', 'A question about the prompt. JEV returns yes, no, or a score.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'The note is kind and short.' } },
		{ id: 'b', type: 'jev', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'context' }]),
	step('image-look', 'Filter look', 'Load an image, then apply the JP 90s look. Restore default on the filter to clear it.', [
		{ id: 'a', type: 'load_image', x: 0, y: 0, props: { imageUrl: '/examples/girl-base.jpg', source: '' } },
		{ id: 'b', type: 'image_filter', x: 460, y: 0, props: { contrast: 118, saturate: 78, sepia: 22, brightness: 108, hue: 8 } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'image' }]),
	step('image-frame', 'Crop and resize', 'One photo, then resize, then crop.', [
		{ id: 'a', type: 'load_image', x: 0, y: 0, props: { imageUrl: '/examples/girl-base.jpg' } },
		{ id: 'b', type: 'image_resize', x: 460, y: 0 },
		{ id: 'c', type: 'crop', x: 920, y: 0 },
	], [
		{ from: 'a', fromPort: 'output', to: 'b', toPort: 'image' },
		{ from: 'b', fromPort: 'output', to: 'c', toPort: 'image' },
	]),
	step('image-tools', 'Image tools and adjust', 'Info, then a small adjust. The Look tool is in the Image tools list.', [
		{ id: 'a', type: 'load_image', x: 0, y: 0, props: { imageUrl: '/examples/girl-base.jpg' } },
		{ id: 'b', type: 'image_tool', x: 460, y: 0, props: { tool: 'info' } },
		{ id: 'c', type: 'adjust', x: 920, y: 0 },
	], [
		{ from: 'a', fromPort: 'output', to: 'b', toPort: 'image' },
		{ from: 'a', fromPort: 'output', to: 'c', toPort: 'image' },
	]),
	step('image-live', 'Camera and capture', 'Camera takes a photo. Capture reads an area of the canvas.', [
		{ id: 'a', type: 'camera', x: 0, y: 0 },
		{ id: 'b', type: 'capture', x: 460, y: 0 },
		{ id: 'c', type: 'image_filter', x: 920, y: 0 },
	], [{ from: 'b', fromPort: 'output', to: 'c', toPort: 'image' }]),
	step(
		'wardrobe',
		'Same girl, three outfits',
		'One person in a coat, a dress, and 1990s street clothes. Use Paste, a URL, or a file path on Load image to replace any photo. The filter repeats the JP 90s look on the plain photo.',
		[
			{ id: 'base', type: 'load_image', x: 0, y: 0, props: { imageUrl: '/examples/girl-base.jpg', source: '' } },
			{ id: 'coat', type: 'load_image', x: 420, y: 0, props: { imageUrl: '/examples/girl-coat.jpg' } },
			{ id: 'dress', type: 'load_image', x: 840, y: 0, props: { imageUrl: '/examples/girl-dress.jpg' } },
			{ id: 'street', type: 'load_image', x: 1260, y: 0, props: { imageUrl: '/examples/girl-90s.jpg' } },
			{ id: 'look', type: 'image_filter', x: 0, y: 420, props: { contrast: 118, saturate: 78, sepia: 22, brightness: 108, hue: 8 } },
		],
		[{ from: 'base', fromPort: 'output', to: 'look', toPort: 'image' }]
	),
	step('net-request', 'HTTP request', 'A URL prompt feeds the HTTP tester. Play sends it. The result shows status, time and size.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'https://example.com' } },
		{ id: 'b', type: 'http', x: 460, y: 0, props: { method: 'GET', url: '', extractText: true } },
		{ id: 'c', type: 'output', x: 980, y: 0 },
	], [
		{ from: 'a', fromPort: 'output', to: 'b', toPort: 'url' },
		{ from: 'b', fromPort: 'output', to: 'c', toPort: 'input' },
	]),
	step('net-file', 'Download a URL', 'The prompt is the file URL. Download saves it on this machine.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'https://example.com' } },
		{ id: 'b', type: 'download', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'url' }]),
	step('net-probe', 'This machine', 'Network tools can show this machine’s addresses. No target is required for that tool.', [
		{ id: 'a', type: 'net_tool', x: 0, y: 0, props: { tool: 'my_ips', target: '' } },
		{ id: 'b', type: 'output', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	step('net-sql', 'Postgres in the browser', 'PGlite runs in the page. The first run loads it. Play runs the SQL.', [
		{
			id: 'a',
			type: 'postgres',
			x: 0,
			y: 0,
			props: { sql: 'CREATE TABLE IF NOT EXISTS notes (id serial PRIMARY KEY, body text);\nINSERT INTO notes (body) VALUES (\'hello\');\nSELECT * FROM notes;' },
		},
		{ id: 'b', type: 'output', x: 520, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	step('logic-if', 'If / else', 'A number is the test. The prompt is the value that passes through.', [
		{ id: 'n', type: 'number', x: 0, y: 0, props: { value: 3 } },
		{ id: 'p', type: 'prompt', x: 0, y: 200, props: { text: 'keep this line' } },
		{ id: 'g', type: 'if', x: 460, y: 40, props: { condition: 'gt', operand: '0' } },
	], [
		{ from: 'n', fromPort: 'output', to: 'g', toPort: 'test' },
		{ from: 'p', fromPort: 'output', to: 'g', toPort: 'input' },
	]),
	step('logic-gate', 'And / Or / Not', 'Two prompts go into And.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'yes' } },
		{ id: 'b', type: 'prompt', x: 0, y: 200, props: { text: 'yes' } },
		{ id: 'g', type: 'logic', x: 460, y: 80, props: { op: 'and' } },
	], [
		{ from: 'a', fromPort: 'output', to: 'g', toPort: 'a' },
		{ from: 'b', fromPort: 'output', to: 'g', toPort: 'b' },
	]),
	step('logic-each', 'For each line', 'Each line of the prompt becomes one item.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'red\nblue\ngreen' } },
		{ id: 'b', type: 'for_each', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'list' }]),
	step('logic-route', 'Router', 'One value is copied to each router output.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'same value' } },
		{ id: 'b', type: 'router', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	step('logic-code', 'Code node', 'TypeScript, JavaScript, or Python. Python runs in WASM.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'canvas nodes' } },
		{ id: 'b', type: 'code', x: 460, y: 0, props: { lang: 'ts', inputCount: 1, code: WORD_COUNT } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'a' }]),
	step('logic-pack', 'Packed node', 'A packed node stands in for a group. Select nodes and use Pack into one node.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'Pack me with another node.' } },
		{ id: 'b', type: 'subgraph', x: 460, y: 0 },
	]),
	step('input-random', 'Random', 'Random writes one value. Wire a list in when you want it to pick from lines.', [
		{ id: 'a', type: 'random', x: 0, y: 0 },
		{ id: 'b', type: 'output', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	step('output-save', 'Save to a file', 'The prompt is written under data/exports.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'Saved from the example canvas.' } },
		{ id: 'b', type: 'save', x: 460, y: 0, props: { fileName: 'example.txt' } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	{
		id: 'article-desk',
		title: 'Article desk',
		blurb: 'Fetch a page, clean it, summarize, draft, join the title, count words, branch, show, save, and log a row in Postgres.',
		nodes: [
			{ id: 'topic', type: 'prompt', x: 0, y: 0, props: { text: 'Write a short brief about local-first software.' } },
			{ id: 'page', type: 'prompt', x: 460, y: 0, props: { text: 'https://example.com' } },
			{ id: 'fetch', type: 'http', x: 920, y: 0, props: { method: 'GET', url: '', extractText: true } },
			{ id: 'clean', type: 'text_tool', x: 1380, y: 0, props: { op: 'trim' } },
			{ id: 'summary', type: 'summarize', x: 0, y: 380 },
			{ id: 'draft', type: 'generate_text', x: 460, y: 380 },
			{ id: 'join', type: 'prompt_concat', x: 920, y: 380, props: { separator: '\n\n' } },
			{ id: 'count', type: 'code', x: 1380, y: 380, props: { inputCount: 1, code: WORD_COUNT } },
			{ id: 'gate', type: 'if', x: 0, y: 760, props: { condition: 'gt', operand: '0' } },
			{ id: 'view', type: 'output', x: 460, y: 760, props: { kind: 'markdown' } },
			{ id: 'file', type: 'save', x: 920, y: 760, props: { fileName: 'brief.md' } },
			{ id: 'sql', type: 'postgres', x: 1380, y: 760, props: { sql: "CREATE TABLE IF NOT EXISTS desk (id serial PRIMARY KEY, topic text);\nSELECT 'desk ready' AS status;" } },
		],
		wires: [
			{ from: 'page', fromPort: 'output', to: 'fetch', toPort: 'url' },
			{ from: 'fetch', fromPort: 'output', to: 'clean', toPort: 'input' },
			{ from: 'clean', fromPort: 'output', to: 'summary', toPort: 'input' },
			{ from: 'topic', fromPort: 'output', to: 'draft', toPort: 'prompt' },
			{ from: 'summary', fromPort: 'output', to: 'draft', toPort: 'input' },
			{ from: 'topic', fromPort: 'output', to: 'join', toPort: 'prefix' },
			{ from: 'draft', fromPort: 'output', to: 'join', toPort: 'main' },
			{ from: 'join', fromPort: 'output', to: 'count', toPort: 'a' },
			{ from: 'count', fromPort: 'output', to: 'gate', toPort: 'input' },
			{ from: 'gate', fromPort: 'then', to: 'view', toPort: 'input' },
			{ from: 'gate', fromPort: 'then', to: 'file', toPort: 'input' },
			{ from: 'topic', fromPort: 'output', to: 'sql', toPort: 'input' },
		],
	},
]

export function exampleCovers(): string[] {
	return [...new Set(EXAMPLES.flatMap((example) => example.nodes.map((node) => node.type)))].sort()
}
