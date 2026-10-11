/** Local tools, backup, history, output spill, and the raw-model proxy. */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Hono } from 'hono'
import { buildToolCommand } from '../shared/localTool'
import { normalizeLlmUsage } from '../shared/llmUsage'
import { resolveSecret, stripSecrets } from '../shared/secrets'
import { freeModels, modelsFromPayload } from '../shared/modelPick'
import { getSecretValue } from './secretsStore'

const MAX_STDIN = 1024 * 1024 // 1 MiB typed into a node
const MAX_OUT = 1024 * 1024 // 1 MiB back to the canvas

function dataDir() {
	return resolve(process.env.DATA_DIR ?? join(process.cwd(), 'data'))
}

/**
 * Run one program with no shell, a hard timeout, and bounded pipes.
 * EPIPE (the tool stops reading, e.g. `head`-like exits) is not an error:
 * the partial output already collected is the answer.
 */
function runProcess(cmd: string, args: string[], stdin: string, timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
	const { promise, resolve: resolvePromise, reject } = Promise.withResolvers<{ code: number; out: string; err: string }>()
	let child
	try {
		child = spawn(cmd, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
	} catch (error) {
		reject(error as Error)
		return promise
	}
	let out = ''
	let err = ''
	let settled = false
	const finish = (code: number) => {
		if (settled) return
		settled = true
		clearTimeout(timer)
		resolvePromise({ code, out: out.slice(0, MAX_OUT), err: err.slice(0, 4000) })
	}
	const fail = (error: Error) => {
		if (settled) return
		settled = true
		clearTimeout(timer)
		reject(error)
	}
	const timer = setTimeout(() => {
		child.kill('SIGKILL')
		fail(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`))
	}, timeoutMs)
	child.stdout.on('data', (chunk: Buffer) => {
		if (out.length < MAX_OUT) out += chunk.toString('utf8')
	})
	child.stderr.on('data', (chunk: Buffer) => {
		if (err.length < 4000) err += chunk.toString('utf8')
	})
	child.on('error', fail)
	child.on('close', (code) => finish(code ?? 1))
	child.stdin.on('error', (error: NodeJS.ErrnoException) => {
		// EPIPE: the tool exited early and closed stdin. Its output stands.
		if (error.code !== 'EPIPE') fail(error)
	})
	if (stdin) child.stdin.write(stdin)
	child.stdin.end()
	return promise
}

function outputsDir() {
	const dir = join(dataDir(), 'outputs')
	mkdirSync(dir, { recursive: true })
	return dir
}

function safeName(name: string): string {
	const clean = name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
	return clean || 'output'
}

export function registerBatchRoutes(app: Hono) {
	app.post('/api/tool', async (c) => {
		const body = (await c.req.json()) as { tool?: string; args?: string; stdin?: string }
		const stdin = body.stdin ?? ''
		if (stdin.length > MAX_STDIN) throw new Error(`Text is over ${MAX_STDIN / 1024} KB. Spill it to a file first.`)
		const { cmd, args } = buildToolCommand(body.tool ?? '', body.args ?? '')
		const result = await runProcess(cmd, args, stdin, 20_000)
		if (result.code !== 0 && !result.out) throw new Error(result.err.trim() || `${cmd} exited ${result.code}`)
		return c.json({ output: result.out || result.err })
	})

	app.post('/api/output', async (c) => {
		const body = (await c.req.json()) as { name?: string; text?: string }
		const text = body.text ?? ''
		if (!text) throw new Error('Nothing to save')
		const file = join(outputsDir(), `${safeName(body.name ?? 'output')}-${Date.now()}.txt`)
		writeFileSync(file, text)
		return c.json({ path: file, bytes: Buffer.byteLength(text) })
	})

	app.post('/api/output/images', async (c) => {
		const body = (await c.req.json()) as { name?: string; images?: string[] }
		const images = Array.isArray(body.images) ? body.images.slice(0, 100) : []
		if (!images.length) throw new Error('No images to save')
		const dir = join(outputsDir(), `${safeName(body.name ?? 'images')}-${Date.now()}`)
		mkdirSync(dir, { recursive: true })
		const paths: string[] = []
		for (let i = 0; i < images.length; i++) {
			const image = images[i]
			const match = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/.exec(image)
			if (!match) continue
			const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
			const file = join(dir, `image-${String(i + 1).padStart(3, '0')}.${ext}`)
			writeFileSync(file, Buffer.from(match[2], 'base64'))
			paths.push(file)
		}
		return c.json({ dir, paths })
	})

	app.post('/api/raw-model', async (c) => {
		const body = (await c.req.json()) as {
			url?: string
			model?: string
			/** `secret:<id>` from the saved-key store, or `env:NAME`. */
			keyRef?: string
			/** Older name for `keyRef`, kept so saved canvases still work. */
			keyName?: string
			system?: string
			prompt?: string
			temperature?: number
			thinking?: string
			maxTokens?: number
			/** Legacy: a key typed straight into the node. New canvases never send this. */
			apiKey?: string
		}
		const base = (body.url ?? '').trim().replace(/\/$/, '')
		if (!/^https?:\/\//.test(base)) throw new Error('URL must start with http:// or https://')
		const model = (body.model ?? '').trim()
		if (!model) throw new Error('Set a model id')
		const key = (body.apiKey ?? '').trim() || resolveSecret(body.keyRef ?? body.keyName, process.env, getSecretValue)
		const endpoint = /\/(chat\/completions|completions|messages)$/.test(base) ? base : `${base}/chat/completions`
		const thinking = body.thinking && body.thinking !== 'off' ? body.thinking : undefined
		const payload: Record<string, unknown> = {
			model,
			messages: [
				...(body.system ? [{ role: 'system', content: body.system }] : []),
				{ role: 'user', content: body.prompt ?? '' },
			],
			...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
			...(typeof body.maxTokens === 'number' && body.maxTokens > 0 ? { max_tokens: body.maxTokens } : {}),
			...(thinking ? { reasoning_effort: thinking } : {}),
		}
		const started = Date.now()
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(key ? { Authorization: `Bearer ${key}` } : {}),
			},
			body: JSON.stringify(payload),
			// Stop (WP19 Part 2) closes the client request; combine with the hard timeout.
			signal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(60_000)]),
		})
		if (!response.ok) throw new Error((await response.text()).slice(0, 400) || `Model ${response.status}`)
		const data = (await response.json()) as {
			choices?: { message?: { content?: string | { text?: string }[] }; text?: string }[]
			usage?: unknown
		}
		const choice = data.choices?.[0]
		const content = choice?.message?.content
		const text =
			typeof content === 'string'
				? content
				: Array.isArray(content)
					? content.map((part) => part.text ?? '').join('')
					: (choice?.text ?? '')
		return c.json({ text: text.trim(), usage: normalizeLlmUsage(data.usage, Date.now() - started) })
	})

	app.get('/api/hub/openrouter', async (c) => {
		const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15_000) })
		if (!response.ok) throw new Error(`OpenRouter ${response.status}`)
		const models = freeModels(modelsFromPayload(await response.json(), 'OpenRouter /api/v1/models'))
		return c.json({ models })
	})

	app.post('/api/history', (c) => c.json({ ok: true }))

	app.get('/api/history', (c) => c.json({ ops: [] }))

	app.post('/api/backup', async (c) => {
		const body = (await c.req.json()) as { snapshot?: unknown }
		const name = `canvas-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
		const dir = join(dataDir(), 'backups')
		mkdirSync(dir, { recursive: true })
		writeFileSync(join(dir, name), JSON.stringify(stripSecrets(body.snapshot ?? {})))
		return c.json({ name, target: 'folder' })
	})
}
