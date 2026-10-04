import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ModelConfig, ProviderConfig } from '../shared/aiConfig'
import { ConfigError, DATA_DIR, resolveModel } from './config'

export const IMAGE_DIR = join(DATA_DIR, 'images')

// ---------------------------------------------------------------------------
// Local image store: every generated or uploaded image is a file on disk,
// served at /api/images/:id. Nothing goes to a cloud bucket.
// ---------------------------------------------------------------------------

const MIME_EXT: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/svg+xml': 'svg',
}

export function isValidImageId(id: string) {
	return /^[a-zA-Z0-9_-]{1,100}$/.test(id)
}

export function saveImage(bytes: Uint8Array, mime = 'image/png', id?: string): string {
	mkdirSync(IMAGE_DIR, { recursive: true })
	const imageId = id ?? `img_${Date.now()}_${randomBytes(4).toString('hex')}`
	if (!isValidImageId(imageId)) throw new ConfigError('Invalid image id')
	const ext = MIME_EXT[mime] ?? 'png'
	writeFileSync(join(IMAGE_DIR, `${imageId}.${ext}`), bytes)
	return `/api/images/${imageId}`
}

export function readImage(imageId: string): { bytes: Uint8Array; mime: string } | null {
	if (!isValidImageId(imageId)) return null
	for (const [mime, ext] of Object.entries(MIME_EXT)) {
		const path = join(IMAGE_DIR, `${imageId}.${ext}`)
		if (existsSync(path)) return { bytes: readFileSync(path), mime }
	}
	return null
}

/** Load an image from a data URL, a local /api/images/ path, or an http(s) URL. */
export async function resolveImage(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
	if (url.startsWith('data:')) {
		const [header, data] = url.split(',', 2)
		const mime = header.match(/data:([^;]+)/)?.[1] ?? 'image/png'
		const bytes = header.includes('base64')
			? Buffer.from(data, 'base64')
			: Buffer.from(decodeURIComponent(data), 'utf8')
		return { bytes, mime }
	}
	const local = url.match(/^(?:https?:\/\/[^/]+)?\/api\/images\/([^/?#]+)/)
	if (local) {
		const image = readImage(local[1])
		if (!image) throw new Error(`Image not found: ${local[1]}`)
		return image
	}
	const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
	if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`)
	return {
		bytes: new Uint8Array(await res.arrayBuffer()),
		mime: res.headers.get('content-type')?.split(';')[0] ?? 'image/png',
	}
}

export function toDataUrl(image: { bytes: Uint8Array; mime: string }) {
	return `data:${image.mime};base64,${Buffer.from(image.bytes).toString('base64')}`
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface ImageRequest {
	/** Model key from the AI config; empty = default image model. */
	model?: string
	prompt: string
	negativePrompt?: string
	steps?: number
	cfgScale?: number
	seed?: number | null
	width?: number
	height?: number
	/** Start image for image-to-image (also used for ControlNet, IP-Adapter, style). */
	referenceImageUrl?: string
	/** How much to change the reference image, 0 (keep) … 1 (ignore). */
	strength?: number
}

export interface ImageResult {
	imageUrl: string
	seed: number
}

export interface UpscaleRequest {
	model?: string
	imageUrl: string
	scale: number
}

export async function generateImage(req: ImageRequest): Promise<ImageResult> {
	if (!req.prompt) throw new ConfigError('prompt is required')
	const { model, provider } = resolveModel(req.model, 'image')
	const seed = req.seed ?? Math.floor(Math.random() * 2 ** 31)
	const full = { ...req, seed, steps: req.steps ?? 20, cfgScale: req.cfgScale ?? 7 }
	switch (provider.kind) {
		case 'comfyui':
			return { imageUrl: await comfyGenerate(provider, model, full), seed }
		case 'openai':
		case 'openai-compatible':
			return { imageUrl: await openaiGenerate(provider, model, full), seed }
		case 'replicate':
			return { imageUrl: await replicateRun(provider, model.model, replicateImageInput(full)), seed }
		default:
			throw new ConfigError(`Provider "${provider.name}" cannot generate images.`)
	}
}

export async function upscaleImage(req: UpscaleRequest): Promise<{ imageUrl: string }> {
	const { model, provider } = resolveModel(req.model, 'upscale')
	switch (provider.kind) {
		case 'comfyui':
			return { imageUrl: await comfyUpscale(provider, model, req) }
		case 'replicate': {
			const image = toDataUrl(await resolveImage(req.imageUrl))
			return { imageUrl: await replicateRun(provider, model.model, { image, scale: req.scale }) }
		}
		default:
			throw new ConfigError(`Provider "${provider.name}" cannot upscale images.`)
	}
}

// --- ComfyUI ----------------------------------------------------------------

type ComfyGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>

function comfyBase(provider: ProviderConfig) {
	return (provider.baseURL ?? 'http://127.0.0.1:8188').replace(/\/+$/, '')
}

async function comfyUpload(provider: ProviderConfig, imageUrl: string): Promise<string> {
	const image = await resolveImage(imageUrl)
	const form = new FormData()
	const name = `tldraw_${Date.now()}.${MIME_EXT[image.mime] ?? 'png'}`
	form.append('image', new Blob([new Uint8Array(image.bytes)], { type: image.mime }), name)
	form.append('overwrite', 'true')
	const res = await fetch(`${comfyBase(provider)}/upload/image`, { method: 'POST', body: form })
	if (!res.ok) throw new Error(`ComfyUI upload failed: ${res.status} ${await res.text()}`)
	return ((await res.json()) as { name: string }).name
}

/** Built-in text-to-image / image-to-image graph for a checkpoint model. */
function comfyDefaultGraph(
	ckpt: string,
	req: Required<Pick<ImageRequest, 'prompt' | 'steps' | 'cfgScale'>> & ImageRequest & { seed: number },
	uploadedImage?: string
): ComfyGraph {
	const graph: ComfyGraph = {
		ckpt: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
		pos: { class_type: 'CLIPTextEncode', inputs: { text: req.prompt, clip: ['ckpt', 1] } },
		neg: {
			class_type: 'CLIPTextEncode',
			inputs: { text: req.negativePrompt ?? '', clip: ['ckpt', 1] },
		},
		latent: {
			class_type: 'EmptyLatentImage',
			inputs: { width: req.width ?? 1024, height: req.height ?? 1024, batch_size: 1 },
		},
		sample: {
			class_type: 'KSampler',
			inputs: {
				model: ['ckpt', 0],
				positive: ['pos', 0],
				negative: ['neg', 0],
				latent_image: ['latent', 0],
				seed: req.seed,
				steps: req.steps,
				cfg: req.cfgScale,
				sampler_name: 'euler',
				scheduler: 'normal',
				denoise: 1,
			},
		},
		decode: { class_type: 'VAEDecode', inputs: { samples: ['sample', 0], vae: ['ckpt', 2] } },
		save: { class_type: 'SaveImage', inputs: { images: ['decode', 0], filename_prefix: 'tldraw' } },
	}
	if (uploadedImage) {
		graph.load = { class_type: 'LoadImage', inputs: { image: uploadedImage } }
		graph.latent = { class_type: 'VAEEncode', inputs: { pixels: ['load', 0], vae: ['ckpt', 2] } }
		graph.sample.inputs.denoise = clamp(req.strength ?? 0.6, 0.05, 1)
	}
	return graph
}

/**
 * Fill a user workflow (ComfyUI "Save (API)" JSON). String values like
 * "{{prompt}}" are replaced; a value that is only a placeholder keeps the
 * value's type (numbers stay numbers).
 */
export function fillComfyWorkflow(template: string, vars: Record<string, unknown>): ComfyGraph {
	const graph = JSON.parse(template) as ComfyGraph
	const fill = (v: unknown): unknown => {
		if (typeof v === 'string') {
			const whole = v.match(/^\{\{(\w+)\}\}$/)
			if (whole) return whole[1] in vars ? vars[whole[1]] : v
			return v.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
		}
		if (Array.isArray(v)) return v.map(fill)
		if (v && typeof v === 'object') {
			return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))
		}
		return v
	}
	return fill(graph) as ComfyGraph
}

async function comfyRun(provider: ProviderConfig, graph: ComfyGraph): Promise<string> {
	const base = comfyBase(provider)
	const res = await fetch(`${base}/prompt`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ prompt: graph, client_id: 'tldraw-ai-canvas' }),
	})
	if (!res.ok) throw new Error(`ComfyUI rejected the workflow: ${res.status} ${await res.text()}`)
	const { prompt_id } = (await res.json()) as { prompt_id: string }

	const deadline = Date.now() + 15 * 60_000
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 1000))
		const history = (await (await fetch(`${base}/history/${prompt_id}`)).json()) as any
		const entry = history?.[prompt_id]
		if (!entry) continue
		if (entry.status?.status_str === 'error') {
			const msg = entry.status.messages?.find((m: any) => m[0] === 'execution_error')?.[1]
			throw new Error(`ComfyUI error: ${msg?.exception_message ?? 'execution failed'}`)
		}
		for (const output of Object.values<any>(entry.outputs ?? {})) {
			const img = output.images?.[0]
			if (!img) continue
			const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type })
			const file = await fetch(`${base}/view?${q}`)
			if (!file.ok) throw new Error(`ComfyUI /view failed: ${file.status}`)
			const mime = file.headers.get('content-type') ?? 'image/png'
			return saveImage(new Uint8Array(await file.arrayBuffer()), mime)
		}
		if (entry.status?.completed) throw new Error('ComfyUI finished but returned no image')
	}
	throw new Error('ComfyUI timed out after 15 minutes')
}

async function comfyGenerate(
	provider: ProviderConfig,
	model: ModelConfig,
	req: ImageRequest & { seed: number; steps: number; cfgScale: number }
) {
	const uploaded = req.referenceImageUrl ? await comfyUpload(provider, req.referenceImageUrl) : undefined
	const graph = model.comfyWorkflow
		? fillComfyWorkflow(model.comfyWorkflow, {
				prompt: req.prompt,
				negative: req.negativePrompt ?? '',
				seed: req.seed,
				steps: req.steps,
				cfg: req.cfgScale,
				width: req.width ?? 1024,
				height: req.height ?? 1024,
				denoise: req.referenceImageUrl ? clamp(req.strength ?? 0.6, 0.05, 1) : 1,
				image: uploaded ?? '',
				model: model.model,
			})
		: comfyDefaultGraph(model.model, req, uploaded)
	return comfyRun(provider, graph)
}

async function comfyUpscale(provider: ProviderConfig, model: ModelConfig, req: UpscaleRequest) {
	const uploaded = await comfyUpload(provider, req.imageUrl)
	return comfyRun(provider, {
		load: { class_type: 'LoadImage', inputs: { image: uploaded } },
		upModel: { class_type: 'UpscaleModelLoader', inputs: { model_name: model.model } },
		up: { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['upModel', 0], image: ['load', 0] } },
		save: { class_type: 'SaveImage', inputs: { images: ['up', 0], filename_prefix: 'tldraw_up' } },
	})
}

// --- OpenAI-style /images API -------------------------------------------------

async function openaiGenerate(
	provider: ProviderConfig,
	model: ModelConfig,
	req: ImageRequest & { seed: number }
) {
	const base = (provider.baseURL ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
	const auth: Record<string, string> = provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}
	const size = `${req.width ?? 1024}x${req.height ?? 1024}`
	const prompt = req.negativePrompt ? `${req.prompt}\nAvoid: ${req.negativePrompt}` : req.prompt
	let res: Response
	if (req.referenceImageUrl) {
		const image = await resolveImage(req.referenceImageUrl)
		const form = new FormData()
		form.append('model', model.model)
		form.append('prompt', prompt)
		form.append('size', size)
		form.append('image', new Blob([new Uint8Array(image.bytes)], { type: image.mime }), 'image.png')
		res = await fetch(`${base}/images/edits`, { method: 'POST', headers: auth, body: form })
	} else {
		res = await fetch(`${base}/images/generations`, {
			method: 'POST',
			headers: { ...auth, 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: model.model, prompt, size, n: 1, seed: req.seed }),
		})
	}
	if (!res.ok) throw new Error(`Image API error ${res.status}: ${await res.text()}`)
	const data = (await res.json()) as { data: { b64_json?: string; url?: string }[] }
	const first = data.data?.[0]
	if (first?.b64_json) return saveImage(Buffer.from(first.b64_json, 'base64'), 'image/png')
	if (first?.url) {
		const image = await resolveImage(first.url)
		return saveImage(image.bytes, image.mime)
	}
	throw new Error('Image API returned no image')
}

// --- Replicate (online) -------------------------------------------------------

function replicateImageInput(req: ImageRequest & { seed: number; steps: number; cfgScale: number }) {
	return {
		prompt: req.prompt,
		...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
		seed: req.seed,
		num_inference_steps: req.steps,
		guidance: req.cfgScale,
		...(req.referenceImageUrl ? { image: req.referenceImageUrl, prompt_strength: req.strength ?? 0.6 } : {}),
	}
}

async function replicateRun(provider: ProviderConfig, model: string, input: Record<string, unknown>) {
	if (!provider.apiKey) throw new ConfigError(`Provider "${provider.name}" needs an API key.`)
	for (const key of ['image']) {
		const v = input[key]
		if (typeof v === 'string' && !v.startsWith('http')) input[key] = toDataUrl(await resolveImage(v))
	}
	const base = (provider.baseURL ?? 'https://api.replicate.com/v1').replace(/\/+$/, '')
	const [path, version] = model.split(':')
	const res = await fetch(
		version ? `${base}/predictions` : `${base}/models/${path}/predictions`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${provider.apiKey}`,
				'Content-Type': 'application/json',
				Prefer: 'wait',
			},
			body: JSON.stringify(version ? { version, input } : { input }),
		}
	)
	if (!res.ok) throw new Error(`Replicate error ${res.status}: ${await res.text()}`)
	const data = (await res.json()) as { output?: string | string[]; error?: string }
	const out = Array.isArray(data.output) ? data.output[0] : data.output
	if (!out) throw new Error(data.error ?? 'Replicate returned no output (try again; it may still be starting)')
	const image = await resolveImage(out)
	return saveImage(image.bytes, image.mime)
}

function clamp(v: number, min: number, max: number) {
	return Math.min(max, Math.max(min, v))
}
