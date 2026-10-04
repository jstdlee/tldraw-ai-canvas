import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { generateText, ModelMessage, smoothStream, streamText, UserContent } from 'ai'
import { existsSync, readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { PublicAIConfig } from '../shared/aiConfig'
import { AgentPrompt } from '../shared/types/AgentPrompt'
import { streamAgentActions } from './agent/AgentService'
import {
	ClientAIConfig,
	ConfigError,
	loadConfig,
	mergeClientConfig,
	resolveModel,
	saveConfig,
	toPublicConfig,
} from './config'
import {
	generateImage,
	ImageRequest,
	readImage,
	resolveImage,
	saveImage,
	toDataUrl,
	upscaleImage,
} from './images'
import { getLanguageModel, getProviderOptions, listProviderModels } from './llm'

const PORT = Number(process.env.API_PORT ?? 8790)
const HOST = process.env.HOST ?? '127.0.0.1'
const PROD = process.env.NODE_ENV === 'production'

const app = new Hono()

// ---------------------------------------------------------------------------
// Local-only guard. The server holds API keys and calls URLs from the config,
// so only pages served from this machine may use it: reject other Host names
// (DNS rebinding) and requests from other web origins (CSRF).
// ---------------------------------------------------------------------------
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
app.use('*', async (c, next) => {
	const host = c.req.header('host') ?? ''
	if (!LOCAL_HOST.test(host) && !process.env.ALLOW_HOST?.split(',').includes(host)) {
		return c.text('Forbidden host', 403)
	}
	const origin = c.req.header('origin')
	if (origin && origin !== 'null') {
		const originHost = origin.replace(/^https?:\/\//, '')
		if (!LOCAL_HOST.test(originHost) && !process.env.ALLOW_HOST?.split(',').includes(originHost)) {
			return c.text('Forbidden origin', 403)
		}
	}
	await next()
})

app.onError((err, c) => {
	const status = err instanceof ConfigError ? 400 : 500
	if (status === 500) console.error(err)
	return c.json({ error: err.message ?? String(err) }, status)
})

app.get('/api/health', (c) => c.json({ ok: true }))

// --- AI config -------------------------------------------------------------

app.get('/api/config', (c) => c.json(toPublicConfig(loadConfig())))

app.put('/api/config', async (c) => {
	const incoming = (await c.req.json()) as ClientAIConfig
	const config = mergeClientConfig(incoming)
	saveConfig(config)
	return c.json(toPublicConfig(config))
})

/** List the models a (possibly unsaved) provider serves. */
app.post('/api/providers/models', async (c) => {
	const body = (await c.req.json()) as {
		provider: PublicAIConfig['providers'][number] & { apiKey?: string }
	}
	const stored = loadConfig().providers.find((p) => p.id === body.provider.id)
	const { hasApiKey: _h, ...provider } = body.provider
	const apiKey = provider.apiKey || stored?.apiKey
	const models = await listProviderModels({ ...provider, apiKey })
	return c.json({ models })
})

// --- Agent (canvas-editing chat) -------------------------------------------

app.post('/stream', async (c) => {
	const prompt = (await c.req.json()) as AgentPrompt
	const abort = new AbortController()
	return streamSSE(c, async (stream) => {
		stream.onAbort(() => abort.abort())
		try {
			for await (const change of streamAgentActions(prompt, abort.signal)) {
				await stream.writeSSE({ data: JSON.stringify(change) })
			}
		} catch (e: any) {
			if (abort.signal.aborted) return
			console.error('Agent stream error:', e)
			await stream.writeSSE({ data: JSON.stringify({ error: errorMessage(e) }) })
		}
	})
})

// --- Chat (branching chat nodes, chat with sketches) -------------------------

/** Local image URLs mean nothing to a model; inline them as bytes. */
async function inlineImages(messages: ModelMessage[]): Promise<ModelMessage[]> {
	return Promise.all(
		messages.map(async (m) => {
			if (m.role !== 'user' || typeof m.content === 'string') return m
			const content: UserContent = await Promise.all(
				m.content.map(async (part) => {
					if (part.type !== 'image' || typeof part.image !== 'string') return part
					if (part.image.startsWith('http://') || part.image.startsWith('https://')) {
						if (!part.image.includes('/api/images/')) return part
					}
					const img = await resolveImage(part.image)
					return { type: 'image' as const, image: img.bytes, mediaType: img.mime }
				})
			)
			return { ...m, content }
		})
	)
}

function hasImages(messages: ModelMessage[]) {
	return messages.some(
		(m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((p) => p.type === 'image')
	)
}

app.post('/api/chat', async (c) => {
	const body = (await c.req.json()) as { model?: string; messages: ModelMessage[]; system?: string }
	const messages = await inlineImages(body.messages)
	const { model, provider } = resolveModel(body.model, hasImages(messages) ? 'vision' : 'chat')
	const result = streamText({
		model: getLanguageModel(provider, model),
		system: body.system,
		messages,
		maxOutputTokens: model.maxOutputTokens,
		providerOptions: getProviderOptions(provider, model),
		experimental_transform: smoothStream(),
		abortSignal: c.req.raw.signal,
	})
	// Send reasoning-free text only; errors arrive as a final line.
	const encoder = new TextEncoder()
	const stream = new ReadableStream({
		async start(controller) {
			try {
				for await (const text of result.textStream) controller.enqueue(encoder.encode(text))
			} catch (e) {
				controller.enqueue(encoder.encode(`\n\n[error] ${errorMessage(e)}`))
			}
			controller.close()
		},
	})
	return new Response(stream, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Model': model.key },
	})
})

/** Generate Text node: optional image or text input + prompt -> text. */
app.post('/api/generate-text', async (c) => {
	const body = (await c.req.json()) as { input?: string; prompt: string; model?: string }
	if (!body.prompt) throw new ConfigError('prompt is required')
	const input = body.input != null ? String(body.input) : ''
	const isImage = /^(data:image\/|\/api\/images\/|https?:\/\/)/.test(input)
	const content: UserContent = []
	if (input && isImage) {
		const img = await resolveImage(input)
		content.push({ type: 'image', image: img.bytes, mediaType: img.mime })
		content.push({ type: 'text', text: body.prompt })
	} else {
		content.push({ type: 'text', text: input ? `Context:\n${input}\n\n${body.prompt}` : body.prompt })
	}
	const { model, provider } = resolveModel(body.model, isImage ? 'vision' : 'chat')
	const { text } = await generateText({
		model: getLanguageModel(provider, model),
		messages: [{ role: 'user', content }],
		maxOutputTokens: model.maxOutputTokens ?? 2048,
		providerOptions: getProviderOptions(provider, model),
	})
	return c.json({ text: stripThink(text) })
})

// --- Images ------------------------------------------------------------------

app.post('/api/generate', async (c) => {
	const body = (await c.req.json()) as ImageRequest & {
		controlNetMode?: string
		controlNetStrength?: number
	}
	// ControlNet: guide generation by the reference image (strength 0-100).
	const strength =
		body.controlNetStrength != null ? 1 - clamp01(body.controlNetStrength / 100) * 0.7 : body.strength
	return c.json(await generateImage({ ...body, strength }))
})

app.post('/api/upscale', async (c) => {
	const body = (await c.req.json()) as { imageUrl: string; scale: number; model?: string; method?: string }
	return c.json(await upscaleImage({ imageUrl: body.imageUrl, scale: body.scale, model: body.model }))
})

/** Reference-guided generation (IP-Adapter node). */
app.post('/api/ip-adapter', async (c) => {
	const body = (await c.req.json()) as {
		imageUrl: string
		prompt: string
		scale: number
		steps: number
		model?: string
	}
	const result = await generateImage({
		model: body.model,
		prompt: body.prompt,
		steps: body.steps,
		referenceImageUrl: body.imageUrl,
		// Higher adapter scale = follow the reference more = change it less.
		strength: 1 - clamp01(body.scale) * 0.6,
	})
	return c.json({ imageUrl: result.imageUrl })
})

/** Style transfer node: repaint the content image in the style described / shown. */
app.post('/api/style-transfer', async (c) => {
	const body = (await c.req.json()) as {
		styleImageUrl: string
		contentImageUrl?: string
		prompt?: string
		model?: string
		strength: number
	}
	const result = await generateImage({
		model: body.model?.includes('/') ? body.model : undefined,
		prompt: body.prompt || 'the same scene, repainted in the style of the reference artwork',
		referenceImageUrl: body.contentImageUrl || body.styleImageUrl,
		strength: clamp01(body.strength > 1 ? body.strength / 100 : body.strength),
	})
	return c.json({ imageUrl: result.imageUrl })
})

app.post('/api/images/:imageId', async (c) => {
	const mime = c.req.header('content-type') ?? 'image/png'
	if (!mime.startsWith('image/')) return c.json({ error: 'Invalid content type' }, 400)
	const imageId = c.req.param('imageId')
	if (!readImage(imageId)) {
		saveImage(new Uint8Array(await c.req.arrayBuffer()), mime.split(';')[0], imageId)
	}
	return c.json({ ok: true })
})

app.get('/api/images/:imageId', (c) => {
	const image = readImage(c.req.param('imageId'))
	if (!image) return c.text('Not found', 404)
	return new Response(new Uint8Array(image.bytes), {
		headers: { 'Content-Type': image.mime, 'Cache-Control': 'public, max-age=31536000, immutable' },
	})
})

/** Data URL of a stored image (used when the canvas embeds a result as an asset). */
app.get('/api/images/:imageId/data-url', (c) => {
	const image = readImage(c.req.param('imageId'))
	if (!image) return c.text('Not found', 404)
	return c.text(toDataUrl(image))
})

// --- Static app (production) -----------------------------------------------

if (PROD) {
	app.use('/*', serveStatic({ root: './dist' }))
	const index = existsSync('dist/index.html') ? readFileSync('dist/index.html', 'utf8') : null
	app.get('*', (c) => (index ? c.html(index) : c.text('Run "npm run build" first.', 500)))
}

function errorMessage(e: unknown) {
	const err = e as { message?: string; responseBody?: string; cause?: { message?: string } }
	const body = err?.responseBody ? ` — ${err.responseBody.slice(0, 300)}` : ''
	return `${err?.message ?? String(e)}${body}`
}

function stripThink(text: string) {
	return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '')
}

function clamp01(v: number) {
	return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
	console.log(`AI canvas server on http://${HOST}:${PORT}${PROD ? '' : ' (API only; open the Vite URL)'}`)
	// Warn early when nothing is configured yet.
	try {
		resolveModel(null, 'chat')
	} catch {
		console.log('No chat model configured yet: open "AI providers" in the app.')
	}
})
