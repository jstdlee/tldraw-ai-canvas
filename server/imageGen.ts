/**
 * Image generation across providers: OpenAI / generic OpenAI-compatible
 * (images/generations, or images/edits with reference images), OpenRouter
 * (chat/completions with modalities), and Google (Gemini image models or
 * Imagen's predict endpoint). Keys stay on the server; the node only ever
 * sees a model key and gets back /api/images/… URLs.
 */

import { ModelConfig, ProviderConfig } from '../shared/aiConfig'
import { ConfigError } from './config'
import { importRemoteImage, resolveImage, saveImage } from './images'

export interface ImageGenParams {
	prompt: string
	n: number
	/** '1024x1024' | '1536x1024' | '1024x1536' | 'auto' */
	size?: string
	/** Reference images: data URLs, /api/images/… URLs, or http(s) URLs. */
	images?: string[]
	negative?: string
	seed?: number
}

export interface ImageGenResult {
	images: string[]
	usage?: unknown
}

const TIMEOUT_MS = 120_000

function baseOf(provider: ProviderConfig, fallback: string) {
	return provider.baseURL?.replace(/\/+$/, '') || fallback
}

export function isOpenRouterProvider(provider: ProviderConfig): boolean {
	if (provider.kind !== 'openai-compatible' || !provider.baseURL) return false
	try {
		return /(^|\.)openrouter\.ai$/i.test(new URL(provider.baseURL).hostname)
	} catch {
		return false
	}
}

// ---------------------------------------------------------------------------
// Request body builders (pure; also used by tests)
// ---------------------------------------------------------------------------

export function buildOpenAIImageBody(model: string, params: ImageGenParams): Record<string, unknown> {
	return {
		model,
		prompt: params.prompt,
		n: Math.max(1, Math.min(8, params.n || 1)),
		...(params.size && params.size !== 'auto' ? { size: params.size } : {}),
		response_format: 'b64_json',
	}
}

export function buildOpenRouterImageBody(model: string, params: ImageGenParams): Record<string, unknown> {
	const content: Record<string, unknown>[] = [{ type: 'text', text: params.prompt }]
	for (const image of params.images ?? []) {
		content.push({ type: 'image_url', image_url: { url: image } })
	}
	return {
		model,
		messages: [{ role: 'user', content }],
		modalities: ['image', 'text'],
	}
}

/** '1024x1536' etc → the aspect ratio Imagen's `parameters.aspectRatio` wants. */
export function sizeToAspectRatio(size: string | undefined): string {
	const map: Record<string, string> = {
		'1024x1024': '1:1',
		'1536x1024': '3:2',
		'1024x1536': '2:3',
	}
	return (size && map[size]) || '1:1'
}

export function buildImagenBody(params: ImageGenParams): Record<string, unknown> {
	return {
		instances: [{ prompt: params.prompt }],
		parameters: {
			sampleCount: Math.max(1, Math.min(8, params.n || 1)),
			aspectRatio: sizeToAspectRatio(params.size),
			...(params.negative ? { negativePrompt: params.negative } : {}),
			...(typeof params.seed === 'number' ? { seed: params.seed } : {}),
		},
	}
}

function dataUrlParts(dataUrl: string): { mime: string; data: string } | null {
	const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
	return match ? { mime: match[1], data: match[2] } : null
}

export function buildGeminiImageBody(params: ImageGenParams): Record<string, unknown> {
	const parts: Record<string, unknown>[] = [{ text: params.prompt }]
	for (const image of params.images ?? []) {
		const parsed = dataUrlParts(image)
		if (parsed) parts.push({ inlineData: { mimeType: parsed.mime, data: parsed.data } })
	}
	return {
		contents: [{ role: 'user', parts }],
		generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
	}
}

// ---------------------------------------------------------------------------
// Response parsers (pure; also used by tests). Each returns image sources:
// data URLs, http(s) URLs, or bare base64 (OpenAI b64_json has no prefix).
// ---------------------------------------------------------------------------

export interface OpenAIImageItem {
	b64?: string
	url?: string
}

export function parseOpenAIImageResponse(data: any): OpenAIImageItem[] {
	const items = data?.data ?? []
	return items.map((item: any) => ({ b64: item.b64_json, url: item.url })).filter((i: OpenAIImageItem) => i.b64 || i.url)
}

export function parseOpenRouterImageResponse(data: any): string[] {
	const images = data?.choices?.[0]?.message?.images ?? []
	return images.map((img: any) => img?.image_url?.url).filter((u: unknown): u is string => typeof u === 'string' && !!u)
}

export function parseGeminiImageResponse(data: any): string[] {
	const parts = data?.candidates?.[0]?.content?.parts ?? []
	return parts
		.filter((p: any) => p?.inlineData?.data)
		.map((p: any) => `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`)
}

export function parseImagenResponse(data: any): string[] {
	const predictions = data?.predictions ?? []
	return predictions
		.filter((p: any) => p?.bytesBase64Encoded)
		.map((p: any) => `data:${p.mimeType || 'image/png'};base64,${p.bytesBase64Encoded}`)
}

/** A readable message from a provider error body, without leaking the key. */
export function describeProviderError(body: any, status: number): string {
	const msg = body?.error?.message ?? body?.error ?? body?.message
	if (typeof msg === 'string' && msg.trim()) return msg.trim()
	return `Provider error (HTTP ${status})`
}

// ---------------------------------------------------------------------------
// Network calls + local storage
// ---------------------------------------------------------------------------

async function storeImageSources(sources: string[]): Promise<string[]> {
	const out: string[] = []
	for (const src of sources) {
		if (src.startsWith('data:')) {
			const image = await resolveImage(src)
			out.push(saveImage(image.bytes, image.mime))
		} else if (/^https?:\/\//i.test(src)) {
			out.push(await importRemoteImage(src))
		} else {
			// Bare base64 (no data: prefix), e.g. some OpenAI-compatible servers.
			out.push(saveImage(Buffer.from(src, 'base64'), 'image/png'))
		}
	}
	return out
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
	const json = await res.json().catch(() => ({}))
	if (!res.ok) throw new ConfigError(describeProviderError(json, res.status))
	return json
}

async function openAIEditImages(
	base: string,
	headers: Record<string, string>,
	model: string,
	params: ImageGenParams
): Promise<any> {
	const form = new FormData()
	form.append('model', model)
	form.append('prompt', params.prompt)
	form.append('n', String(Math.max(1, Math.min(8, params.n || 1))))
	if (params.size && params.size !== 'auto') form.append('size', params.size)
	for (const image of params.images ?? []) {
		const resolved = await resolveImage(image)
		form.append('image[]', new Blob([resolved.bytes as unknown as BlobPart], { type: resolved.mime }), 'reference.png')
	}
	const res = await fetch(`${base}/images/edits`, {
		method: 'POST',
		headers,
		body: form,
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
	const json = await res.json().catch(() => ({}))
	if (!res.ok) throw new ConfigError(describeProviderError(json, res.status))
	return json
}

/** Generate N images with the given model/provider. Returns local /api/images/… URLs. */
export async function generateImage(
	provider: ProviderConfig,
	model: ModelConfig,
	params: ImageGenParams
): Promise<ImageGenResult> {
	if (!params.prompt.trim()) throw new ConfigError('Write a prompt first')

	if (provider.kind === 'google') {
		const base = baseOf(provider, 'https://generativelanguage.googleapis.com/v1beta')
		const headers = { 'x-goog-api-key': provider.apiKey ?? '' }
		const isImagen = /^imagen-/i.test(model.model)
		if (isImagen) {
			const json = await postJson(`${base}/models/${model.model}:predict`, headers, buildImagenBody(params))
			return { images: await storeImageSources(parseImagenResponse(json)) }
		}
		const images: string[] = []
		const calls = Math.max(1, Math.min(8, params.n || 1))
		for (let i = 0; i < calls; i++) {
			const json = await postJson(`${base}/models/${model.model}:generateContent`, headers, buildGeminiImageBody(params))
			images.push(...parseGeminiImageResponse(json))
		}
		return { images: await storeImageSources(images) }
	}

	const authHeaders: Record<string, string> = provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}

	if (isOpenRouterProvider(provider)) {
		const base = baseOf(provider, 'https://openrouter.ai/api/v1')
		const images: string[] = []
		const calls = Math.max(1, Math.min(8, params.n || 1))
		for (let i = 0; i < calls; i++) {
			const json = await postJson(`${base}/chat/completions`, authHeaders, buildOpenRouterImageBody(model.model, params))
			images.push(...parseOpenRouterImageResponse(json))
		}
		if (!images.length) throw new ConfigError('The model did not return an image. Pick an image-capable OpenRouter model.')
		return { images: await storeImageSources(images) }
	}

	// openai, or a generic openai-compatible server (custom URL).
	const base = baseOf(provider, 'https://api.openai.com/v1')
	if (params.images?.length) {
		const json = await openAIEditImages(base, authHeaders, model.model, params)
		const items = parseOpenAIImageResponse(json)
		const sources = items.map((item) => (item.b64 ? `data:image/png;base64,${item.b64}` : item.url!))
		return { images: await storeImageSources(sources) }
	}
	const json = await postJson(`${base}/images/generations`, authHeaders, buildOpenAIImageBody(model.model, params))
	const items = parseOpenAIImageResponse(json)
	const sources = items.map((item) => (item.b64 ? `data:image/png;base64,${item.b64}` : item.url!))
	return { images: await storeImageSources(sources) }
}
