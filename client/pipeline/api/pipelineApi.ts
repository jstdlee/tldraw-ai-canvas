/**
 * Frontend API client for the local Node server (server/index.ts).
 * Each function corresponds to a server endpoint. Model fields take a model
 * key from the AI config; empty means the default model for the job.
 */

export interface GenerateParams {
	model?: string
	prompt: string
	negativePrompt?: string
	steps?: number
	cfgScale?: number
	seed?: number
	controlNetMode?: string
	controlNetStrength?: number
	referenceImageUrl?: string
}

export interface GenerateResult {
	imageUrl: string
	seed: number
}

/**
 * Call the /api/generate endpoint to create an AI-generated image.
 * Falls back to a local placeholder if the worker is not available.
 */
export async function apiGenerate(params: GenerateParams): Promise<GenerateResult> {
	try {
		const response = await fetch('/api/generate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(params),
		})

		if (!response.ok) {
			const err = await response.json().catch(() => ({ error: response.statusText }))
			throw new Error((err as { error?: string }).error ?? 'Generation failed')
		}

		return (await response.json()) as GenerateResult
	} catch (e) {
		throw e instanceof Error ? e : new Error(String(e))
	}
}

export interface UpscaleParams {
	imageUrl: string
	scale: number
	/** Upscale model key; empty = default. */
	model?: string
}

export interface UpscaleResult {
	imageUrl: string
}

/**
 * Call the /api/upscale endpoint to upscale an image.
 */
export async function apiUpscale(params: UpscaleParams): Promise<UpscaleResult> {
	try {
		const response = await fetch('/api/upscale', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(params),
		})

		if (!response.ok) {
			const err = await response.json().catch(() => ({ error: response.statusText }))
			throw new Error((err as { error?: string }).error ?? 'Upscale failed')
		}

		return (await response.json()) as UpscaleResult
	} catch (e) {
		throw e instanceof Error ? e : new Error(String(e))
	}
}

export interface IPAdapterParams {
	imageUrl: string
	prompt: string
	scale: number
	steps: number
	model?: string
}

export interface IPAdapterResult {
	imageUrl: string
}

/**
 * Call the /api/ip-adapter endpoint to generate an image guided by a reference.
 */
export async function apiIPAdapter(params: IPAdapterParams): Promise<IPAdapterResult> {
	try {
		const response = await fetch('/api/ip-adapter', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(params),
		})

		if (!response.ok) {
			const err = await response.json().catch(() => ({ error: response.statusText }))
			throw new Error((err as { error?: string }).error ?? 'IP-Adapter failed')
		}

		return (await response.json()) as IPAdapterResult
	} catch (e) {
		throw e instanceof Error ? e : new Error(String(e))
	}
}

export interface StyleTransferParams {
	styleImageUrl: string
	contentImageUrl?: string
	prompt?: string
	model: string
	strength: number
}

export interface StyleTransferResult {
	imageUrl: string
}

/**
 * Call the /api/style-transfer endpoint to transfer style between images.
 */
export async function apiStyleTransfer(params: StyleTransferParams): Promise<StyleTransferResult> {
	try {
		const response = await fetch('/api/style-transfer', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(params),
		})

		if (!response.ok) {
			const err = await response.json().catch(() => ({ error: response.statusText }))
			throw new Error((err as { error?: string }).error ?? 'Style transfer failed')
		}

		return (await response.json()) as StyleTransferResult
	} catch (e) {
		throw e instanceof Error ? e : new Error(String(e))
	}
}

export interface GenerateTextParams {
	input?: string
	prompt: string
	model?: string
}

export interface GenerateTextResult {
	text: string
}

/**
 * Call the /api/generate-text endpoint to generate text from a multimodal AI model.
 * Falls back to a local placeholder if the worker is not available.
 */
export async function apiGenerateText(params: GenerateTextParams): Promise<GenerateTextResult> {
	// Coerce input to string so the worker always receives a string
	const coercedParams = {
		...params,
		input: params.input != null ? String(params.input) : undefined,
	}
	try {
		const response = await fetch('/api/generate-text', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(coercedParams),
		})

		if (!response.ok) {
			const err = await response.json().catch(() => ({ error: response.statusText }))
			throw new Error((err as { error?: string }).error ?? 'Text generation failed')
		}

		return (await response.json()) as GenerateTextResult
	} catch (e) {
		throw e instanceof Error ? e : new Error(String(e))
	}
}


export type ChatContentPart = { type: 'text'; text: string } | { type: 'image'; image: string }

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system'
	content: string | ChatContentPart[]
}

/**
 * Stream a chat reply from /api/chat. `onText` gets the full text so far.
 * Resolves with the final text; rejects on an error.
 */
export async function apiChatStream(
	params: { model?: string; messages: ChatMessage[]; system?: string },
	onText: (text: string) => void,
	signal?: AbortSignal
): Promise<string> {
	const response = await fetch('/api/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(params),
		signal,
	})
	if (!response.ok || !response.body) {
		const err = await response.json().catch(() => ({ error: response.statusText }))
		throw new Error((err as { error?: string }).error ?? 'Chat failed')
	}
	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let text = ''
	while (true) {
		const { value, done } = await reader.read()
		if (done) break
		text += decoder.decode(value, { stream: true })
		onText(stripThinking(text))
	}
	const errorAt = text.lastIndexOf('\n\n[error] ')
	if (errorAt !== -1) throw new Error(text.slice(errorAt + 10))
	return stripThinking(text)
}

/** Hide <think>…</think> blocks that some local models write into the text. */
export function stripThinking(text: string) {
	const withoutClosed = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '')
	const open = withoutClosed.indexOf('<think>')
	return (open === -1 ? withoutClosed : withoutClosed.slice(0, open)).trimStart()
}
