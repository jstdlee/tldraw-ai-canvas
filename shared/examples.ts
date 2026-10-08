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
	step('table-columns', 'Pick table columns', 'A CSV prompt feeds Table. Select keeps name and score.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: CSV } },
		{ id: 'b', type: 'table', x: 460, y: 0, props: { format: 'csv', op: 'select', columns: 'name,score' } },
		{ id: 'c', type: 'output', x: 980, y: 0 },
	], [
		{ from: 'a', fromPort: 'output', to: 'b', toPort: 'data' },
		{ from: 'b', fromPort: 'output', to: 'c', toPort: 'input' },
	]),
	step('table-new-column', 'New column from a formula', 'Table builds a label with upper(name). Extra lines can fill a column when the formula is empty.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: CSV } },
		{ id: 'b', type: 'prompt', x: 0, y: 240, props: { text: 'lead\nreview' } },
		{ id: 'c', type: 'table', x: 460, y: 40, props: { format: 'csv', op: 'newcol', expr: 'upper(name)', name: 'label' } },
	], [
		{ from: 'a', fromPort: 'output', to: 'c', toPort: 'data' },
		{ from: 'b', fromPort: 'output', to: 'c', toPort: 'extra' },
	]),
	step('chart-bars', 'Bar chart', 'The same CSV feeds Chart. ECharts draws name and score.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: CSV } },
		{ id: 'b', type: 'chart', x: 460, y: 0, props: { format: 'csv', kind: 'bar', xCol: 'name', yCol: 'score' } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'data' }]),
	step('sqlite-query', 'SQLite into PGlite', 'Import a .sqlite or .db file (read in the browser, loaded into PGlite). Ask writes SQL. Play runs it. Nothing runs until you press Play.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'ready' } },
		{ id: 'b', type: 'sqlite_in', x: 460, y: 0, props: { sql: "SELECT '$input' AS note;", ask: 'Show one note column' } },
		{ id: 'c', type: 'output', x: 980, y: 0 },
	], [
		{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' },
		{ from: 'b', fromPort: 'output', to: 'c', toPort: 'input' },
	]),
	step('local-grep', 'grep a column', 'Local tool runs grep on the text. The tool list is gawk, awk, grep, sed, cut, sort, uniq, and wc.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: CSV } },
		{ id: 'b', type: 'local_tool', x: 460, y: 0, props: { tool: 'grep', args: 'ada' } },
		{ id: 'c', type: 'output', x: 980, y: 0 },
	], [
		{ from: 'a', fromPort: 'output', to: 'b', toPort: 'stdin' },
		{ from: 'b', fromPort: 'output', to: 'c', toPort: 'input' },
	]),
	step('url-summary', 'Summarize a page', 'Type www.wikipedia.org with no https. URL in adds it, fetches the page, and Summarize reads the text.', [
		{ id: 'a', type: 'url_in', x: 0, y: 0, props: { url: 'www.wikipedia.org', fetchBody: true } },
		{ id: 'b', type: 'summarize', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
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
	step('file-hash', 'Hash a file', 'File in reads a file you upload, or a path on the server. Choose SHA-256 to get its hash.', [
		{ id: 'a', type: 'file_in', x: 0, y: 0, props: { mode: 'path', path: '/etc/hostname', action: 'sha256' } },
		{ id: 'b', type: 'output', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	step('url-in', 'A web address', 'URL in accepts www.example.com without https. Turn on Fetch to send the page text.', [
		{ id: 'a', type: 'url_in', x: 0, y: 0, props: { url: 'www.example.com', fetchBody: true } },
		{ id: 'b', type: 'summarize', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	step('raw-model', 'Raw model call', 'Every setting is on the card: URL, model id, key, system prompt, temperature, thinking, max tokens.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'Say hello in one line.' } },
		{ id: 'b', type: 'raw_model', x: 460, y: 0, props: { url: 'http://127.0.0.1:11434/v1', model: 'llama3.2' } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'prompt' }]),
	step('openrouter-free', 'OpenRouter free model', 'Play loads the free model list and writes the first id.', [
		{ id: 'a', type: 'openrouter', x: 0, y: 0 },
		{ id: 'b', type: 'text_tool', x: 460, y: 0, props: { op: 'trim' } },
		{ id: 'c', type: 'output', x: 920, y: 0 },
	], [
		{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' },
		{ from: 'b', fromPort: 'output', to: 'c', toPort: 'input' },
	]),
	step('local-wc', 'Count words', 'Local tool runs wc on the text. It runs on the server with no shell.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'one two three four' } },
		{ id: 'b', type: 'local_tool', x: 460, y: 0, props: { tool: 'wc', args: '-w' } },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'stdin' }]),
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
	step('shell-keys', 'Search, map, and commands', 'Ctrl-P inserts a node. Shift-B collapses the library. Find supports regexp, highlight, and a dry run. Map view moves the canvas. Search hits blink. History can restore a deleted node. Backup is in the View menu.', [
		{ id: 'a', type: 'prompt', x: 0, y: 0, props: { text: 'Find this sentence on the canvas.' } },
		{ id: 'b', type: 'output', x: 460, y: 0 },
	], [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'input' }]),
	{
		id: 'data-desk',
		title: 'Data desk',
		blurb: 'CSV goes through select, a new column, a chart, concat, grep, a short wait, a view, a file, Postgres, and SQLite.',
		nodes: [
			{ id: 'csv', type: 'prompt', x: 0, y: 0, props: { text: CSV } },
			{ id: 'pick', type: 'table', x: 460, y: 0, props: { format: 'csv', op: 'select', columns: 'name,score' } },
			{ id: 'col', type: 'table', x: 980, y: 0, props: { format: 'csv', op: 'newcol', expr: 'upper(name)', name: 'label' } },
			{ id: 'bars', type: 'chart', x: 1500, y: 0, props: { format: 'csv', kind: 'bar', xCol: 'name', yCol: 'score' } },
			{ id: 'title', type: 'prompt', x: 0, y: 420, props: { text: 'Score table' } },
			{ id: 'join', type: 'prompt_concat', x: 460, y: 420, props: { separator: '\n' } },
			{ id: 'grep', type: 'local_tool', x: 980, y: 420, props: { tool: 'grep', args: 'ada' } },
			{ id: 'wait', type: 'sleep', x: 1500, y: 420, props: { ms: 100 } },
			{ id: 'view', type: 'output', x: 0, y: 840 },
			{ id: 'file', type: 'save', x: 460, y: 840, props: { fileName: 'scores.csv' } },
			{ id: 'sql', type: 'postgres', x: 980, y: 840, props: { sql: "SELECT '$input' AS src;" } },
			{ id: 'lite', type: 'sqlite_in', x: 1500, y: 840, props: { sql: 'SELECT 1 AS ready;' } },
		],
		wires: [
			{ from: 'csv', fromPort: 'output', to: 'pick', toPort: 'data' },
			{ from: 'pick', fromPort: 'output', to: 'col', toPort: 'data' },
			{ from: 'col', fromPort: 'output', to: 'bars', toPort: 'data' },
			{ from: 'title', fromPort: 'output', to: 'join', toPort: 'prefix' },
			{ from: 'col', fromPort: 'output', to: 'join', toPort: 'main' },
			{ from: 'col', fromPort: 'output', to: 'grep', toPort: 'stdin' },
			{ from: 'grep', fromPort: 'output', to: 'wait', toPort: 'input' },
			{ from: 'wait', fromPort: 'output', to: 'view', toPort: 'input' },
			{ from: 'join', fromPort: 'output', to: 'file', toPort: 'input' },
			{ from: 'csv', fromPort: 'output', to: 'sql', toPort: 'input' },
			{ from: 'csv', fromPort: 'output', to: 'lite', toPort: 'input' },
		],
	},
	{
		id: 'media-desk',
		title: 'Media and models desk',
		blurb: 'A page address feeds video and HTTP. The body waits, then wc counts lines. A file hash and a URL node sit beside a raw model call and a summary.',
		nodes: [
			{ id: 'url', type: 'prompt', x: 0, y: 0, props: { text: 'https://example.com' } },
			{ id: 'clip', type: 'video', x: 460, y: 0, props: { autoplay: false } },
			{ id: 'fetch', type: 'http', x: 980, y: 0, props: { method: 'GET', extractText: true } },
			{ id: 'wait', type: 'sleep', x: 1500, y: 0, props: { ms: 100 } },
			{ id: 'lines', type: 'local_tool', x: 0, y: 420, props: { tool: 'wc', args: '-l' } },
			{ id: 'site', type: 'url_in', x: 460, y: 420, props: { url: 'www.example.com', fetchBody: false } },
			{ id: 'file', type: 'file_in', x: 980, y: 420, props: { mode: 'path', path: '/etc/hostname', action: 'sha256' } },
			{ id: 'task', type: 'prompt', x: 1500, y: 420, props: { text: 'Say hello in one line.' } },
			{ id: 'sum', type: 'summarize', x: 0, y: 840 },
			{ id: 'raw', type: 'raw_model', x: 460, y: 840, props: { url: 'http://127.0.0.1:11434/v1', model: 'llama3.2' } },
		],
		wires: [
			{ from: 'url', fromPort: 'output', to: 'clip', toPort: 'url' },
			{ from: 'url', fromPort: 'output', to: 'fetch', toPort: 'url' },
			{ from: 'fetch', fromPort: 'output', to: 'wait', toPort: 'input' },
			{ from: 'wait', fromPort: 'output', to: 'lines', toPort: 'stdin' },
			{ from: 'fetch', fromPort: 'output', to: 'sum', toPort: 'input' },
			{ from: 'task', fromPort: 'output', to: 'raw', toPort: 'prompt' },
		],
	},
]

export function exampleCovers(): string[] {
	return [...new Set(EXAMPLES.flatMap((example) => example.nodes.map((node) => node.type)))].sort()
}
