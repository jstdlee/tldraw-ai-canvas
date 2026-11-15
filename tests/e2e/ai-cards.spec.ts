import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, Page, test } from '@playwright/test'
import { createDefaultNode, gotoApp, nodeLocator, nodeProps, runNode, setNodeProps, zoomToFit } from './helpers'

/**
 * WP50: the AI cards (Document Q&A, Classify, Speech to text, Text to speech). No real model is
 * ever called: `/api/config` is mocked to list fake models, and every model call the cards make
 * (`/api/generate-text`, `/api/embed`, `/api/transcribe`, `/api/speech`) is answered by
 * `page.route`. The provider side of those routes is covered by tests/aiServices.test.ts.
 */

const PROVIDER = {
	id: 'fake',
	name: 'Fake',
	kind: 'openai-compatible',
	baseURL: 'http://127.0.0.1:9/v1',
	enabled: true,
	hasApiKey: false,
}
const CHAT = { key: 'fake/chat', providerId: 'fake', model: 'chat', label: 'Fake chat', capabilities: ['chat'] }
const EMBED = { key: 'fake/emb', providerId: 'fake', model: 'emb', label: 'Fake emb', capabilities: ['embed'] }
const STT = { key: 'fake/stt', providerId: 'fake', model: 'stt', label: 'Fake whisper', capabilities: ['stt'] }
const TTS = { key: 'fake/tts', providerId: 'fake', model: 'tts', label: 'Fake voice', capabilities: ['tts'] }

const WAV = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'tone.wav'))

/** Serve a fixed AI config to the app (GET only), then load the app. */
async function openWithModels(page: Page, models: unknown[]) {
	await page.route('**/api/config', async (route) => {
		if (route.request().method() !== 'GET') return route.fallback()
		await route.fulfill({ json: { providers: [PROVIDER], models, defaults: {} } })
	})
	await gotoApp(page)
	await page.waitForFunction(async () => {
		// @ts-expect-error dynamic import of an app source file, only resolvable by the dev server.
		const mod = await import('/client/ai/aiConfig.tsx')
		return mod.$aiConfig.get() !== null
	})
}

/** Store the WAV fixture in the server's file store; returns its /api/files/… path. */
async function uploadWav(page: Page): Promise<string> {
	const id = `wav${Date.now()}`
	return page.evaluate(
		async ({ id, b64 }) => {
			const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
			const res = await fetch(`/api/files/${id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'audio/wav', 'X-File-Name': 'tone.wav' },
				body: bytes,
			})
			if (!res.ok) throw new Error(await res.text())
			return `/api/files/${id}`
		},
		{ id, b64: WAV.toString('base64') }
	)
}

const DOCS = [
	'The office opens at 8:00 and closes at 18:00 on weekdays.',
	'On Saturdays the office opens at 10:00 and closes at 14:00.',
	'Parking is free for visitors in the back yard behind the building.',
].join('\n\n')

test.describe('WP50 AI cards', () => {
	test('Document Q&A without an embed model ranks by keywords and cites sources', async ({ page }) => {
		await openWithModels(page, [CHAT])
		let embedCalls = 0
		await page.route('**/api/embed', (route) => {
			embedCalls++
			return route.fulfill({ status: 500, json: { error: 'should not be called' } })
		})
		let prompt = ''
		await page.route('**/api/generate-text', async (route) => {
			prompt = (route.request().postDataJSON() as { prompt: string }).prompt
			await route.fulfill({ json: { text: 'It opens at 10:00 on Saturdays [1].' } })
		})
		const id = await createDefaultNode(page, 'doc_qa', {
			documents: DOCS,
			question: 'When does the office open on Saturday?',
			chunkSize: 100,
			overlap: 0,
		})
		await zoomToFit(page)
		await runNode(page, id)
		const node = await nodeProps<{ lastAnswer: string; lastSources: string; lastInfo: string; error: string | null }>(page, id)
		expect(node.error).toBeNull()
		expect(embedCalls).toBe(0)
		expect(node.lastAnswer).toBe('It opens at 10:00 on Saturdays [1].')
		expect(node.lastInfo).toContain('BM25')
		// The best keyword match is source [1], in both the prompt and the sources table.
		expect(prompt).toMatch(/\[1\] \(from Document 1\)\nOn Saturdays/)
		expect(prompt).toContain('do not contain the answer')
		const rows = node.lastSources.split('\n')
		expect(rows[0]).toBe('rank,score,chunk,document')
		expect(rows[1]).toMatch(/^1,[\d.]+,On Saturdays the office opens at 10:00 and closes at 14:00\.,Document 1$/)
		await expect(nodeLocator(page, id)).toContainText('It opens at 10:00 on Saturdays [1].')
	})

	test('Document Q&A with an embed model ranks by cosine and reuses cached chunk embeddings', async ({ page }) => {
		await openWithModels(page, [CHAT, EMBED])
		const embedRequests: string[][] = []
		await page.route('**/api/embed', async (route) => {
			const body = route.request().postDataJSON() as { texts: string[]; model: string }
			expect(body.model).toBe('fake/emb')
			embedRequests.push(body.texts)
			// A toy embedding: [mentions Saturday, mentions parking, 1].
			const vectors = body.texts.map((t) => [/saturday/i.test(t) ? 1 : 0, /park/i.test(t) ? 1 : 0, 0.1])
			await route.fulfill({ json: { model: 'fake/emb', vectors } })
		})
		await page.route('**/api/generate-text', async (route) => {
			const prompt = (route.request().postDataJSON() as { prompt: string }).prompt
			const first = prompt.split('[1] (from Document 1)\n')[1]?.split('\n')[0] ?? ''
			await route.fulfill({ json: { text: `Answer from: ${first} [1]` } })
		})
		const id = await createDefaultNode(page, 'doc_qa', {
			documents: DOCS,
			question: 'When does the office open on Saturday?',
			chunkSize: 100,
			overlap: 0,
			topK: 2,
		})
		await zoomToFit(page)
		await runNode(page, id)
		let node = await nodeProps<{ lastAnswer: string; lastSources: string; lastInfo: string; error: string | null }>(page, id)
		expect(node.error).toBeNull()
		expect(node.lastInfo).toContain('embeddings (Fake emb)')
		expect(node.lastAnswer).toContain('Answer from: On Saturdays')
		expect(node.lastSources.split('\n')).toHaveLength(3)
		// One request with the chunks, one with the question.
		expect(embedRequests.map((r) => r.length)).toEqual([3, 1])

		// A second question: only the question is embedded; the chunks come from the cache.
		await setNodeProps(page, id, { question: 'Is parking free?' })
		await runNode(page, id)
		node = await nodeProps(page, id)
		expect(node.error).toBeNull()
		expect(node.lastAnswer).toContain('Answer from: Parking is free')
		expect(node.lastInfo).toContain('1 of 1 cached')
		expect(embedRequests.map((r) => r.length)).toEqual([3, 1, 1])
		expect(embedRequests[2]).toEqual(['Is parking free?'])
	})

	test('Classify on text retries once on a bad reply, and on a table adds label and confidence', async ({ page }) => {
		await openWithModels(page, [CHAT])
		let calls = 0
		await page.route('**/api/generate-text', async (route) => {
			calls++
			const prompt = (route.request().postDataJSON() as { prompt: string }).prompt
			const input = prompt.split('Input:\n').pop() ?? ''
			if (calls === 1) return route.fulfill({ json: { text: 'Positive, I think!' } })
			const label = /broken|late/.test(input) ? 'negative' : 'positive'
			await route.fulfill({ json: { text: `{"labels": ["${label}"], "confidence": 0.9}` } })
		})
		const id = await createDefaultNode(page, 'classify', {
			input: 'I love this mug, it is great.',
			labels: 'positive\nneutral\nnegative',
		})
		await zoomToFit(page)
		await runNode(page, id)
		let node = await nodeProps<{ lastLabel: string; lastTable: string; error: string | null }>(page, id)
		expect(node.error).toBeNull()
		expect(calls).toBe(2)
		expect(node.lastLabel).toBe('positive')
		// RFC 4180: the cell with a comma is quoted.
		expect(node.lastTable).toBe('input,label,confidence\n"I love this mug, it is great.",positive,0.9')
		await expect(nodeLocator(page, id)).toContainText('positive')

		await setNodeProps(page, id, { input: 'id,review\n1,great mug and fast shipping\n2,arrived broken and very late' })
		await runNode(page, id)
		node = await nodeProps(page, id)
		expect(node.error).toBeNull()
		expect(node.lastLabel).toBe('positive\nnegative')
		expect(node.lastTable).toBe(
			'id,review,label,confidence\n1,great mug and fast shipping,positive,0.9\n2,arrived broken and very late,negative,0.9'
		)
	})

	test('Speech to text transcribes a WAV file and outputs timestamped segments', async ({ page }) => {
		await openWithModels(page, [STT])
		const path = await uploadWav(page)
		let sent: { audio?: string; model?: string; language?: string } = {}
		await page.route('**/api/transcribe', async (route) => {
			sent = route.request().postDataJSON()
			// The audio the card sends is the stored WAV fixture.
			const file = await page.request.get(sent.audio!)
			expect(file.headers()['content-type']).toBe('audio/wav')
			expect((await file.body()).equals(WAV)).toBe(true)
			await route.fulfill({
				json: {
					text: 'a short tone',
					language: 'english',
					segments: [
						{ start: 0, end: 0.12, text: 'a short' },
						{ start: 0.12, end: 0.25, text: 'tone' },
					],
				},
			})
		})
		const id = await createDefaultNode(page, 'speech_to_text', { audio: path, language: 'en' })
		await zoomToFit(page)
		// The card plays the file it will send.
		await expect(nodeLocator(page, id).locator('audio')).toHaveAttribute('src', path)
		await runNode(page, id)
		const node = await nodeProps<{ lastText: string; lastSegments: string; error: string | null }>(page, id)
		expect(node.error).toBeNull()
		expect(sent).toMatchObject({ audio: path, language: 'en' })
		expect(node.lastText).toBe('a short tone')
		expect(node.lastSegments).toBe('start,end,text\n0,0.12,a short\n0.12,0.25,tone')
		await expect(nodeLocator(page, id)).toContainText('a short tone')
	})

	test('Text to speech produces a playable audio file', async ({ page }) => {
		await openWithModels(page, [TTS])
		const path = await uploadWav(page)
		await page.route('**/api/speech/voices', (route) => route.fulfill({ json: { voices: ['alloy', 'nova'] } }))
		let sent: { text?: string; voice?: string; format?: string; model?: string } = {}
		await page.route('**/api/speech', async (route) => {
			sent = route.request().postDataJSON()
			await route.fulfill({ json: { url: path, name: 'speech.wav', size: WAV.length, model: 'fake/tts' } })
		})
		const id = await createDefaultNode(page, 'text_to_speech', { text: 'Hello from the canvas.', voice: 'nova', format: 'wav' })
		await zoomToFit(page)
		await expect(nodeLocator(page, id)).toContainText('Voices…')
		await runNode(page, id)
		const node = await nodeProps<{ lastAudio: string; error: string | null }>(page, id)
		expect(node.error).toBeNull()
		expect(sent).toMatchObject({ text: 'Hello from the canvas.', voice: 'nova', format: 'wav' })
		expect(node.lastAudio).toBe(path)
		const audio = nodeLocator(page, id).locator('audio')
		await expect(audio).toHaveAttribute('src', path)
		// The browser can load and decode it: a real duration (0.25 s tone).
		const duration = await audio.evaluate(
			(el: HTMLAudioElement) =>
				new Promise<number>((resolve, reject) => {
					if (el.readyState >= 1) return resolve(el.duration)
					el.addEventListener('loadedmetadata', () => resolve(el.duration), { once: true })
					el.addEventListener('error', () => reject(new Error('audio failed to load')), { once: true })
					el.load()
				})
		)
		expect(duration).toBeGreaterThan(0.2)
		expect(duration).toBeLessThan(0.3)
	})

	test('each card shows the set-up-a-model message with a link to AI providers', async ({ page }) => {
		await openWithModels(page, [])
		const cards: [string, string][] = [
			['doc_qa', 'No chat model is set up.'],
			['classify', 'No chat model is set up.'],
			['speech_to_text', 'No speech-to-text model is set up.'],
			['text_to_speech', 'No text-to-speech model is set up.'],
		]
		const ids: string[] = []
		for (const [i, [type]] of cards.entries()) ids.push(await createDefaultNode(page, type, {}, { x: i * 460, y: 0 }))
		await zoomToFit(page)
		for (const [i, [, message]] of cards.entries()) {
			const card = nodeLocator(page, ids[i])
			await expect(card).toContainText(message)
			await expect(card.getByRole('button', { name: 'AI providers…' })).toBeVisible()
		}
		await nodeLocator(page, ids[2]).getByRole('button', { name: 'AI providers…' }).click()
		await expect(page.locator('.ai-dialog')).toBeVisible()
	})
})
