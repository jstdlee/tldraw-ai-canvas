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
	http: { in: ['url', 'body', 'request'], out: ['output'], fields: ['method', 'url', 'query', 'headers', 'body', 'auth', 'authValue', 'extractText'] },
	download: { in: ['url'], out: ['output'], fields: ['url', 'fileName'] },
	net_tool: { in: ['target'], out: ['output'], fields: ['tool', 'target', 'option'] },
	postgres: { in: ['input'], out: ['output'], fields: ['mode', 'sql', 'csv', 'sourceUrl'] },
	text_ai: { in: ['input', 'model', 'system', 'params'], out: ['output'], fields: ['operation', 'option', 'instruction', 'model', 'system', 'promptOverride'] },
	generate_text: { in: ['input', 'prompt', 'model', 'system', 'params'], out: ['output'], fields: ['model', 'system', 'promptText'] },
	chat: { in: ['parent', 'attach', 'model', 'system', 'params'], out: ['output'], fields: ['userMessage', 'model', 'system'] },
	model_source: { in: [], out: ['model', 'modelId', 'baseURL'], fields: ['baseURL', 'keyRef', 'model', 'filter', 'kind'] },
	summarize: { in: ['input'], out: ['output'], fields: ['focus', 'model', 'system'] },
	jev: { in: ['context', 'question', 'input'], out: ['output', 'probs', 'final'], fields: ['kind', 'question', 'options', 'filter'] },
	decision_switch: {
		in: ['decision', 'value'],
		out: ['yes', 'no', 'unsure', 'other'],
		fields: ['mode', 'threshold', 'margin', 'options', 'bands'],
	},
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
	for_each: { in: ['list', 'result'], out: ['item', 'output'], fields: ['noResult'] },
	router: { in: ['input'], out: ['out_0', 'out_1', 'out_2'], fields: ['outputCount'] },
	code: { in: ['a', 'b', 'c', 'd'], out: ['output', 'out2', 'out3'], fields: ['lang', 'code', 'inputCount', 'outputCount', 'inputNames', 'outputNames'] },
	subgraph: { in: [], out: [], fields: ['title'] },
	output: { in: ['input'], out: ['output'], fields: ['kind'] },
	save: { in: ['input'], out: ['output'], fields: ['fileName'] },
	table: { in: ['data', 'extra'], out: ['output'], fields: ['text', 'format', 'op', 'columns', 'columns2', 'column', 'expr', 'pattern', 'name', 'totals'] },
	chart: {
		in: ['data'],
		out: ['output'],
		fields: [
			'kind', 'xCol', 'yCol', 'text', 'dualScale', 'series', 'aggregate', 'stack', 'sort', 'top', 'otherRow',
			'bins', 'title', 'xLabel', 'yLabel', 'labels', 'smooth',
		],
	},
	profile: { in: ['data'], out: ['output'], fields: ['text'] },
	database: { in: ['sql', 'rows'], out: ['output', 'schema'], fields: ['sql', 'source'] },
	openrouter: { in: [], out: ['output'], fields: ['model'] },
	raw_model: { in: ['prompt', 'model'], out: ['output'], fields: ['url', 'model', 'keyRef', 'system', 'temperature', 'thinking', 'maxTokens'] },
	video: { in: ['url'], out: ['output'], fields: ['url', 'autoplay'] },
	file_in: { in: ['url'], out: ['output'], fields: ['source', 'url', 'asText', 'action'] },
	url_in: { in: [], out: ['output'], fields: ['url', 'fetchBody'] },
	sleep: { in: ['input'], out: ['output'], fields: ['ms'] },
	image_gen: { in: ['prompt', 'image', 'model', 'system', 'params'], out: ['output', 'images'], fields: ['model', 'prompt', 'n', 'size', 'negative', 'seed'] },
	web_search: {
		in: ['query'],
		out: ['output', 'results', 'urls', 'answer'],
		fields: ['provider', 'query', 'count', 'tavilyDepth', 'tavilyIncludeAnswer', 'exaIncludeText', 'keyRef'],
	},
	table_view: { in: ['data'], out: ['output', 'json'], fields: ['text'] },
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
