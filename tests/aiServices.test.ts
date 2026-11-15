import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, IncomingMessage, Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Keep test data out of the real data/ folder. Must be set before importing the server modules.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'ai-canvas-wp50-'))

const { normalizeAIConfig, getDefaultModelKey } = await import('../shared/aiConfig')
const { reloadConfig, resolveModel, saveConfig } = await import('../server/config')
const { readFile, saveFile } = await import('../server/files')
const {
	embedTexts,
	listVoices,
	OPENAI_VOICES,
	openAIBase,
	resolveAudio,
	saveSpeech,
	synthesizeSpeech,
	transcribeAudio,
} = await import('../server/aiServices')

/** A fake OpenAI-compatible server: records each request, answers like the real API. */
interface Seen {
	method: string
	path: string
	auth?: string
	type?: string
	body: Buffer
}
const seen: Seen[] = []
let server: Server
let base = ''
let refuseVerbose = false

function readBody(req: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve) => {
		const parts: Buffer[] = []
		req.on('data', (c) => parts.push(c))
		req.on('end', () => resolve(Buffer.concat(parts)))
	})
}

beforeAll(async () => {
	server = createServer(async (req, res) => {
		const body = await readBody(req)
		const path = (req.url ?? '').replace(/\?.*$/, '')
		seen.push({ method: req.method ?? '', path, auth: req.headers.authorization, type: req.headers['content-type'], body })
		const json = (status: number, value: unknown) => {
			res.writeHead(status, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify(value))
		}
		if (path === '/v1/embeddings') {
			const input = JSON.parse(body.toString()).input as string[]
			// Reverse order on purpose: the client must sort by index.
			return json(200, {
				data: input.map((text, index) => ({ index, embedding: [text.length, index, 1] })).reverse(),
			})
		}
		if (path === '/v1/audio/transcriptions') {
			const form = body.toString('latin1')
			if (refuseVerbose && form.includes('verbose_json')) return json(400, { error: { message: 'response_format verbose_json is not supported' } })
			if (form.includes('verbose_json')) {
				return json(200, {
					text: 'hello world',
					language: 'english',
					segments: [
						{ start: 0, end: 0.5, text: ' hello' },
						{ start: 0.5, end: 1, text: ' world' },
					],
				})
			}
			return json(200, { text: 'hello world' })
		}
		if (path === '/v1/audio/speech') {
			const request = JSON.parse(body.toString())
			if (!request.input) return json(400, { error: { message: 'input is required' } })
			res.writeHead(200, { 'Content-Type': request.response_format === 'wav' ? 'audio/wav' : 'audio/mpeg' })
			return res.end(Buffer.from('RIFF....WAVEfake-audio'))
		}
		if (path === '/v1/audio/voices') return json(200, { voices: ['af_bella', { id: 'am_adam' }] })
		json(404, { error: { message: 'not found' } })
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
	saveConfig({
		providers: [{ id: 'fake', name: 'Fake', kind: 'openai-compatible', baseURL: base, apiKey: 'sk-test', enabled: true }],
		models: [
			{ key: 'fake/emb', providerId: 'fake', model: 'emb', label: 'Emb', capabilities: ['embed'] },
			{ key: 'fake/whisper', providerId: 'fake', model: 'whisper', label: 'Whisper', capabilities: ['stt'] },
			{ key: 'fake/tts', providerId: 'fake', model: 'tts', label: 'TTS', capabilities: ['tts'] },
		],
		defaults: {},
	})
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe('capability config loading (WP50)', () => {
	it('an old config without embed/stt/tts still loads and keeps its models', () => {
		const old = {
			providers: [{ id: 'o', name: 'Ollama', kind: 'openai-compatible', baseURL: 'http://127.0.0.1:11434/v1', enabled: true }],
			models: [{ key: 'o/qwen3', providerId: 'o', model: 'qwen3', label: 'Qwen3', capabilities: ['chat', 'agent'] }],
			defaults: { chat: 'o/qwen3' },
		}
		const config = normalizeAIConfig(old as never)
		expect(config.models[0].capabilities).toEqual(['chat', 'agent'])
		expect(config.defaults).toEqual({ chat: 'o/qwen3' })
		expect(getDefaultModelKey(config, 'embed')).toBeUndefined()
		expect(getDefaultModelKey(config, 'chat')).toBe('o/qwen3')
	})

	it('unknown capability names and jobs are ignored, not an error', () => {
		const config = normalizeAIConfig({
			providers: [{ id: 'o', name: 'O', kind: 'openai-compatible', baseURL: 'http://x/v1', enabled: true }],
			models: [{ key: 'o/m', providerId: 'o', model: 'm', label: 'M', capabilities: ['chat', 'rerank', 'embed'] as never }],
			defaults: { rerank: 'o/m', embed: 'o/m' } as never,
		})
		expect(config.models[0].capabilities).toEqual(['chat', 'embed'])
		expect(config.defaults).toEqual({ embed: 'o/m' })
	})

	it('the server loads an old config file from disk', () => {
		const current = reloadConfig()
		// A pre-WP50 file: no embed/stt/tts anywhere, one model without a capability list.
		writeFileSync(
			join(process.env.DATA_DIR!, 'ai-config.json'),
			JSON.stringify({
				providers: [{ id: 'o', name: 'Ollama', kind: 'openai-compatible', baseURL: 'http://127.0.0.1:11434/v1', enabled: true }],
				models: [
					{ key: 'o/qwen3', providerId: 'o', model: 'qwen3', label: 'Qwen3', capabilities: ['chat'] },
					{ key: 'o/old', providerId: 'o', model: 'old', label: 'Old' },
				],
				defaults: { chat: 'o/qwen3', image: '' },
			})
		)
		try {
			const loaded = reloadConfig()
			expect(loaded.models.map((m) => [m.key, m.capabilities])).toEqual([
				['o/qwen3', ['chat']],
				['o/old', []],
			])
			expect(() => resolveModel(undefined, 'embed')).toThrow(/No model for "embed"/)
		} finally {
			saveConfig(current)
		}
	})

	it('resolves a default model for each new capability', () => {
		expect(resolveModel(undefined, 'embed').model.key).toBe('fake/emb')
		expect(resolveModel(undefined, 'stt').model.key).toBe('fake/whisper')
		expect(resolveModel(undefined, 'tts').model.key).toBe('fake/tts')
	})
})

describe('embeddings', () => {
	it('POSTs to /v1/embeddings with the key and returns vectors in input order', async () => {
		const { model, provider } = resolveModel(undefined, 'embed')
		const vectors = await embedTexts(provider, model, ['a', 'bbb', 'cc'])
		expect(vectors).toEqual([
			[1, 0, 1],
			[3, 1, 1],
			[2, 2, 1],
		])
		const request = seen.filter((s) => s.path === '/v1/embeddings').at(-1)!
		expect(request.auth).toBe('Bearer sk-test')
		expect(JSON.parse(request.body.toString())).toEqual({ model: 'emb', input: ['a', 'bbb', 'cc'] })
	})

	it('refuses providers that do not speak the OpenAI API', () => {
		expect(() => openAIBase({ id: 'a', name: 'Claude', kind: 'anthropic', enabled: true }, 'embeddings')).toThrow(/cannot do embeddings/)
	})
})

describe('speech to text', () => {
	const wav = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1')

	it('reads audio from a data URL and from the file store', async () => {
		const fromData = await resolveAudio(`data:audio/wav;base64,${wav.toString('base64')}`)
		expect(fromData.mime).toBe('audio/wav')
		expect(fromData.name).toBe('audio.wav')
		saveFile('clip1', wav, 'audio/wav', 'clip.wav')
		const fromFile = await resolveAudio('/api/files/clip1\n(binary file, 12 B — open the link to download it)')
		expect(Buffer.from(fromFile.bytes).equals(wav)).toBe(true)
		expect(fromFile.name).toBe('clip.wav')
		await expect(resolveAudio('/api/files/missing')).rejects.toThrow(/not found/)
		await expect(resolveAudio('')).rejects.toThrow(/No audio/)
	})

	it('sends multipart audio and returns text and timestamped segments', async () => {
		const { model, provider } = resolveModel(undefined, 'stt')
		const result = await transcribeAudio(provider, model, { bytes: wav, mime: 'audio/wav', name: 'clip.wav' }, { language: 'en' })
		expect(result).toEqual({
			text: 'hello world',
			language: 'english',
			segments: [
				{ start: 0, end: 0.5, text: 'hello' },
				{ start: 0.5, end: 1, text: 'world' },
			],
		})
		const request = seen.filter((s) => s.path === '/v1/audio/transcriptions').at(-1)!
		expect(request.type).toMatch(/^multipart\/form-data/)
		const form = request.body.toString('latin1')
		expect(form).toContain('name="model"\r\n\r\nwhisper')
		expect(form).toContain('name="language"\r\n\r\nen')
		expect(form).toContain('filename="clip.wav"')
	})

	it('asks again for plain json when the server refuses verbose_json', async () => {
		refuseVerbose = true
		try {
			const { model, provider } = resolveModel(undefined, 'stt')
			const result = await transcribeAudio(provider, model, { bytes: wav, mime: 'audio/wav', name: 'clip.wav' })
			expect(result).toEqual({ text: 'hello world' })
		} finally {
			refuseVerbose = false
		}
	})
})

describe('text to speech', () => {
	it('POSTs JSON to /v1/audio/speech and saves a playable file', async () => {
		const { model, provider } = resolveModel(undefined, 'tts')
		const audio = await synthesizeSpeech(provider, model, { text: 'Hello there', voice: 'nova', format: 'wav' })
		expect(audio.mime).toBe('audio/wav')
		const request = seen.filter((s) => s.path === '/v1/audio/speech').at(-1)!
		expect(JSON.parse(request.body.toString())).toEqual({ model: 'tts', input: 'Hello there', voice: 'nova', response_format: 'wav' })
		const saved = saveSpeech(audio.bytes, audio.mime, 'wav')
		expect(saved.url).toMatch(/^\/api\/files\/speech_/)
		const file = readFile(saved.url.split('/').pop()!)
		expect(file?.mime).toBe('audio/wav')
		expect(file?.name.endsWith('.wav')).toBe(true)
	})

	it('refuses empty text before calling the provider', async () => {
		const { model, provider } = resolveModel(undefined, 'tts')
		await expect(synthesizeSpeech(provider, model, { text: '  ' })).rejects.toThrow(/No text/)
	})

	it('lists the provider voices, or OpenAI voices as a fallback', async () => {
		const { model, provider } = resolveModel(undefined, 'tts')
		expect(await listVoices(provider, model)).toEqual(['af_bella', 'am_adam'])
		const openai = { id: 'oa', name: 'OpenAI', kind: 'openai' as const, baseURL: `${base}/nothing`, enabled: true }
		expect(await listVoices(openai, { ...model, model: 'tts-1' })).toEqual(OPENAI_VOICES)
	})
})
