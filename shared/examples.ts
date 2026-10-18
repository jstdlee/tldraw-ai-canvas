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
	/** Node ids to group after the example is placed. */
	groupIds?: string[]
	groupLabel?: string
}

const WORD_COUNT = `export default async function run({ a }: Record<string, string>) {
  const words = (a ?? '').split(/\\s+/).filter(Boolean)
  return String(words.length)
}
`

const CSV = `name,score
ada,9
bea,4`

const PROSE_WITH_TABLE = `Here are the findings from the latest survey:

| Country | Share |
| --- | --- |
| Norway | 42% |
| Sweden | 31% |

Let me know if you would like a breakdown by age group.`

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
	// FLOW-03: "Reply to" (the `parent` port) seeds prior conversation history, not this turn's
	// message — wiring the prompt there left the chat's own Message field empty ("Type a message
	// first."). The outgoing message is the `userMessage` field itself, which (like every
	// wirable field, WP17) has its own `field:` port.
	step('llm-chat', 'Chat message', 'A prompt becomes the chat node\'s outgoing message.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'Say hello in one short sentence.' } },
		{ id: 'b', type: 'chat', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'field:userMessage' }]),
	step('llm-task', 'AI text job', 'AI text summarizes whatever the prompt sends.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'Canvas nodes, wires, and a local model.' } },
		{ id: 'b', type: 'text_ai', x: 460, y: 0, props: { operation: 'summarize' } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	step('llm-jev', 'JEV decision', 'A question about the prompt. JEV returns yes, no, or a score.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'The note is kind and short.' } },
		{ id: 'b', type: 'jev', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'context' }]),
	step('llm-decision-switch', 'Decision switch', 'JEV decides yes/no; the switch routes the prompt down the matching output.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'The note is kind and short.' } },
		{ id: 'b', type: 'jev', x: 460, y: 0 },
		{ id: 'c', type: 'decision_switch', x: 920, y: 0 },
	], [
		{ from: 'a', fromPort: 'output', to: 'b', toPort: 'context' },
		{ from: 'b', fromPort: 'probs', to: 'c', toPort: 'decision' },
		{ from: 'a', fromPort: 'output', to: 'c', toPort: 'value' },
	]),
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
	// Replaces the old "Postgres in the browser" example (the hidden/superseded `postgres`
	// type): same PGlite-in-the-page engine, via the real "Database" card (source: Built-in
	// Postgres).
	step('database-sql', 'Postgres in the browser', 'PGlite runs in the page. The first run loads it. Play runs the SQL.', [
		{
			id: 'a',
			type: 'database',
			x: 0,
			y: 0,
			props: { source: 'pglite', sql: 'CREATE TABLE IF NOT EXISTS notes (id serial PRIMARY KEY, body text);\nINSERT INTO notes (body) VALUES (\'hello\');\nSELECT * FROM notes;' },
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
	step('if-route-summary', 'Route long text to a summary', 'If the text is long, AI text summarizes it; a short text passes straight through.', [
		{ id: 'p', type: 'prompt', x: 0, y: 0, props: { text: 'A long paragraph worth summarizing goes here, with several sentences of detail.' } },
		{ id: 'g', type: 'if', x: 460, y: 0, props: { condition: 'gt', operand: '80' } },
		{ id: 'len', type: 'text_tool', x: 0, y: 260, props: { op: 'count' } },
		{ id: 'sum', type: 'text_ai', x: 920, y: -80, props: { operation: 'summarize' } },
		{ id: 'out', type: 'output', x: 920, y: 160 },
	], [
		{ from: 'p', fromPort: 'output', to: 'len', toPort: 'input' },
		{ from: 'len', fromPort: 'output', to: 'g', toPort: 'test' },
		{ from: 'p', fromPort: 'output', to: 'g', toPort: 'input' },
		{ from: 'g', fromPort: 'then', to: 'sum', toPort: 'input' },
		{ from: 'g', fromPort: 'else', to: 'out', toPort: 'input' },
	]),
	step('if-threshold-flag', 'Flag numbers above a threshold', 'A number above the threshold takes "then"; otherwise "else".', [
		{ id: 'n', type: 'number', x: 0, y: 0, props: { value: 120 } },
		{ id: 'g', type: 'if', x: 460, y: 0, props: { condition: 'gt', operand: '100' } },
		{ id: 'high', type: 'output', x: 920, y: -80 },
		{ id: 'ok', type: 'output', x: 920, y: 160 },
	], [
		{ from: 'n', fromPort: 'output', to: 'g', toPort: 'input' },
		{ from: 'g', fromPort: 'then', to: 'high', toPort: 'input' },
		{ from: 'g', fromPort: 'else', to: 'ok', toPort: 'input' },
	]),
	step('if-in-for-each', 'If inside For each', 'Each item is tested; only the ones that pass reach "Result".', [
		{ id: 'list', type: 'prompt', x: 0, y: 0, props: { text: 'apple\nbanana kiwi\ncherry' } },
		{ id: 'loop', type: 'for_each', x: 460, y: 0, props: { noResult: 'skip' } },
		{ id: 'g', type: 'if', x: 920, y: 0, props: { condition: 'contains', operand: ' ' } },
	], [
		{ from: 'list', fromPort: 'output', to: 'loop', toPort: 'list' },
		{ from: 'loop', fromPort: 'item', to: 'g', toPort: 'input' },
		{ from: 'g', fromPort: 'then', to: 'loop', toPort: 'result' },
	]),
	step('if-regex-check', 'Regex check', 'If the text matches the pattern, "then" carries it; otherwise "else" does.', [
		{ id: 'p', type: 'prompt', x: 0, y: 0, props: { text: 'order-2024-0193' } },
		{ id: 'g', type: 'if', x: 460, y: 0, props: { condition: 'regex', operand: '^order-\\d{4}-\\d+$' } },
		{ id: 'valid', type: 'output', x: 920, y: -80 },
		{ id: 'invalid', type: 'output', x: 920, y: 160 },
	], [
		{ from: 'p', fromPort: 'output', to: 'g', toPort: 'input' },
		{ from: 'g', fromPort: 'then', to: 'valid', toPort: 'input' },
		{ from: 'g', fromPort: 'else', to: 'invalid', toPort: 'input' },
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
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'in1' }]),
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
			{ id: 'summary', type: 'text_ai', x: 0, y: 380, props: { operation: 'summarize' } },
			{ id: 'draft', type: 'generate_text', x: 460, y: 380 },
			{ id: 'join', type: 'prompt_concat', x: 920, y: 380, props: { separator: '\n\n' } },
			{ id: 'count', type: 'code', x: 1380, y: 380, props: { inputCount: 1, code: WORD_COUNT } },
			{ id: 'gate', type: 'if', x: 0, y: 760, props: { condition: 'gt', operand: '0' } },
			{ id: 'view', type: 'output', x: 460, y: 760, props: { kind: 'markdown' } },
			{ id: 'file', type: 'save', x: 920, y: 760, props: { fileName: 'brief.md' } },
			{ id: 'sql', type: 'database', x: 1380, y: 760, props: { source: 'pglite', sql: "CREATE TABLE IF NOT EXISTS desk (id serial PRIMARY KEY, topic text);\nSELECT 'desk ready' AS status;" } },
		],
		wires: [
			{ from: 'page', fromPort: 'output', to: 'fetch', toPort: 'url' },
			{ from: 'fetch', fromPort: 'output', to: 'clean', toPort: 'input' },
			{ from: 'clean', fromPort: 'output', to: 'summary', toPort: 'input' },
			{ from: 'topic', fromPort: 'output', to: 'draft', toPort: 'prompt' },
			{ from: 'summary', fromPort: 'output', to: 'draft', toPort: 'input' },
			{ from: 'topic', fromPort: 'output', to: 'join', toPort: 'prefix' },
			{ from: 'draft', fromPort: 'output', to: 'join', toPort: 'main' },
			{ from: 'join', fromPort: 'output', to: 'count', toPort: 'in1' },
			{ from: 'count', fromPort: 'output', to: 'gate', toPort: 'input' },
			{ from: 'gate', fromPort: 'then', to: 'view', toPort: 'input' },
			{ from: 'gate', fromPort: 'then', to: 'file', toPort: 'input' },
		],
	},
	step('table-columns', 'Pick table columns', 'A CSV prompt feeds DataPipe. Keep columns keeps name and score.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: CSV } },
		{ id: 'b', type: 'table', x: 460, y: 0, props: { format: 'csv', op: 'select', columns: 'name,score' } },
		{ id: 'c', type: 'output', x: 980, y: 0 },
	], [
		{ from: 'a', fromPort: 'output', to: 'b', toPort: 'data' },
		{ from: 'b', fromPort: 'output', to: 'c', toPort: 'input' },
	]),
	step('table-new-column', 'New column from a formula', 'DataPipe builds a label with upper(name). Extra lines can fill a column when the formula is empty.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: CSV } },
		{ id: 'b', type: 'prompt', x: 0, y: 240, props: { text: 'lead\nreview' } },
		{ id: 'c', type: 'table', x: 460, y: 40, props: { format: 'csv', op: 'newcol', expr: 'upper(name)', name: 'label' } },
	], [
		{ from: 'a', fromPort: 'output', to: 'c', toPort: 'data' },
		{ from: 'b', fromPort: 'output', to: 'c', toPort: 'extra' },
	]),
	step('profile-table', 'Profile a table', 'The same CSV feeds Profile: column types, fill rate, distinct values and a histogram.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: CSV } },
		{ id: 'b', type: 'profile', x: 460, y: 0, props: { format: 'csv' } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'data' }]),
	step('table-view', 'View a table', 'The same CSV feeds Table view: a sortable, filterable grid with a row count and Copy as CSV.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: CSV } },
		{ id: 'b', type: 'table_view', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'data' }]),
	step('json-fields', 'Pull fields out of JSON', 'A JSON prompt feeds JSON fields. Each line of the Paths field becomes its own output port.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: '{"value":"hi","topic":"demo","data":[{"name":"Ada"}],"customer":{"country":"NO"}}' } },
		{ id: 'b', type: 'json_fields', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'json' }]),
	step('extract-table', 'Pull a table out of prose', 'A chatty answer feeds Extract from text. It finds the Markdown table inside it and outputs it as CSV.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: PROSE_WITH_TABLE } },
		{ id: 'b', type: 'extract', x: 460, y: 0 },
		{ id: 'c', type: 'output', x: 980, y: 0 },
	], [
		{ from: 'a', fromPort: 'output', to: 'b', toPort: 'text' },
		{ from: 'b', fromPort: 'table', to: 'c', toPort: 'input' },
	]),
	step('chart-bars', 'Bar chart', 'The same CSV feeds Chart. ECharts draws name and score.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: CSV } },
		{ id: 'b', type: 'chart', x: 460, y: 0, props: { format: 'csv', kind: 'bar', xCol: 'name', yCol: 'score' } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'data' }]),
	step('database-open', 'Open a SQLite file', 'Upload a .sqlite file, click a table to query it, or type your own SQL. Nothing runs until you press Play.', [
		{ id: 'a', type: 'database', x: 0, y: 0 },
		{ id: 'b', type: 'output', x: 560, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	step('datapipe-chain', 'DataPipe chain', 'Inline CSV goes through Filter rows, then Group and summarise, then Chart. Each DataPipe does one step.', [
		{ id: 'a', type: 'table', x: 0, y: 0, props: { text: CSV, format: 'auto', op: 'filter', column: 'score', as: '>', with: '4' } },
		{ id: 'b', type: 'table', x: 520, y: 0, props: { format: 'auto', op: 'groupby', column: 'name', columns: 'score:sum' } },
		{ id: 'c', type: 'chart', x: 1040, y: 0, props: { format: 'csv', kind: 'bar', xCol: 'name', yCol: 'sum_score' } },
	], [
		{ from: 'a', fromPort: 'output', to: 'b', toPort: 'data' },
		{ from: 'b', fromPort: 'output', to: 'c', toPort: 'data' },
	]),
	step('local-grep', 'Keep matching lines', 'Text tools keeps lines that contain ada. The match runs in the page.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: CSV } },
		{ id: 'b', type: 'text_tool', x: 460, y: 0, props: { op: 'keep_lines', a: 'ada' } },
		{ id: 'c', type: 'output', x: 980, y: 0 },
	], [
		{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' },
		{ from: 'b', fromPort: 'output', to: 'c', toPort: 'input' },
	]),
	// Replaces the old "Summarize a page" example (the hidden/superseded `url_in` type): "Read
	// from" takes over the same bare-domain convenience (Source: url normalizes
	// www.example.com, no https needed) and fetches the page text.
	step('url-summary', 'Summarize a page', 'Type www.wikipedia.org with no https. Read from fetches the page, and AI text summarizes it.', [
		{ id: 'a', type: 'file_in', x: 0, y: 0, props: { source: 'url', url: 'www.wikipedia.org', asText: 'text' } },
		{ id: 'b', type: 'text_ai', x: 460, y: 0, props: { operation: 'summarize' } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	step('web-search', 'Search the web', 'A prompt feeds Web search. Add a key in AI providers → Search providers (or on the card) first.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'latest open source AI model releases' } },
		{ id: 'b', type: 'web_search', x: 460, y: 0, props: { provider: 'exa', count: 5 } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'query' }]),
	step('agent-task', 'Run an agent task', 'Agent runs a task with a model that has the "agent" capability. Add a search provider or MCP server in AI providers to give it tools.', [
		{ id: 'a', type: 'agent', x: 0, y: 0, props: { task: 'What is 2 + 2? Answer in one short sentence.' } },
	], []),
	step('html-preview', 'Preview HTML', 'A prompt holds a small HTML snippet. HTML preview renders it in a sandboxed iframe.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: '<button style="padding:8px 14px">Hello</button>' } },
		{ id: 'b', type: 'html_preview', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'text' }]),
	step('html-form-cards', 'Click an option card', 'HTML form shows three option buttons and waits for a click, then Output shows the clicked value as JSON.', [
		{ id: 'a', type: 'html_form', x: 0, y: 0 },
		{ id: 'b', type: 'output', x: 560, y: 0 },
	], [{ from: 'a', fromPort: 'json', to: 'b', toPort: 'input' }]),
	step('video-autoplay', 'Video link', 'The prompt is the video URL. Turn on autoplay on the video node. The browser mutes autoplay.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' } },
		{ id: 'b', type: 'video', x: 460, y: 0, props: { autoplay: true } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'url' }]),
	step('sleep-pass', 'Wait, then pass the text', 'Sleep waits, then sends the same text onward. The limit is 60 seconds.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'after a short wait' } },
		{ id: 'b', type: 'sleep', x: 460, y: 0, props: { ms: 200 } },
		{ id: 'c', type: 'output', x: 920, y: 0 },
	], [
		{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' },
		{ from: 'b', fromPort: 'output', to: 'c', toPort: 'input' },
	]),
	step('read-from-hash', 'Hash a page', 'Read from reads a URL or an uploaded file. Tick "Output SHA-256 instead" to get a hash instead of the text.', [
		{ id: 'a', type: 'file_in', x: 0, y: 0, props: { source: 'url', url: 'https://www.example.com', asText: 'text', action: 'sha256' } },
		{ id: 'b', type: 'output', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	step('image-gen', 'Generate an image', 'A prompt feeds Generate image. It calls the model you set up in AI providers and shows the result on the card.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'A watercolor fox in a forest' } },
		{ id: 'b', type: 'image_gen', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'prompt' }]),
	step('raw-model', 'Raw model call', 'Every setting is on the card: URL, model id, key, system prompt, temperature, thinking, max tokens.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'Say hello in one line.' } },
		{ id: 'b', type: 'raw_model', x: 460, y: 0, props: { url: 'http://127.0.0.1:11434/v1', model: 'llama3.2' } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'prompt' }]),
	step('model-provider', 'Wire a custom model in', 'Model provider fetches models from any OpenAI-compatible URL. Its output wires into another card’s Model input.', [
		{ id: 'a', type: 'model_source', x: 0, y: 0, props: { baseURL: 'http://127.0.0.1:11434/v1', model: 'llama3.2' } },
		{ id: 'b', type: 'prompt', x: 0, y: 220, props: { text: 'Say hello in one line.' } },
		{ id: 'c', type: 'generate_text', x: 460, y: 0 },
	], [
		{ from: 'a', fromPort: 'model', to: 'c', toPort: 'model' },
		{ from: 'b', fromPort: 'output', to: 'c', toPort: 'prompt' },
	]),
	step('openrouter-free', 'OpenRouter free model', 'Play loads the free model list and writes the first id.', [
		{ id: 'a', type: 'openrouter', x: 0, y: 0 },
		{ id: 'b', type: 'text_tool', x: 460, y: 0, props: { op: 'trim' } },
		{ id: 'c', type: 'output', x: 920, y: 0 },
	], [
		{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' },
		{ from: 'b', fromPort: 'output', to: 'c', toPort: 'input' },
	]),
	step('local-wc', 'Count words', 'Text tools counts words, characters, and lines in the page.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'one two three four' } },
		{ id: 'b', type: 'text_tool', x: 460, y: 0, props: { op: 'count' } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	step('template-fill', 'Fill a template', 'Two prompts fill {{name}} and {{total}} in the Template text; the result is one piece of text.', [
		{ id: 'name', type: 'prompt', x: 0, y: 0, props: { text: 'Ada' } },
		{ id: 'total', type: 'prompt', x: 0, y: 220, props: { text: '42' } },
		{ id: 't', type: 'template', x: 460, y: 100, props: { template: 'Hi {{name}}, your total is {{total}}.' } },
		{ id: 'out', type: 'output', x: 980, y: 100 },
	], [
		{ from: 'name', fromPort: 'output', to: 't', toPort: 'var:name' },
		{ from: 'total', fromPort: 'output', to: 't', toPort: 'var:total' },
		{ from: 't', fromPort: 'output', to: 'out', toPort: 'input' },
	]),
	{
		id: 'group-label',
		title: 'Group and rename',
		blurb: 'Two notes become one group. The label sits on the top edge. Double-click to dive in. Back returns. Right-click Rename to change it. Group text is both notes, one per line.',
		nodes: [
			{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'First note' } },
			{ id: 'b', type: 'prompt', x: 0, y: 220, props: { text: 'Second note' } },
		],
		wires: [],
		groupIds: ['a', 'b'],
		groupLabel: 'Notes',
	},
	step('shell-keys', 'Search, map, and commands', 'Ctrl-P inserts a node. Shift-B collapses the library. Find supports regexp, several lines, highlight, and a dry run. Map view moves the canvas. Search hits blink. Undo is the normal canvas undo. Backup is in the View menu.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'Find this sentence on the canvas.' } },
		{ id: 'b', type: 'output', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	{
		id: 'data-desk',
		title: 'Data desk',
		blurb: 'CSV goes through select, a new column, a chart, concat, a line filter, a short wait, a view, a file, Postgres, and SQLite.',
		nodes: [
			{ id: 'csv', type: 'prompt', x: 0, y: 0, props: { text: CSV } },
			{ id: 'pick', type: 'table', x: 460, y: 0, props: { format: 'csv', op: 'select', columns: 'name,score' } },
			{ id: 'col', type: 'table', x: 980, y: 0, props: { format: 'csv', op: 'newcol', expr: 'upper(name)', name: 'label' } },
			{ id: 'bars', type: 'chart', x: 1500, y: 0, props: { format: 'csv', kind: 'bar', xCol: 'name', yCol: 'score' } },
			{ id: 'title', type: 'prompt', x: 0, y: 420, props: { text: 'Score table' } },
			{ id: 'join', type: 'prompt_concat', x: 460, y: 420, props: { separator: '\n' } },
			{ id: 'grep', type: 'text_tool', x: 980, y: 420, props: { op: 'keep_lines', a: 'ada' } },
			{ id: 'wait', type: 'sleep', x: 1500, y: 420, props: { ms: 100 } },
			{ id: 'view', type: 'output', x: 0, y: 840 },
			{ id: 'file', type: 'save', x: 460, y: 840, props: { fileName: 'scores.csv' } },
			{ id: 'sql', type: 'database', x: 980, y: 840, props: { source: 'pglite', sql: "SELECT '$input' AS src;" } },
			{ id: 'lite', type: 'database', x: 1500, y: 840 },
		],
		wires: [
			{ from: 'csv', fromPort: 'output', to: 'pick', toPort: 'data' },
			{ from: 'pick', fromPort: 'output', to: 'col', toPort: 'data' },
			{ from: 'col', fromPort: 'output', to: 'bars', toPort: 'data' },
			{ from: 'title', fromPort: 'output', to: 'join', toPort: 'prefix' },
			{ from: 'col', fromPort: 'output', to: 'join', toPort: 'main' },
			{ from: 'col', fromPort: 'output', to: 'grep', toPort: 'input' },
			{ from: 'grep', fromPort: 'output', to: 'wait', toPort: 'input' },
			{ from: 'wait', fromPort: 'output', to: 'view', toPort: 'input' },
			{ from: 'join', fromPort: 'output', to: 'file', toPort: 'input' },
		],
	},
	{
		id: 'media-desk',
		title: 'Media and models desk',
		blurb: 'A page address feeds video and HTTP. The body waits, then a text tool counts it. A file hash sits beside a raw model call and a summary.',
		nodes: [
			{ id: 'url', type: 'prompt', x: 0, y: 0, props: { text: 'https://example.com' } },
			{ id: 'clip', type: 'video', x: 460, y: 0, props: { autoplay: false } },
			{ id: 'fetch', type: 'http', x: 980, y: 0, props: { method: 'GET', extractText: true } },
			{ id: 'wait', type: 'sleep', x: 1500, y: 0, props: { ms: 100 } },
			{ id: 'lines', type: 'text_tool', x: 0, y: 420, props: { op: 'count' } },
			{ id: 'file', type: 'file_in', x: 980, y: 420, props: { source: 'url', url: 'https://www.example.com', asText: 'text' } },
			{ id: 'task', type: 'prompt', x: 1500, y: 420, props: { text: 'Say hello in one line.' } },
			{ id: 'sum', type: 'text_ai', x: 0, y: 840, props: { operation: 'summarize' } },
			{ id: 'raw', type: 'raw_model', x: 460, y: 840, props: { url: 'http://127.0.0.1:11434/v1', model: 'llama3.2' } },
		],
		wires: [
			{ from: 'url', fromPort: 'output', to: 'clip', toPort: 'url' },
			{ from: 'url', fromPort: 'output', to: 'fetch', toPort: 'url' },
			{ from: 'fetch', fromPort: 'output', to: 'wait', toPort: 'input' },
			{ from: 'wait', fromPort: 'output', to: 'lines', toPort: 'input' },
			{ from: 'fetch', fromPort: 'output', to: 'sum', toPort: 'input' },
			{ from: 'task', fromPort: 'output', to: 'raw', toPort: 'prompt' },
		],
	},
	step(
		'merge-branches',
		'Merge two branches',
		'If routes the message to one of two prompts; Merge combines whichever one actually ran (the other is skipped, not an error) into one Output.',
		[
			{ id: 'msg', type: 'prompt', x: 0, y: 0, props: { text: 'I am upset about my order.' } },
			{ id: 'check', type: 'if', x: 460, y: 0, props: { condition: 'contains', operand: 'upset' } },
			{ id: 'join', type: 'merge', x: 920, y: 0, props: { mode: 'first' } },
			{ id: 'out', type: 'output', x: 1380, y: 0 },
		],
		[
			{ from: 'msg', fromPort: 'output', to: 'check', toPort: 'input' },
			{ from: 'check', fromPort: 'then', to: 'join', toPort: 'in1' },
			{ from: 'check', fromPort: 'else', to: 'join', toPort: 'in2' },
			{ from: 'join', fromPort: 'output', to: 'out', toPort: 'input' },
		]
	),
	step('image-gallery', 'Image gallery', 'A list of image URLs becomes a grid, with Download all as a zip.', [
		{ id: 'list', type: 'prompt', x: 0, y: 0, props: { text: '/examples/girl-base.jpg\n/examples/girl-coat.jpg\n/examples/girl-dress.jpg' } },
		{ id: 'grid', type: 'gallery', x: 460, y: 0, props: { columns: 3 } },
	], [{ from: 'list', fromPort: 'output', to: 'grid', toPort: 'images' }]),

	// WP38 (GAPS-19): 8 examples combining the new cards — each is one of the 10 pipelines from
	// the 2026-10-18 gaps review (§3.2) that now works end to end.
	step(
		'csv-rows-ai-table',
		'Summarize each CSV row with AI',
		'For each row of the CSV (Split: "table rows"), AI text summarizes the review in one sentence; Collect: "table" adds it back as a new column.',
		[
			{ id: 'csv', type: 'prompt', x: 0, y: 0, props: { text: 'id,product,review\n1,Mug,great mug fast shipping\n2,Lamp,arrived broken very disappointed' } },
			{ id: 'loop', type: 'for_each', x: 540, y: 0, props: { split: 'rows', collect: 'table', resultColumn: 'summary' } },
			{ id: 'ai', type: 'text_ai', x: 1080, y: 0, props: { operation: 'summarize', option: '1 short sentence' } },
			{ id: 'out', type: 'table_view', x: 1620, y: 0 },
		],
		[
			{ from: 'csv', fromPort: 'output', to: 'loop', toPort: 'list' },
			{ from: 'loop', fromPort: 'item', to: 'ai', toPort: 'input' },
			{ from: 'ai', fromPort: 'output', to: 'loop', toPort: 'result' },
			{ from: 'loop', fromPort: 'output', to: 'out', toPort: 'data' },
		]
	),
	step(
		'agent-extract-chart',
		'Agent research to a chart',
		'The agent answers with prose plus a Markdown table; Extract from text pulls just the table out (find: table), then Chart draws it — no detour card needed.',
		[
			{ id: 'agent', type: 'agent', x: 0, y: 0, props: { task: 'Research the top 3 programming languages by popularity. Answer with a short Markdown table of columns language and share (percent).' } },
			{ id: 'ext', type: 'extract', x: 460, y: 0, props: { find: 'table' } },
			{ id: 'chart', type: 'chart', x: 920, y: 0, props: { kind: 'bar', xCol: 'language', yCol: 'share' } },
		],
		[
			{ from: 'agent', fromPort: 'output', to: 'ext', toPort: 'text' },
			{ from: 'ext', fromPort: 'table', to: 'chart', toPort: 'data' },
		]
	),
	step(
		'form-switch-merge',
		'Pick a style, rewrite, merge',
		'HTML form\'s "value" (not "output") routes into Decision switch\'s choice mode; the chosen `opt:<option>` branch rewrites the text, and Merge combines whichever branch ran into one result.',
		[
			{ id: 'src', type: 'prompt', x: 0, y: 0, props: { text: 'Our new notes app syncs offline.' } },
			{ id: 'form', type: 'html_form', x: 0, y: 500, props: { text: '<button data-value="short">Short</button> <button data-value="formal">Formal</button> <button data-value="funny">Funny</button>' } },
			{ id: 'route', type: 'decision_switch', x: 580, y: 250, props: { mode: 'choice', options: 'short\nformal\nfunny' } },
			{ id: 'short', type: 'text_ai', x: 1200, y: -500, props: { operation: 'rewrite', option: 'short and punchy' } },
			{ id: 'formal', type: 'text_ai', x: 1200, y: 250, props: { operation: 'rewrite', option: 'formal and professional' } },
			{ id: 'funny', type: 'text_ai', x: 1200, y: 1000, props: { operation: 'rewrite', option: 'funny and playful' } },
			{ id: 'join', type: 'merge', x: 1820, y: 250, props: { mode: 'first' } },
			{ id: 'out', type: 'output', x: 2360, y: 250 },
		],
		[
			{ from: 'form', fromPort: 'value', to: 'route', toPort: 'decision' },
			{ from: 'src', fromPort: 'output', to: 'route', toPort: 'value' },
			{ from: 'route', fromPort: 'opt:short', to: 'short', toPort: 'input' },
			{ from: 'route', fromPort: 'opt:formal', to: 'formal', toPort: 'input' },
			{ from: 'route', fromPort: 'opt:funny', to: 'funny', toPort: 'input' },
			{ from: 'short', fromPort: 'output', to: 'join', toPort: 'in1' },
			{ from: 'formal', fromPort: 'output', to: 'join', toPort: 'in2' },
			{ from: 'funny', fromPort: 'output', to: 'join', toPort: 'in3' },
			{ from: 'join', fromPort: 'output', to: 'out', toPort: 'input' },
		]
	),
	step(
		'sql-template-report',
		'SQL summary to an HTML report',
		'Database groups the sales CSV by region; Template builds one HTML report from the table and the chart image ({{name|table}}, {{name}} for an image); HTML preview renders it, Save writes the file.',
		[
			{ id: 'csv', type: 'prompt', x: 0, y: 0, props: { text: 'region,month,revenue\nEU,Jan,100\nUS,Jan,150\nEU,Feb,120' } },
			{
				id: 'db',
				type: 'database',
				x: 540,
				y: 0,
				props: { source: 'pglite', targetTable: 'sales', loadMode: 'replace', sql: 'select region, sum(revenue) as total from sales group by region' },
			},
			{ id: 'bars', type: 'chart', x: 1080, y: 0, props: { kind: 'bar', xCol: 'region', yCol: 'total' } },
			{ id: 'rpt', type: 'template', x: 1620, y: 0, props: { template: '<h1>Sales report</h1>{{table|table}}<img src="{{chart}}">', escape: 'none' } },
			{ id: 'prev', type: 'html_preview', x: 2160, y: 0 },
			{ id: 'save', type: 'save', x: 2700, y: 0, props: { fileName: 'sales-report.html', mode: 'new' } },
		],
		[
			{ from: 'csv', fromPort: 'output', to: 'db', toPort: 'rows' },
			{ from: 'db', fromPort: 'output', to: 'bars', toPort: 'data' },
			{ from: 'db', fromPort: 'output', to: 'rpt', toPort: 'var:table' },
			{ from: 'bars', fromPort: 'output', to: 'rpt', toPort: 'var:chart' },
			{ from: 'rpt', fromPort: 'output', to: 'prev', toPort: 'text' },
			{ from: 'prev', fromPort: 'output', to: 'save', toPort: 'input' },
		]
	),
	step(
		'links-foreach-summary',
		'Links to a summary table',
		'Text tools "Extract links" turns the page\'s links into a url/text table; For each "table rows" visits each one (wiring the row\'s own `row:text` column), AI text rewrites it, and Collect: "table" builds the summary table.',
		[
			{ id: 'page', type: 'prompt', x: 0, y: 0, props: { text: '<a href="https://example.com/docs">Our complete setup guide for new teams</a> <a href="/blog/post-1">Why we went local-first this year</a>' } },
			{ id: 'base', type: 'prompt', x: 0, y: 400, props: { text: 'https://example.com' } },
			{ id: 'links', type: 'text_tool', x: 540, y: 0, props: { op: 'extract_links', a: 'all' } },
			{ id: 'loop', type: 'for_each', x: 1080, y: 0, props: { split: 'rows', collect: 'table', resultColumn: 'summary' } },
			{ id: 'ai', type: 'text_ai', x: 1620, y: 0, props: { operation: 'rewrite', option: 'as a short, friendly one-line description (max 10 words)' } },
			{ id: 'out', type: 'table_view', x: 2160, y: 0 },
		],
		[
			{ from: 'page', fromPort: 'output', to: 'links', toPort: 'input' },
			{ from: 'base', fromPort: 'output', to: 'links', toPort: 'input2' },
			{ from: 'links', fromPort: 'output', to: 'loop', toPort: 'list' },
			{ from: 'loop', fromPort: 'row:text', to: 'ai', toPort: 'input' },
			{ from: 'ai', fromPort: 'output', to: 'loop', toPort: 'result' },
			{ from: 'loop', fromPort: 'output', to: 'out', toPort: 'data' },
		]
	),
	step(
		'search-table-chart',
		'Search results to a chart',
		'Web search\'s `results` (a JSON array) feeds DataPipe directly — no converter needed; a formula column (`len(snippet)`) gives Chart something numeric to plot.',
		[
			{ id: 'q', type: 'prompt', x: 0, y: 0, props: { text: 'local-first sync engines' } },
			{ id: 'search', type: 'web_search', x: 460, y: 0, props: { provider: 'exa', count: 4 } },
			{ id: 'pipe', type: 'table', x: 920, y: 0, props: { op: 'newcol', expr: 'len(snippet)', name: 'snippetLen' } },
			{ id: 'bars', type: 'chart', x: 1380, y: 0, props: { kind: 'bar', xCol: 'title', yCol: 'snippetLen' } },
		],
		[
			{ from: 'q', fromPort: 'output', to: 'search', toPort: 'query' },
			{ from: 'search', fromPort: 'results', to: 'pipe', toPort: 'data' },
			{ from: 'pipe', fromPort: 'output', to: 'bars', toPort: 'data' },
		]
	),
	step(
		'jev-switch-merge',
		'JEV gate to one of two replies',
		'JEV\'s own `yes`/`no` pass-through ports (not just probs) gate the branch directly; Merge combines the apology or upsell reply, whichever ran, into one Output.',
		[
			{ id: 'msg', type: 'prompt', x: 0, y: 0, props: { text: 'I am furious, my order never arrived and nobody replies to my emails!' } },
			{ id: 'judge', type: 'jev', x: 540, y: 0, props: { question: 'Is the customer angry?' } },
			{ id: 'apology', type: 'text_ai', x: 1160, y: -500, props: { operation: 'rewrite', option: 'as an empathetic apology offering a refund' } },
			{ id: 'upsell', type: 'text_ai', x: 1160, y: 500, props: { operation: 'rewrite', option: 'as a friendly upsell for a premium plan' } },
			{ id: 'join', type: 'merge', x: 1780, y: 0, props: { mode: 'first' } },
			{ id: 'out', type: 'output', x: 2320, y: 0 },
		],
		[
			{ from: 'msg', fromPort: 'output', to: 'judge', toPort: 'context' },
			{ from: 'judge', fromPort: 'yes', to: 'apology', toPort: 'input' },
			{ from: 'judge', fromPort: 'no', to: 'upsell', toPort: 'input' },
			{ from: 'apology', fromPort: 'output', to: 'join', toPort: 'in1' },
			{ from: 'upsell', fromPort: 'output', to: 'join', toPort: 'in2' },
			{ from: 'join', fromPort: 'output', to: 'out', toPort: 'input' },
		]
	),
	step(
		'batch-resize-gallery',
		'Batch resize to a gallery',
		'For each image URL: Load image, then Resize to 200px wide; Collect: "JSON array" hands the whole batch to Gallery as one grid.',
		[
			{ id: 'list', type: 'prompt', x: 0, y: 0, props: { text: '/examples/girl-base.jpg\n/examples/girl-coat.jpg\n/examples/girl-dress.jpg' } },
			{ id: 'loop', type: 'for_each', x: 540, y: 0, props: { split: 'lines', collect: 'json' } },
			{ id: 'load', type: 'load_image', x: 1080, y: 0 },
			{ id: 'resize', type: 'image_resize', x: 1620, y: 0, props: { mode: 'width', value: 200 } },
			{ id: 'grid', type: 'gallery', x: 2160, y: 0, props: { columns: 3 } },
		],
		[
			{ from: 'list', fromPort: 'output', to: 'loop', toPort: 'list' },
			{ from: 'loop', fromPort: 'item', to: 'load', toPort: 'url' },
			{ from: 'load', fromPort: 'output', to: 'resize', toPort: 'image' },
			{ from: 'resize', fromPort: 'output', to: 'loop', toPort: 'result' },
			{ from: 'loop', fromPort: 'output', to: 'grid', toPort: 'images' },
		]
	),
]

export function exampleCovers(): string[] {
	return [...new Set(EXAMPLES.flatMap((example) => example.nodes.map((node) => node.type)))].sort()
}
