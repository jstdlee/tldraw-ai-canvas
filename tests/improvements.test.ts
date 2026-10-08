import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatCode } from '../shared/codeFormat'
import { EXAMPLES, exampleCovers } from '../shared/examples'
import { buildHttpRequest } from '../shared/httpBuild'
import { applyPreset, FILTER_PRESETS, matchPreset, NO_FILTER } from '../shared/imageFilters'
import { formatLlmUsage, normalizeLlmUsage, takeUsageTrailer } from '../shared/llmUsage'
import { NODE_CATEGORY } from '../shared/nodeGroups'
import { pastePatch } from '../shared/pasteTarget'
import { readPythonResult } from '../shared/pythonSource'
import { missingRunInput } from '../shared/runIssue'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'ai-canvas-improve-'))

const PORTS: Record<string, { inn: string[]; out: string[] }> = {
	prompt: { inn: [], out: ['output'] },
	prompt_concat: { inn: ['prefix', 'main', 'suffix'], out: ['output'] },
	text_tool: { inn: ['input', 'input2'], out: ['output'] },
	http: { inn: ['url', 'body'], out: ['output'] },
	download: { inn: ['url'], out: ['output'] },
	net_tool: { inn: ['target'], out: ['output'] },
	postgres: { inn: ['input'], out: ['output'] },
	generate_text: { inn: ['input', 'prompt'], out: ['output'] },
	chat: { inn: ['parent', 'attach'], out: ['output'] },
	text_ai: { inn: ['input'], out: ['output'] },
	summarize: { inn: ['input'], out: ['output'] },
	jev: { inn: ['context', 'question', 'input'], out: ['output', 'probs', 'final', 'yes', 'no'] },
	load_image: { inn: [], out: ['output'] },
	camera: { inn: [], out: ['output'] },
	capture: { inn: [], out: ['output'] },
	crop: { inn: ['image'], out: ['output'] },
	image_resize: { inn: ['image'], out: ['output'] },
	image_filter: { inn: ['image'], out: ['output'] },
	image_tool: { inn: ['image'], out: ['output'] },
	adjust: { inn: ['image'], out: ['output'] },
	number: { inn: [], out: ['output'] },
	random: { inn: ['list', 'a', 'b'], out: ['output'] },
	if: { inn: ['input', 'test'], out: ['then', 'else'] },
	logic: { inn: ['a', 'b'], out: ['output'] },
	for_each: { inn: ['list', 'result'], out: ['item', 'output'] },
	router: { inn: ['input'], out: ['output', 'out_0', 'out_1', 'out_2'] },
	code: { inn: ['a', 'b', 'c', 'd'], out: ['output', 'out2', 'out3'] },
	subgraph: { inn: [], out: [] },
	output: { inn: ['input'], out: ['output'] },
	save: { inn: ['input'], out: ['output'] },
	table: { inn: ['data', 'extra'], out: ['output'] },
	chart: { inn: ['data'], out: ['output'] },
	sqlite_in: { inn: ['input'], out: ['output'] },
	openrouter: { inn: [], out: ['output'] },
	raw_model: { inn: ['prompt'], out: ['output'] },
	video: { inn: ['url'], out: ['output'] },
	file_in: { inn: [], out: ['output'] },
	url_in: { inn: [], out: ['output'] },
	local_tool: { inn: ['stdin'], out: ['output'] },
	sleep: { inn: ['input'], out: ['output'] },
}

describe('llm usage', () => {
	it('formats tokens, time and tokens per second', () => {
		expect(formatLlmUsage({ inputTokens: 20, outputTokens: 80, ms: 1000 })).toBe('100 tok · 20 in / 80 out · 1.0 s · 80 tok/s')
	})

	it('reads old and new usage names', () => {
		expect(normalizeLlmUsage({ promptTokens: 3, completionTokens: 7 }, 500)).toMatchObject({
			inputTokens: 3,
			outputTokens: 7,
			totalTokens: 10,
			ms: 500,
		})
	})

	it('hides a partial usage trailer', () => {
		expect(takeUsageTrailer('Hello\n\n[usage] {"inputTokens":')).toEqual({ text: 'Hello' })
		expect(takeUsageTrailer('Hello\n\n[usage] {"outputTokens":4}')).toMatchObject({
			text: 'Hello',
			usage: { outputTokens: 4 },
		})
	})
})

describe('http builder', () => {
	it('adds the query and a bearer token', () => {
		const built = buildHttpRequest({
			method: 'get',
			url: 'https://example.com/search',
			query: 'q=cat',
			headers: 'Accept: application/json',
			auth: 'bearer',
			authValue: 'secret',
		})
		expect(built.method).toBe('GET')
		expect(built.url).toBe('https://example.com/search?q=cat')
		expect(built.headers.Authorization).toBe('Bearer secret')
		expect(built.headers.Accept).toBe('application/json')
		expect(built.body).toBeUndefined()
	})
})

describe('image presets', () => {
	it('keeps the selected look and can restore the default', () => {
		const look = applyPreset('JP 90s', { rotate: 90, flipX: true, flipY: false })
		expect(matchPreset(look)).toBe('JP 90s')
		expect(look.rotate).toBe(90)
		expect(matchPreset(NO_FILTER)).toBe('None')
		expect(Object.keys(FILTER_PRESETS)).toEqual(expect.arrayContaining(['JP 90s', 'Kodak Gold', 'Noir', 'Cyber']))
	})
})

describe('paste and missing inputs', () => {
	it('sends a path to the image source and text to the matching field', () => {
		expect(pastePatch({ type: 'load_image', imageUrl: null }, { text: '/tmp/a.png' })).toEqual({ source: '/tmp/a.png' })
		expect(pastePatch({ type: 'load_image', imageUrl: null }, { imageUrl: 'data:image/png;base64,aa' })).toEqual({
			imageUrl: 'data:image/png;base64,aa',
			source: '',
		})
		expect(pastePatch({ type: 'http', url: '' }, { text: 'https://example.com' })).toEqual({ url: 'https://example.com' })
	})

	it('names the missing field', () => {
		expect(missingRunInput({ type: 'http', url: '  ' }, {})).toBe('URL is required')
		expect(missingRunInput({ type: 'load_image', imageUrl: null, source: '' }, {})).toBe('Choose an image, URL, or path')
		expect(missingRunInput({ type: 'net_tool', tool: 'my_ips', target: '' }, {})).toBeNull()
	})
})

describe('code format and python markers', () => {
	it('formats SQL onto separate lines', () => {
		const sql = formatCode('select a from notes where id = 1', 'sql')
		expect(sql.startsWith('SELECT')).toBe(true)
		expect(sql).toContain('\nFROM')
	})

	it('reads the python result markers', () => {
		const parsed = readPythonResult('noise\n___LOG___words: 2\n___RESULT___{"output":"Hi"}')
		expect(parsed.logs).toBe('words: 2')
		expect(parsed.outputs.output).toBe('Hi')
	})
})

describe('examples', () => {
	it('covers every node group member', () => {
		const covered = new Set(exampleCovers())
		for (const type of Object.keys(NODE_CATEGORY)) expect(covered.has(type)).toBe(true)
		expect(NODE_CATEGORY.prompt_concat).toBe('text')
	})

	it('uses real ports and includes two long workflows', () => {
		const long = EXAMPLES.filter((example) => example.nodes.length >= 12)
		expect(long.length).toBeGreaterThanOrEqual(2)
		expect(EXAMPLES.find((example) => example.id === 'article-desk')?.nodes.length).toBeGreaterThanOrEqual(12)
		for (const example of EXAMPLES) {
			const byId = new Map(example.nodes.map((node) => [node.id, node]))
			for (const wire of example.wires) {
				const from = byId.get(wire.from)
				const to = byId.get(wire.to)
				expect(from && PORTS[from.type].out).toContain(wire.fromPort)
				expect(to && PORTS[to.type].inn).toContain(wire.toPort)
			}
		}
	})
})

describe('local image import', () => {
	it('rejects a file that is not an image', async () => {
		const { importLocalImage } = await import('../server/images')
		const file = join(process.env.DATA_DIR!, 'note.txt')
		writeFileSync(file, 'hello')
		expect(() => importLocalImage(file)).toThrow(/png, jpeg, webp, or gif/)
	})
})
