import { describe, expect, it } from 'vitest'
import {
	buildGeminiImageBody,
	buildImagenBody,
	buildOpenAIImageBody,
	buildOpenRouterImageBody,
	describeProviderError,
	isOpenRouterProvider,
	parseGeminiImageResponse,
	parseImagenResponse,
	parseOpenAIImageResponse,
	parseOpenRouterImageResponse,
	sizeToAspectRatio,
} from '../server/imageGen'
import type { ProviderConfig } from '../shared/aiConfig'

describe('image gen request bodies', () => {
	it('builds an OpenAI images/generations body', () => {
		const body = buildOpenAIImageBody('gpt-image-1', { prompt: 'a fox', n: 2, size: '1024x1024' })
		expect(body).toMatchObject({ model: 'gpt-image-1', prompt: 'a fox', n: 2, size: '1024x1024', response_format: 'b64_json' })
	})

	it('omits size when auto', () => {
		const body = buildOpenAIImageBody('gpt-image-1', { prompt: 'a fox', n: 1, size: 'auto' })
		expect(body).not.toHaveProperty('size')
	})

	it('clamps n to 1..8', () => {
		expect(buildOpenAIImageBody('m', { prompt: 'x', n: 50 })).toMatchObject({ n: 8 })
		expect(buildOpenAIImageBody('m', { prompt: 'x', n: 0 })).toMatchObject({ n: 1 })
	})

	it('builds an OpenRouter chat/completions body with modalities and reference images', () => {
		const body = buildOpenRouterImageBody('google/gemini-2.5-flash-image', {
			prompt: 'a fox',
			n: 1,
			images: ['https://example.com/ref.png'],
		}) as any
		expect(body.model).toBe('google/gemini-2.5-flash-image')
		expect(body.modalities).toEqual(['image', 'text'])
		expect(body.messages[0].content).toEqual([
			{ type: 'text', text: 'a fox' },
			{ type: 'image_url', image_url: { url: 'https://example.com/ref.png' } },
		])
	})

	it('maps size to Imagen aspect ratio', () => {
		expect(sizeToAspectRatio('1024x1024')).toBe('1:1')
		expect(sizeToAspectRatio('1536x1024')).toBe('3:2')
		expect(sizeToAspectRatio('1024x1536')).toBe('2:3')
		expect(sizeToAspectRatio(undefined)).toBe('1:1')
	})

	it('builds an Imagen predict body', () => {
		const body = buildImagenBody({ prompt: 'a fox', n: 4, size: '1024x1536', seed: 7, negative: 'blurry' }) as any
		expect(body.instances).toEqual([{ prompt: 'a fox' }])
		expect(body.parameters).toMatchObject({ sampleCount: 4, aspectRatio: '2:3', seed: 7, negativePrompt: 'blurry' })
	})

	it('builds a Gemini generateContent body with inline reference images', () => {
		const body = buildGeminiImageBody({
			prompt: 'a fox',
			n: 1,
			images: ['data:image/png;base64,AAA='],
		}) as any
		expect(body.generationConfig.responseModalities).toEqual(['IMAGE', 'TEXT'])
		expect(body.contents[0].parts).toEqual([{ text: 'a fox' }, { inlineData: { mimeType: 'image/png', data: 'AAA=' } }])
	})
})

describe('image gen response parsers', () => {
	it('parses OpenAI b64_json and url items', () => {
		const items = parseOpenAIImageResponse({ data: [{ b64_json: 'AAA=' }, { url: 'https://x/y.png' }, {}] })
		expect(items).toEqual([{ b64: 'AAA=', url: undefined }, { b64: undefined, url: 'https://x/y.png' }])
	})

	it('parses OpenRouter message images', () => {
		const images = parseOpenRouterImageResponse({
			choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,AAA=' } }] } }],
		})
		expect(images).toEqual(['data:image/png;base64,AAA='])
	})

	it('parses Gemini inlineData parts', () => {
		const images = parseGeminiImageResponse({
			candidates: [{ content: { parts: [{ text: 'hi' }, { inlineData: { mimeType: 'image/png', data: 'AAA=' } }] } }],
		})
		expect(images).toEqual(['data:image/png;base64,AAA='])
	})

	it('parses Imagen predictions', () => {
		const images = parseImagenResponse({ predictions: [{ bytesBase64Encoded: 'AAA=' }] })
		expect(images).toEqual(['data:image/png;base64,AAA='])
	})

	it('describes a provider error without leaking the key', () => {
		expect(describeProviderError({ error: { message: 'bad request' } }, 400)).toBe('bad request')
		expect(describeProviderError({}, 500)).toBe('Provider error (HTTP 500)')
	})
})

describe('isOpenRouterProvider', () => {
	const base: ProviderConfig = { id: 'p', name: 'p', kind: 'openai-compatible', enabled: true }

	it('recognizes an OpenRouter base URL', () => {
		expect(isOpenRouterProvider({ ...base, baseURL: 'https://openrouter.ai/api/v1' })).toBe(true)
	})

	it('rejects other openai-compatible servers and other kinds', () => {
		expect(isOpenRouterProvider({ ...base, baseURL: 'http://127.0.0.1:11434/v1' })).toBe(false)
		expect(isOpenRouterProvider({ ...base, kind: 'openai', baseURL: 'https://openrouter.ai/api/v1' })).toBe(false)
	})
})
