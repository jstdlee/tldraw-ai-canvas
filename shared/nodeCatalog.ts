/** Ports the agent and the example canvases may wire. */

export interface NodePortList {
	in: string[]
	out: string[]
	fields: string[]
}

export const NODE_PORTS: Record<string, NodePortList> = {
	prompt: { in: [], out: ['output'], fields: ['text'] },
	prompt_concat: { in: ['prefix', 'main', 'suffix'], out: ['output'], fields: ['separator'] },
	text_tool: { in: ['input', 'input2'], out: ['output'], fields: ['op', 'a', 'b'] },
	http: { in: ['url', 'body'], out: ['output'], fields: ['method', 'url', 'query', 'headers', 'body', 'auth', 'authValue', 'extractText'] },
	download: { in: ['url'], out: ['output'], fields: ['url', 'fileName'] },
	net_tool: { in: ['target'], out: ['output'], fields: ['tool', 'target', 'option'] },
	postgres: { in: ['input'], out: ['output'], fields: ['mode', 'sql', 'csv'] },
	text_ai: { in: ['input'], out: ['output'], fields: ['operation', 'option', 'instruction', 'model', 'system'] },
	generate_text: { in: ['input', 'prompt'], out: ['output'], fields: ['model', 'system'] },
	chat: { in: ['parent', 'attach'], out: ['output'], fields: ['userMessage', 'model', 'system'] },
	summarize: { in: ['input'], out: ['output'], fields: ['focus', 'model', 'system'] },
	jev: { in: ['context', 'question', 'input'], out: ['output', 'probs', 'final'], fields: ['kind', 'question', 'options', 'filter'] },
	load_image: { in: [], out: ['output'], fields: ['imageUrl', 'source'] },
	camera: { in: [], out: ['output'], fields: [] },
	capture: { in: [], out: ['output'], fields: [] },
	crop: { in: ['image'], out: ['output'], fields: [] },
	image_resize: { in: ['image'], out: ['output'], fields: [] },
	image_filter: { in: ['image'], out: ['output'], fields: ['brightness', 'contrast', 'saturate', 'preset'] },
	image_tool: { in: ['image'], out: ['output'], fields: ['tool', 'a', 'b'] },
	adjust: { in: ['image'], out: ['output'], fields: [] },
	number: { in: [], out: ['output'], fields: ['value'] },
	random: { in: ['list', 'a', 'b'], out: ['output'], fields: ['mode'] },
	if: { in: ['input', 'test'], out: ['then', 'else'], fields: ['condition', 'operand'] },
	logic: { in: ['a', 'b'], out: ['output'], fields: ['op'] },
	for_each: { in: ['list', 'result'], out: ['item', 'output'], fields: [] },
	router: { in: ['input'], out: ['out_0', 'out_1', 'out_2'], fields: ['outputCount'] },
	code: { in: ['a', 'b', 'c', 'd'], out: ['output', 'out2', 'out3'], fields: ['lang', 'code', 'inputCount', 'outputCount', 'inputNames', 'outputNames'] },
	subgraph: { in: [], out: [], fields: ['title'] },
	output: { in: ['input'], out: ['output'], fields: ['kind'] },
	save: { in: ['input'], out: ['output'], fields: ['fileName'] },
	table: { in: ['data', 'extra'], out: ['output'], fields: ['text', 'format', 'op', 'columns', 'column', 'expr', 'pattern', 'name'] },
	chart: { in: ['data'], out: ['output'], fields: ['kind', 'xCol', 'yCol', 'text'] },
	sqlite_in: { in: ['input'], out: ['output'], fields: ['path', 'sql', 'ask'] },
	openrouter: { in: [], out: ['output'], fields: ['model'] },
	raw_model: { in: ['prompt'], out: ['output'], fields: ['url', 'model', 'system', 'temperature', 'thinking', 'maxTokens'] },
	video: { in: ['url'], out: ['output'], fields: ['url', 'autoplay'] },
	file_in: { in: [], out: ['output'], fields: ['mode', 'path', 'action'] },
	url_in: { in: [], out: ['output'], fields: ['url', 'fetchBody'] },
	local_tool: { in: ['stdin'], out: ['output'], fields: ['tool', 'args'] },
	sleep: { in: ['input'], out: ['output'], fields: ['ms'] },
}

export function catalogPrompt(): string {
	return Object.entries(NODE_PORTS)
		.map(([type, info]) => {
			const inputs = info.in.length ? info.in.join(', ') : 'none'
			const outputs = info.out.length ? info.out.join(', ') : 'none'
			const fields = info.fields.length ? info.fields.join(', ') : 'none'
			return `${type}: inputs [${inputs}]; outputs [${outputs}]; fields [${fields}]`
		})
		.join('\n')
}
