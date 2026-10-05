/** Local tools, model lists, backup, history, SQLite import, and Hugging Face inference. */

import { createHash, createHmac } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { Hono } from 'hono'
import { freeModels, modelsFromPayload, pickCandidates } from '../shared/modelPick'

const LOCAL_TOOLS = new Set(['gawk', 'awk', 'grep', 'sed', 'cut', 'sort', 'uniq', 'wc'])
const AGENTS = new Set(['grok', 'pi', 'omp'])

interface Job {
	lines: string[]
	done: boolean
	code: number | null
	error: string | null
}

const jobs = new Map<string, Job>()

function dataDir() {
	return resolve(process.env.DATA_DIR ?? join(process.cwd(), 'data'))
}

function runProcess(cmd: string, args: string[], stdin?: string, timeoutMs = 20000): Promise<{ code: number; out: string; err: string }> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(cmd, args, { shell: false })
		let out = ''
		let err = ''
		const timer = setTimeout(() => {
			child.kill('SIGTERM')
			reject(new Error(`${cmd} timed out`))
		}, timeoutMs)
		child.stdout.on('data', (chunk) => {
			out += String(chunk)
			if (out.length > 200_000) out = out.slice(-200_000)
		})
		child.stderr.on('data', (chunk) => {
			err += String(chunk)
		})
		child.on('error', (error) => {
			clearTimeout(timer)
			reject(error)
		})
		child.on('close', (code) => {
			clearTimeout(timer)
			resolvePromise({ code: code ?? 1, out, err })
		})
		if (stdin) child.stdin.write(stdin)
		child.stdin.end()
	})
}

function safeArgs(value: unknown): string[] {
	if (typeof value !== 'string' || !value.trim()) return []
	if (/[\n\r\0]/.test(value)) throw new Error('Arguments must be one line')
	return value.trim().split(/\s+/).slice(0, 24)
}

function allowedDb(file: string): string {
	const path = resolve(file)
	if (!/\.(sqlite3?|db)$/i.test(path)) throw new Error('Use a .sqlite, .sqlite3, or .db file')
	const roots = [homedir(), '/tmp', dataDir()]
	const ok = roots.some((root) => path === root || path.startsWith(resolve(root) + sep))
	if (!ok || !isAbsolute(path)) throw new Error('Keep the database under your home folder, /tmp, or the data folder')
	if (!existsSync(path)) throw new Error('File not found')
	return path
}

function s3ConfigPath() {
	return join(dataDir(), 'backup-s3.json')
}

interface S3Config {
	endpoint: string
	bucket: string
	region: string
	accessKey: string
	secretKey: string
	prefix: string
}

function readS3(): S3Config | null {
	if (!existsSync(s3ConfigPath())) return null
	return JSON.parse(readFileSync(s3ConfigPath(), 'utf8')) as S3Config
}

function hmac(key: Buffer | string, data: string) {
	return createHmac('sha256', key).update(data).digest()
}

function signKey(secret: string, date: string, region: string, service: string) {
	const kDate = hmac(`AWS4${secret}`, date)
	const kRegion = hmac(kDate, region)
	const kService = hmac(kRegion, service)
	return hmac(kService, 'aws4_request')
}

/** PUT one object to an S3-compatible endpoint. */
export function s3Authorization(config: S3Config, key: string, body: string, now = new Date()): { url: string; headers: Record<string, string> } {
	const endpoint = config.endpoint.replace(/\/$/, '')
	const host = new URL(endpoint).host
	const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
	const date = amzDate.slice(0, 8)
	const payloadHash = createHash('sha256').update(body).digest('hex')
	const canonicalUri = `/${config.bucket}/${config.prefix ?? ''}${key}`.replace(/\/{2,}/g, '/')
	const headers: Record<string, string> = {
		host,
		'x-amz-content-sha256': payloadHash,
		'x-amz-date': amzDate,
	}
	const signed = Object.keys(headers).sort()
	const canonicalHeaders = signed.map((name) => `${name}:${headers[name].trim()}\n`).join('')
	const canonical = ['PUT', canonicalUri, '', canonicalHeaders, signed.join(';'), payloadHash].join('\n')
	const scope = `${date}/${config.region || 'us-east-1'}/s3/aws4_request`
	const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonical).digest('hex')].join('\n')
	const signature = createHmac('sha256', signKey(config.secretKey, date, config.region || 'us-east-1', 's3'))
		.update(stringToSign)
		.digest('hex')
	return {
		url: `${endpoint}${canonicalUri}`,
		headers: {
			...headers,
			Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`,
			'Content-Type': 'application/json',
		},
	}
}

async function putS3(name: string, body: string) {
	const config = readS3()
	if (!config?.endpoint || !config.bucket || !config.accessKey || !config.secretKey) {
		throw new Error('Set S3 endpoint, bucket, and keys first')
	}
	const signed = s3Authorization(config, name, body)
	const response = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body })
	if (!response.ok) throw new Error(`S3 put failed (${response.status})`)
}

export function registerBatchRoutes(app: Hono) {
	app.post('/api/tool', async (c) => {
		const body = (await c.req.json()) as { tool?: string; args?: string; stdin?: string; host?: string; remote?: boolean }
		if (body.remote) {
			const host = (body.host ?? '').trim()
			if (!/^[A-Za-z0-9._@:-]+$/.test(host)) throw new Error('Host must be user@host or a host name')
			const command = (body.args ?? '').trim()
			if (!command || /[\n\r]/.test(command)) throw new Error('Enter one remote command')
			const result = await runProcess('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, command], body.stdin)
			if (result.code !== 0) throw new Error(result.err || result.out || `ssh exited ${result.code}`)
			return c.json({ output: result.out })
		}
		const tool = body.tool ?? ''
		if (!LOCAL_TOOLS.has(tool)) throw new Error('Tool must be gawk, awk, grep, sed, cut, sort, uniq, or wc')
		const result = await runProcess(tool, safeArgs(body.args), body.stdin ?? '')
		if (result.code !== 0 && !result.out) throw new Error(result.err || `${tool} exited ${result.code}`)
		return c.json({ output: result.out || result.err })
	})

	app.post('/api/hf', async (c) => {
		const body = (await c.req.json()) as { model?: string; input?: string; token?: string }
		const model = (body.model ?? '').trim()
		if (!/^[\w./-]+$/.test(model)) throw new Error('Set a Hugging Face model id')
		const token = (body.token || process.env.HF_TOKEN || '').trim()
		if (!token) throw new Error('Set a Hugging Face token on the node or HF_TOKEN')
		const response = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ inputs: body.input ?? '' }),
		})
		const type = response.headers.get('content-type') ?? ''
		if (!response.ok) throw new Error((await response.text()).slice(0, 400) || `Hugging Face ${response.status}`)
		if (type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/')) {
			const bytes = Buffer.from(await response.arrayBuffer())
			return c.json({ output: `data:${type};base64,${bytes.toString('base64')}` })
		}
		const text = await response.text()
		return c.json({ output: text.slice(0, 100_000) })
	})

	app.get('/api/hub/openrouter', async (c) => {
		const response = await fetch('https://openrouter.ai/api/v1/models')
		if (!response.ok) throw new Error(`OpenRouter ${response.status}`)
		const models = freeModels(modelsFromPayload(await response.json(), 'OpenRouter /api/v1/models'))
		return c.json({ models })
	})

	app.get('/api/hub/opencode-go', async (c) => {
		const response = await fetch('https://opencode.ai/zen/go/v1/models')
		if (!response.ok) throw new Error(`OpenCode Go ${response.status}`)
		const models = modelsFromPayload(await response.json(), 'https://opencode.ai/zen/go/v1/models')
		const free = freeModels(models)
		return c.json({ models: free.length ? free : models, freeOnly: free.length > 0 })
	})

	app.get('/api/hub/candidates', async (c) => {
		const response = await fetch('https://openrouter.ai/api/v1/models')
		if (!response.ok) throw new Error(`OpenRouter ${response.status}`)
		const models = modelsFromPayload(await response.json(), 'OpenRouter /api/v1/models')
		const picks = pickCandidates(models, c.req.query('task') ?? 'chat', c.req.query('band') ?? 'low')
		return c.json({
			picks,
			note: 'Price, modality, and the reasoning flag come from OpenRouter. The band is a price third. It is not an IQ score.',
		})
	})

	app.post('/api/agent-job', async (c) => {
		const body = (await c.req.json()) as { cli?: string; prompt?: string }
		const cli = body.cli ?? ''
		if (!AGENTS.has(cli)) throw new Error('Choose grok, pi, or omp')
		const prompt = (body.prompt ?? '').trim()
		if (!prompt) throw new Error('Prompt is required')
		const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
		const job: Job = { lines: [], done: false, code: null, error: null }
		jobs.set(id, job)
		const child = spawn(cli, [prompt], { shell: false })
		const push = (chunk: unknown) => {
			const text = String(chunk).trim()
			if (!text) return
			job.lines.push(text.slice(0, 2000))
			if (job.lines.length > 200) job.lines.shift()
		}
		child.stdout.on('data', push)
		child.stderr.on('data', push)
		child.on('error', (error) => {
			job.error = error.message
			job.done = true
			job.code = 127
		})
		child.on('close', (code) => {
			job.done = true
			job.code = code
		})
		return c.json({ id })
	})

	app.get('/api/agent-job/:id', (c) => {
		const job = jobs.get(c.req.param('id'))
		if (!job) return c.json({ error: 'Job not found' }, 404)
		return c.json(job)
	})

	app.post('/api/sqlite/dump', async (c) => {
		const body = (await c.req.json()) as { path?: string }
		const path = allowedDb(body.path ?? '')
		const result = await runProcess('sqlite3', [path, '.dump'], undefined, 30000)
		if (result.code !== 0) throw new Error(result.err || 'sqlite3 failed')
		return c.json({ sql: result.out })
	})

	app.post('/api/history', async (c) => {
		const op = await c.req.json()
		const dir = join(dataDir(), 'history')
		mkdirSync(dir, { recursive: true })
		appendFileSync(join(dir, 'ops.jsonl'), JSON.stringify(op) + '\n')
		return c.json({ ok: true })
	})

	app.get('/api/history', (c) => {
		const file = join(dataDir(), 'history', 'ops.jsonl')
		if (!existsSync(file)) return c.json({ ops: [] })
		const q = (c.req.query('q') ?? '').toLowerCase()
		const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).slice(-800)
		const ops = []
		for (const line of lines) {
			try {
				const op = JSON.parse(line) as { kind?: string; shapeId?: string; shape?: unknown }
				if (!q || JSON.stringify(op).toLowerCase().includes(q)) ops.push(op)
			} catch {
				// Skip a broken line.
			}
		}
		return c.json({ ops: ops.slice(-80) })
	})

	app.get('/api/backup/s3', (c) => {
		const config = readS3()
		if (!config) return c.json({ set: false })
		return c.json({
			set: true,
			endpoint: config.endpoint,
			bucket: config.bucket,
			region: config.region,
			prefix: config.prefix ?? '',
			hasSecret: Boolean(config.secretKey),
		})
	})

	app.put('/api/backup/s3', async (c) => {
		const body = (await c.req.json()) as S3Config
		if (!body.endpoint || !body.bucket || !body.accessKey) throw new Error('Endpoint, bucket, and access key are required')
		const previous = readS3()
		const next = { ...body, secretKey: body.secretKey || previous?.secretKey || '' }
		if (!next.secretKey) throw new Error('Secret key is required')
		mkdirSync(dataDir(), { recursive: true })
		writeFileSync(s3ConfigPath(), JSON.stringify(next))
		return c.json({ ok: true })
	})

	app.post('/api/backup', async (c) => {
		const body = (await c.req.json()) as { snapshot?: unknown; target?: string }
		const name = `canvas-${Date.now()}.json`
		const text = JSON.stringify(body.snapshot ?? {})
		if (body.target === 's3') await putS3(name, text)
		else {
			const dir = join(dataDir(), 'backups')
			mkdirSync(dir, { recursive: true })
			writeFileSync(join(dir, name), text)
		}
		return c.json({ name, target: body.target === 's3' ? 's3' : 'folder' })
	})
}
