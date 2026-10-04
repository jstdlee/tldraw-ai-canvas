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
import { readImage, resolveImage, saveImage, toDataUrl } from './images'
import { downloadUrl, httpRequest, HttpRequestInput, saveContent, unfurl } from './http'
import { deleteCustomNode, listCustomNodes, readCustomNode, saveCustomNode } from './customNodes'
import { decide, JevRequest } from './jev'
import { NET_TOOLS, NetTool, runNetTool } from './nettools'
import { getLanguageModel, getProviderOptions, listProviderModels, ProviderModelInfo } from './llm'
import { guessCapabilities, ModelCapability, ModelConfig } from '../shared/aiConfig'

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

/** Live model lists from every enabled provider (cached 60 s), for the model dropdowns. */
const liveCache = new Map<string, { at: number; models: ProviderModelInfo[] }>()
app.get('/api/models', async (c) => {
	const config = loadConfig()
	const results = await Promise.all(
		config.providers
			.filter((p) => p.enabled)
			.map(async (provider) => {
				const cacheKey = `${provider.id}|${provider.baseURL}|${provider.kind}`
				const hit = liveCache.get(cacheKey)
				let models = hit && Date.now() - hit.at < 60_000 ? hit.models : null
				let error: string | undefined
				if (!models) {
					try {
						models = await listProviderModels(provider)
						liveCache.set(cacheKey, { at: Date.now(), models })
					} catch (e) {
						error = errorMessage(e)
						models = []
					}
				}
				return {
					providerId: provider.id,
					providerName: provider.name,
					error,
					models: models.map((m) => {
						let caps: ModelCapability[] = guessCapabilities(provider.kind, m.id)
						if (m.vision !== undefined && caps.includes('chat')) {
							caps = caps.filter((x) => x !== 'vision')
							if (m.vision) caps.push('vision')
						}
						// Any chat model may drive the agent or answer JEV questions; the user decides.
						if (caps.includes('chat') && !caps.includes('agent')) caps.push('agent')
						if (caps.includes('chat') && !caps.includes('jev')) caps.push('jev')
						return { key: `${provider.id}/${m.id}`, model: m.id, label: m.label ?? m.id, capabilities: caps }
					}),
				}
			})
	)
	return c.json({ providers: results })
})

// --- Web: HTTP request, download, save, link preview -------------------------

app.post('/api/http', async (c) => c.json(await httpRequest((await c.req.json()) as HttpRequestInput)))

app.post('/api/download', async (c) => {
	const body = (await c.req.json()) as { url: string; fileName?: string }
	return c.json(await downloadUrl(body.url, body.fileName))
})

app.post('/api/save', async (c) => {
	const body = (await c.req.json()) as { content: string; fileName?: string }
	if (typeof body.content !== 'string' || !body.content) throw new ConfigError('Nothing to save')
	return c.json(await saveContent(body.content, body.fileName))
})

app.get('/api/unfurl', async (c) => {
	const url = c.req.query('url')
	if (!url) throw new ConfigError('url is required')
	return c.json(await unfurl(url))
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
	const body = (await c.req.json()) as {
		model?: string
		messages: ModelMessage[]
		system?: string
		temperature?: number | null
		maxTokens?: number | null
		thinking?: string
	}
	const messages = await inlineImages(body.messages)
	const { model, provider } = resolveModel(body.model, hasImages(messages) ? 'vision' : 'chat')
	const result = streamText({
		model: getLanguageModel(provider, model),
		system: body.system || undefined,
		messages,
		...(body.temperature != null ? { temperature: body.temperature } : {}),
		maxOutputTokens: body.maxTokens || model.maxOutputTokens,
		providerOptions: getProviderOptions(provider, withThinking(model, body.thinking)),
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

/**
 * Turn a node input into model content: images stay images; a URL is fetched
 * (image → image, web page → its readable text); anything else is text.
 */
async function inputToContent(input: string): Promise<{ images: { bytes: Uint8Array; mime: string }[]; text: string }> {
	const value = input.trim()
	if (/^(data:image\/|\/api\/images\/)/.test(value)) return { images: [await resolveImage(value)], text: '' }
	if (/^https?:\/\/\S+$/.test(value)) {
		const page = await httpRequest({ url: value, extractText: true })
		if (page.imageUrl) return { images: [await resolveImage(page.imageUrl)], text: '' }
		if (!page.ok) throw new ConfigError(`Fetching ${value} failed: HTTP ${page.status}`)
		return { images: [], text: `Content of ${value}:\n${page.text.slice(0, 60_000)}` }
	}
	return { images: [], text: input }
}

/** Generate Text / AI text / Summarize nodes: optional input (text, URL, image, frames) + prompt -> text. */
app.post('/api/generate-text', async (c) => {
	const body = (await c.req.json()) as {
		input?: string
		/** Extra images, e.g. frames taken from a video. */
		images?: string[]
		prompt: string
		model?: string
		system?: string
		temperature?: number | null
		maxTokens?: number | null
		thinking?: string
	}
	if (!body.prompt) throw new ConfigError('prompt is required')
	const { images, text } = body.input ? await inputToContent(String(body.input)) : { images: [], text: '' }
	for (const extra of (body.images ?? []).slice(0, 12)) images.push(await resolveImage(extra))
	const content: UserContent = images.map((img) => ({ type: 'image' as const, image: img.bytes, mediaType: img.mime }))
	content.push({ type: 'text', text: text ? `Input:\n${text}\n\n${body.prompt}` : body.prompt })
	const { model, provider } = resolveModel(body.model, images.length ? 'vision' : 'chat')
	const { text: reply } = await generateText({
		model: getLanguageModel(provider, model),
		system: body.system || undefined,
		messages: [{ role: 'user', content }],
		...(body.temperature != null ? { temperature: body.temperature } : {}),
		maxOutputTokens: body.maxTokens || model.maxOutputTokens || 4096,
		providerOptions: getProviderOptions(provider, withThinking(model, body.thinking)),
	})
	return c.json({ text: stripThink(reply) })
})

// --- Custom nodes (saved packed groups) -------------------------------------

app.get('/api/custom-nodes', (c) => c.json({ nodes: listCustomNodes() }))
app.get('/api/custom-nodes/:id', (c) => c.json(readCustomNode(c.req.param('id'))))
app.post('/api/custom-nodes', async (c) => c.json(saveCustomNode(await c.req.json())))
app.delete('/api/custom-nodes/:id', (c) => {
	deleteCustomNode(c.req.param('id'))
	return c.json({ ok: true })
})

// --- JEV decisions ---------------------------------------------------------------

app.post('/api/jev', async (c) => c.json(await decide((await c.req.json()) as JevRequest)))

// --- Network tools ---------------------------------------------------------------

app.post('/api/nettool', async (c) => {
	const body = (await c.req.json()) as { tool: NetTool; target?: string; option?: string }
	if (!NET_TOOLS.includes(body.tool)) throw new ConfigError(`Unknown tool ${body.tool}`)
	const started = Date.now()
	const output = await runNetTool(body.tool, body.target ?? '', body.option ?? '')
	return c.json({ output, ms: Date.now() - started })
})

// --- Local image store -----------------------------------------------------

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

/** Apply a per-request thinking level over the model's own setting. */
function withThinking(model: ModelConfig, thinking?: string): ModelConfig {
	const allowed = ['none', 'minimal', 'low', 'medium', 'high']
	return thinking && allowed.includes(thinking)
		? { ...model, reasoningEffort: thinking as ModelConfig['reasoningEffort'] }
		: model
}

function stripThink(text: string) {
	return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '')
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
