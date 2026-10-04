import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer, Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Keep test data out of the real data/ folder. Must be set before importing the server modules.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'ai-canvas-test-'))

const { stripToJson } = await import('../server/agent/AgentService')
const { closeAndParseJson } = await import('../server/agent/closeAndParseJson')
const { fillComfyWorkflow, generateImage, readImage } = await import('../server/images')
const { loadConfig, mergeClientConfig, saveConfig, toPublicConfig, resolveModel } = await import(
	'../server/config'
)
const { guessCapabilities, getDefaultModelKey } = await import('../shared/aiConfig')
const { stripThinking } = await import('../client/pipeline/api/pipelineApi')

describe('agent reply parsing', () => {
	it('drops preambles, code fences and think blocks before the JSON', () => {
		const reply = '<think>plan the house</think>Sure!\n```json\n{"actions": [{"_type": "think", "text": "hi"}]}\n```'
		expect(closeAndParseJson(stripToJson(reply))).toEqual({ actions: [{ _type: 'think', text: 'hi' }] })
	})

	it('waits while the model is still thinking', () => {
		expect(stripToJson('<think>still going')).toBe('')
	})

	it('parses partial JSON while it streams', () => {
		const partial = closeAndParseJson(stripToJson('{"actions": [{"_type": "create", "intent": "Draw'))
		expect(partial.actions[0]).toMatchObject({ _type: 'create', intent: 'Draw' })
	})
})

describe('chat text', () => {
	it('hides think blocks, closed or still open', () => {
		expect(stripThinking('<think>x</think>Hello')).toBe('Hello')
		expect(stripThinking('Hello <think>half')).toBe('Hello ')
	})
})

describe('capability guesses', () => {
	it('marks vision and image models', () => {
		expect(guessCapabilities('openai-compatible', 'qwen3-vl:8b')).toContain('vision')
		expect(guessCapabilities('openai', 'gpt-image-1')).toEqual(['image'])
		expect(guessCapabilities('comfyui', '4x-UltraSharp.pth')).toEqual(['upscale'])
		expect(guessCapabilities('comfyui', 'sd_xl_base_1.0.safetensors')).toEqual(['image'])
	})
})

describe('config', () => {
	it('never returns keys to the client and keeps them when the client omits them', () => {
		saveConfig({
			providers: [{ id: 'p', name: 'P', kind: 'openai', apiKey: 'sk-secret', enabled: true }],
			models: [{ key: 'p/m', providerId: 'p', model: 'm', label: 'M', capabilities: ['chat'] }],
			defaults: {},
		})
		const pub = toPublicConfig(loadConfig())
		expect(JSON.stringify(pub)).not.toContain('sk-secret')
		expect(pub.providers[0].hasApiKey).toBe(true)

		// Client edits the name only: key is kept.
		const kept = mergeClientConfig({
			...pub,
			providers: [{ ...pub.providers[0], name: 'Renamed' }],
		})
		expect(kept.providers[0]).toMatchObject({ name: 'Renamed', apiKey: 'sk-secret' })

		// Empty string clears the key; models of removed providers are dropped.
		const cleared = mergeClientConfig({ ...pub, providers: [{ ...pub.providers[0], apiKey: '' }] })
		expect(cleared.providers[0].apiKey).toBeUndefined()
		const removed = mergeClientConfig({ ...pub, providers: [] })
		expect(removed.models).toEqual([])
	})

	it('falls back to the default model for a job', () => {
		const config = {
			models: [
				{ key: 'a/x', providerId: 'a', model: 'x', label: 'x', capabilities: ['chat' as const] },
				{ key: 'a/y', providerId: 'a', model: 'y', label: 'y', capabilities: ['chat' as const, 'agent' as const] },
			],
			defaults: { chat: 'a/y' },
		}
		expect(getDefaultModelKey(config, 'chat')).toBe('a/y')
		expect(getDefaultModelKey(config, 'agent')).toBe('a/y')
		expect(getDefaultModelKey(config, 'image')).toBeUndefined()
	})
})

describe('ComfyUI', () => {
	it('fills placeholders and keeps number types', () => {
		const graph = fillComfyWorkflow(
			JSON.stringify({
				'3': { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: '{{steps}}' } },
				'6': { class_type: 'CLIPTextEncode', inputs: { text: 'a photo of {{prompt}}' } },
			}),
			{ seed: 42, steps: 20, prompt: 'a cat' }
		)
		expect(graph['3'].inputs).toEqual({ seed: 42, steps: 20 })
		expect(graph['6'].inputs.text).toBe('a photo of a cat')
	})

	describe('generate against a mock ComfyUI', () => {
		let server: Server
		let submitted: any = null
		const PNG = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			'base64'
		)

		beforeAll(async () => {
			server = createServer((req, res) => {
				let body = ''
				req.on('data', (c) => (body += c))
				req.on('end', () => {
					if (req.url === '/prompt') {
						submitted = JSON.parse(body).prompt
						res.end(JSON.stringify({ prompt_id: 'job1' }))
					} else if (req.url === '/history/job1') {
						res.end(
							JSON.stringify({
								job1: {
									status: { status_str: 'success', completed: true },
									outputs: { save: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } },
								},
							})
						)
					} else if (req.url?.startsWith('/view')) {
						res.setHeader('content-type', 'image/png')
						res.end(PNG)
					} else {
						res.statusCode = 404
						res.end()
					}
				})
			})
			await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
			const port = (server.address() as AddressInfo).port
			saveConfig({
				providers: [
					{ id: 'comfy', name: 'ComfyUI', kind: 'comfyui', baseURL: `http://127.0.0.1:${port}`, enabled: true },
				],
				models: [
					{ key: 'comfy/sdxl.safetensors', providerId: 'comfy', model: 'sdxl.safetensors', label: 'SDXL', capabilities: ['image'] },
				],
				defaults: {},
			})
		})

		afterAll(() => server.close())

		it('submits a checkpoint graph and stores the result locally', async () => {
			expect(resolveModel(null, 'image').model.key).toBe('comfy/sdxl.safetensors')
			const result = await generateImage({ prompt: 'a lighthouse', steps: 8, cfgScale: 5, seed: 7 })
			expect(submitted.ckpt.inputs.ckpt_name).toBe('sdxl.safetensors')
			expect(submitted.pos.inputs.text).toBe('a lighthouse')
			expect(submitted.sample.inputs).toMatchObject({ seed: 7, steps: 8, cfg: 5, denoise: 1 })
			expect(result.imageUrl).toMatch(/^\/api\/images\/img_/)
			const stored = readImage(result.imageUrl.split('/').pop()!)
			expect(Buffer.from(stored!.bytes).equals(PNG)).toBe(true)
		}, 10_000)
	})
})

describe('repository hygiene', () => {
	it('does not ship the online-only country lookup', () => {
		const modes = readFileSync(join(__dirname, '../client/modes/AgentModeDefinitions.ts'), 'utf8')
		expect(modes).not.toContain('CountryInfo')
	})
})
