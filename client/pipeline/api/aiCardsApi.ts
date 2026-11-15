/** WP50: client calls for the AI cards (Document Q&A, Speech to text, Text to speech). */

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal,
	})
	const data = await res.json().catch(() => ({ error: res.statusText }))
	if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText)
	return data as T
}

export function apiEmbed(texts: string[], model: string | undefined, signal?: AbortSignal) {
	return postJson<{ model: string; vectors: number[][] }>('/api/embed', { texts, model: model || undefined }, signal)
}

export interface TranscriptResult {
	text: string
	language?: string
	segments?: { start: number; end: number; text: string }[]
	model?: string
}

export function apiTranscribe(audio: string, model: string | undefined, language: string, signal?: AbortSignal) {
	return postJson<TranscriptResult>('/api/transcribe', { audio, model: model || undefined, language: language || undefined }, signal)
}

export function apiSpeech(
	params: { text: string; voice: string; format: string; model?: string },
	signal?: AbortSignal
) {
	return postJson<{ url: string; name: string; size: number; model?: string }>(
		'/api/speech',
		{ ...params, model: params.model || undefined },
		signal
	)
}

export async function apiVoices(model: string | undefined): Promise<string[]> {
	return (await postJson<{ voices: string[] }>('/api/speech/voices', { model: model || undefined })).voices
}

/** Read one document reference: a stored file's text, or a web page's readable text. */
export async function readDocumentRef(ref: string, signal?: AbortSignal): Promise<string> {
	if (ref.startsWith('/api/files/')) {
		const res = await fetch(ref, { signal })
		if (!res.ok) throw new Error(`Reading ${ref} failed: HTTP ${res.status}`)
		const type = res.headers.get('content-type') ?? ''
		if (/^(image|audio|video)\//.test(type) || /(pdf|zip|officedocument|msword|ms-excel|sqlite)/.test(type)) {
			throw new Error(`${ref} is not a text file (${type}). Convert it to text first.`)
		}
		return await res.text()
	}
	const page = await postJson<{ ok: boolean; status: number; text: string }>('/api/http', { url: ref, extractText: true }, signal)
	if (!page.ok) throw new Error(`Reading ${ref} failed: HTTP ${page.status}`)
	return page.text
}
