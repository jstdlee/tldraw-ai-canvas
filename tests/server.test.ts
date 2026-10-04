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
const { readImage, saveImage } = await import('../server/images')
const { loadConfig, mergeClientConfig, reloadConfig, saveConfig, toPublicConfig, resolveModel } = await import(
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
		expect(guessCapabilities('openai', 'gpt-image-1')).toEqual([])
		expect(guessCapabilities('openai-compatible', 'text-embedding-3-small')).toEqual([])
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
		expect(getDefaultModelKey(config, 'vision')).toBeUndefined()
	})
})

describe('older configs', () => {
	it('drop image providers and image jobs', async () => {
		const { writeFileSync, mkdirSync } = await import('node:fs')
		mkdirSync(process.env.DATA_DIR!, { recursive: true })
		writeFileSync(
			join(process.env.DATA_DIR!, 'ai-config.json'),
			JSON.stringify({
				providers: [
					{ id: 'comfy', name: 'ComfyUI', kind: 'comfyui', enabled: true },
					{ id: 'm', name: 'Magpie', kind: 'openai-compatible', baseURL: 'http://x/v1', enabled: true },
				],
				models: [
					{ key: 'comfy/sdxl', providerId: 'comfy', model: 'sdxl', label: 'SDXL', capabilities: ['image'] },
					{ key: 'm/g', providerId: 'm', model: 'g', label: 'G', capabilities: ['chat', 'image', 'vision'] },
				],
				defaults: { image: 'comfy/sdxl', chat: 'm/g' },
			})
		)
		const config = reloadConfig()
		expect(config.providers.map((p) => p.id)).toEqual(['m'])
		expect(config.models).toEqual([
			{ key: 'm/g', providerId: 'm', model: 'g', label: 'G', capabilities: ['chat', 'vision'] },
		])
		expect(config.defaults).toEqual({ chat: 'm/g' })
	})
})

describe('image store', () => {
	it('stores and reads images by id', () => {
		const url = saveImage(new Uint8Array([137, 80, 78, 71]), 'image/png')
		expect(url).toMatch(/^\/api\/images\/img_/)
		expect(readImage(url.split('/').pop()!)?.mime).toBe('image/png')
		expect(readImage('../../etc/passwd')).toBeNull()
	})
})

describe('repository hygiene', () => {
	it('does not ship the online-only country lookup', () => {
		const modes = readFileSync(join(__dirname, '../client/modes/AgentModeDefinitions.ts'), 'utf8')
		expect(modes).not.toContain('CountryInfo')
	})
})
