/**
 * WP50: embeddings, speech to text and text to speech through OpenAI-compatible endpoints
 * (`/v1/embeddings`, `/v1/audio/transcriptions`, `/v1/audio/speech`). OpenAI, Magpie, Ollama,
 * LM Studio, vLLM, Kokoro-FastAPI and others serve these. Keys stay on the server.
 */
import { randomBytes } from 'node:crypto'
import { cloudflareBase, ModelConfig, ProviderConfig } from '../shared/aiConfig'
import { ConfigError } from './config'
import { MAX_FILE_BYTES, readFile, saveFile } from './files'
import { describeProviderError } from './imageGen'

const TIMEOUT_MS = 180_000
/** OpenAI's own upload limit for transcriptions. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const EMBED_BATCH = 64

type Job = 'embeddings' | 'speech to text' | 'text to speech'

/** The `/v1` base URL of a provider that speaks the OpenAI REST API. */
export function openAIBase(provider: ProviderConfig, job: Job): string {
	const base = provider.baseURL?.replace(/\/+$/, '')
	switch (provider.kind) {
		case 'openai-compatible':
			if (!base) throw new ConfigError(`Provider "${provider.name}" needs a base URL.`)
			return base
		case 'openai':
			return base || 'https://api.openai.com/v1'
		case 'cloudflare':
			if (job !== 'embeddings') break
			if (!provider.accountId) throw new ConfigError(`Provider "${provider.name}" needs a Cloudflare account id.`)
			return `${cloudflareBase(provider.accountId)}/v1`
	}
	throw new ConfigError(
		`Provider "${provider.name}" (${provider.kind}) cannot do ${job}. Use an OpenAI-compatible provider (OpenAI, Ollama, Magpie…).`
	)
}

function authHeaders(provider: ProviderConfig): Record<string, string> {
	return provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}
}

function withTimeout(signal: AbortSignal | undefined): AbortSignal {
	return signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS)
}

async function failure(res: Response, what: string): Promise<ConfigError> {
	const text = await res.text().catch(() => '')
	let body: unknown = text
	try {
		body = JSON.parse(text)
	} catch {
		// Plain-text error body.
	}
	const message = typeof body === 'string' && body.trim() ? body.trim().slice(0, 300) : describeProviderError(body, res.status)
	return new ConfigError(`${what} failed: ${message}`)
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/** Embed texts in batches; returns one vector per text, in order. */
export async function embedTexts(
	provider: ProviderConfig,
	model: ModelConfig,
	texts: string[],
	signal?: AbortSignal
): Promise<number[][]> {
	const base = openAIBase(provider, 'embeddings')
	const out: number[][] = []
	for (let i = 0; i < texts.length; i += EMBED_BATCH) {
		const batch = texts.slice(i, i + EMBED_BATCH)
		const res = await fetch(`${base}/embeddings`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...authHeaders(provider) },
			body: JSON.stringify({ model: model.model, input: batch }),
			signal: withTimeout(signal),
		})
		if (!res.ok) throw await failure(res, 'Embeddings')
		out.push(...parseEmbeddingResponse(await res.json(), batch.length))
	}
	return out
}

/** `{ data: [{ index, embedding }] }` → vectors in input order. */
export function parseEmbeddingResponse(json: any, count: number): number[][] {
	const data: any[] = Array.isArray(json?.data) ? json.data : []
	const sorted = [...data].sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0))
	const vectors = sorted.map((d) => d?.embedding).filter((v): v is number[] => Array.isArray(v))
	if (vectors.length !== count) {
		throw new ConfigError(`Embeddings: expected ${count} vectors, got ${vectors.length}. Is this an embedding model?`)
	}
	return vectors
}

// ---------------------------------------------------------------------------
// Speech to text
// ---------------------------------------------------------------------------

export interface AudioFile {
	bytes: Uint8Array
	mime: string
	name: string
}

const AUDIO_EXT: Record<string, string> = {
	'audio/wav': 'wav',
	'audio/x-wav': 'wav',
	'audio/wave': 'wav',
	'audio/mpeg': 'mp3',
	'audio/mp3': 'mp3',
	'audio/mp4': 'm4a',
	'audio/x-m4a': 'm4a',
	'audio/ogg': 'ogg',
	'audio/webm': 'webm',
	'video/webm': 'webm',
	'video/mp4': 'mp4',
	'audio/flac': 'flac',
}

function extFor(mime: string) {
	return AUDIO_EXT[mime.split(';')[0].trim().toLowerCase()] ?? 'wav'
}

/**
 * Load audio from a data URL, a stored file (`/api/files/<id>`, also the first line of a Read
 * from binary-file output), or an http(s) URL.
 */
export async function resolveAudio(source: string, signal?: AbortSignal): Promise<AudioFile> {
	const value = (source ?? '').trim().split(/\r?\n/)[0].trim()
	if (!value) throw new ConfigError('No audio. Record, upload or wire an audio file.')
	if (value.startsWith('data:')) {
		const comma = value.indexOf(',')
		const header = value.slice(0, comma)
		const data = value.slice(comma + 1)
		const mime = header.match(/^data:([^;,]+)/)?.[1] ?? 'audio/wav'
		const bytes = header.includes(';base64') ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8')
		return checkSize({ bytes, mime, name: `audio.${extFor(mime)}` })
	}
	const local = value.match(/^(?:https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)?\/api\/files\/([A-Za-z0-9_-]+)/)
	if (local) {
		const file = readFile(local[1])
		if (!file) throw new ConfigError(`Audio file not found: ${value}`)
		const name = /\.[a-z0-9]{2,4}$/i.test(file.name) ? file.name : `${file.name}.${extFor(file.mime)}`
		return checkSize({ bytes: file.bytes, mime: file.mime, name })
	}
	if (/^https?:\/\//i.test(value)) {
		const res = await fetch(value, { signal: withTimeout(signal) })
		if (!res.ok) throw new ConfigError(`Downloading the audio failed: HTTP ${res.status}`)
		const length = Number(res.headers.get('content-length') ?? 0)
		if (length > MAX_AUDIO_BYTES) throw new ConfigError('The audio is larger than 25 MB.')
		const mime = res.headers.get('content-type')?.split(';')[0] || 'audio/mpeg'
		const last = new URL(value).pathname.split('/').pop() || ''
		const name = /\.[a-z0-9]{2,4}$/i.test(last) ? last : `audio.${extFor(mime)}`
		return checkSize({ bytes: new Uint8Array(await res.arrayBuffer()), mime, name })
	}
	throw new ConfigError('Audio must be a file from Load file / Read from, a recording, a data URL or a web URL.')
}

function checkSize(file: AudioFile): AudioFile {
	if (file.bytes.byteLength > MAX_AUDIO_BYTES) throw new ConfigError('The audio is larger than 25 MB.')
	if (!file.bytes.byteLength) throw new ConfigError('The audio file is empty.')
	return file
}

export interface TranscriptSegment {
	start: number
	end: number
	text: string
}

export interface Transcript {
	text: string
	language?: string
	segments?: TranscriptSegment[]
}

export function parseTranscriptResponse(json: any): Transcript {
	if (typeof json === 'string') return { text: json.trim() }
	const text = typeof json?.text === 'string' ? json.text.trim() : ''
	const segments: TranscriptSegment[] | undefined = Array.isArray(json?.segments)
		? json.segments
				.filter((s: any) => s && typeof s.text === 'string')
				.map((s: any) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text).trim() }))
		: undefined
	return {
		text,
		...(typeof json?.language === 'string' ? { language: json.language } : {}),
		...(segments && segments.length ? { segments } : {}),
	}
}

/**
 * POST the audio to `/audio/transcriptions`. Asks for `verbose_json` (segments with
 * timestamps); a server that refuses it (e.g. gpt-4o-transcribe) is asked again for `json`.
 */
export async function transcribeAudio(
	provider: ProviderConfig,
	model: ModelConfig,
	audio: AudioFile,
	options: { language?: string } = {},
	signal?: AbortSignal
): Promise<Transcript> {
	const base = openAIBase(provider, 'speech to text')
	const send = async (format: 'verbose_json' | 'json') => {
		const form = new FormData()
		form.append('file', new Blob([audio.bytes as unknown as BlobPart], { type: audio.mime }), audio.name)
		form.append('model', model.model)
		form.append('response_format', format)
		if (format === 'verbose_json') form.append('timestamp_granularities[]', 'segment')
		const language = options.language?.trim()
		if (language && language !== 'auto') form.append('language', language)
		return fetch(`${base}/audio/transcriptions`, {
			method: 'POST',
			headers: authHeaders(provider),
			body: form,
			signal: withTimeout(signal),
		})
	}
	let res = await send('verbose_json')
	if (res.status === 400 || res.status === 422) {
		const retry = await send('json')
		if (retry.ok) res = retry
	}
	if (!res.ok) throw await failure(res, 'Speech to text')
	const type = res.headers.get('content-type') ?? ''
	return parseTranscriptResponse(type.includes('json') ? await res.json() : await res.text())
}

// ---------------------------------------------------------------------------
// Text to speech
// ---------------------------------------------------------------------------

export type SpeechFormat = 'mp3' | 'wav'

export const SPEECH_MIME: Record<SpeechFormat, string> = { mp3: 'audio/mpeg', wav: 'audio/wav' }

/** OpenAI's voices: offered as suggestions when a provider does not list its own. */
export const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']

export function buildSpeechBody(model: string, text: string, voice: string, format: SpeechFormat) {
	return { model, input: text, voice: voice.trim() || 'alloy', response_format: format }
}

/** POST to `/audio/speech`; returns the audio bytes. */
export async function synthesizeSpeech(
	provider: ProviderConfig,
	model: ModelConfig,
	params: { text: string; voice?: string; format?: SpeechFormat },
	signal?: AbortSignal
): Promise<{ bytes: Uint8Array; mime: string }> {
	const text = params.text?.trim()
	if (!text) throw new ConfigError('No text to speak.')
	const format: SpeechFormat = params.format === 'wav' ? 'wav' : 'mp3'
	const base = openAIBase(provider, 'text to speech')
	const res = await fetch(`${base}/audio/speech`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authHeaders(provider) },
		body: JSON.stringify(buildSpeechBody(model.model, text, params.voice ?? '', format)),
		signal: withTimeout(signal),
	})
	if (!res.ok) throw await failure(res, 'Text to speech')
	const bytes = new Uint8Array(await res.arrayBuffer())
	if (!bytes.byteLength) throw new ConfigError('Text to speech returned no audio.')
	if (bytes.byteLength > MAX_FILE_BYTES) throw new ConfigError('The audio is larger than 50 MB.')
	const type = res.headers.get('content-type')?.split(';')[0]
	return { bytes, mime: type && type.startsWith('audio/') ? type : SPEECH_MIME[format] }
}

/** Save speech in the file store (DATA_DIR/files, like uploads); served at /api/files/<id>. */
export function saveSpeech(bytes: Uint8Array, mime: string, format: SpeechFormat): { url: string; name: string; size: number } {
	const id = `speech_${Date.now()}_${randomBytes(4).toString('hex')}`
	const name = `${id}.${format}`
	saveFile(id, bytes, mime, name)
	return { url: `/api/files/${id}`, name, size: bytes.byteLength }
}

/** `{ voices: [...] }` with strings or `{ id | name | voice_id }` items → names. */
export function parseVoicesResponse(json: any): string[] {
	const list: unknown[] = Array.isArray(json) ? json : Array.isArray(json?.voices) ? json.voices : Array.isArray(json?.data) ? json.data : []
	const names = list
		.map((v: any) => (typeof v === 'string' ? v : (v?.id ?? v?.voice_id ?? v?.name)))
		.filter((v): v is string => typeof v === 'string' && !!v.trim())
	return [...new Set(names)]
}

/**
 * The voices a TTS model offers: the provider's own list (`GET /audio/voices`, served by
 * Kokoro-FastAPI and others) when it has one; else OpenAI's voices for OpenAI-style models.
 */
export async function listVoices(provider: ProviderConfig, model: ModelConfig, signal?: AbortSignal): Promise<string[]> {
	const base = openAIBase(provider, 'text to speech')
	try {
		const res = await fetch(`${base}/audio/voices`, {
			headers: authHeaders(provider),
			signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
		})
		if (res.ok) {
			const voices = parseVoicesResponse(await res.json())
			if (voices.length) return voices
		}
	} catch {
		// No voice list on this server: fall through to the known names.
	}
	return provider.kind === 'openai' || /(tts|gpt-4o)/i.test(model.model) ? OPENAI_VOICES : []
}
