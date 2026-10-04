import { transform } from 'sucrase'

/**
 * Runs Code-node functions. TypeScript is turned into JavaScript with sucrase,
 * then the function runs in a Web Worker (no access to the page or canvas)
 * with a time limit.
 */

export interface CodeRunResult {
	outputs: Record<string, string | null>
	logs: string[]
}

export function compileCode(source: string, lang: 'ts' | 'js'): string {
	return transform(source, {
		transforms: lang === 'ts' ? ['typescript', 'imports'] : ['imports'],
		production: true,
	}).code
}

const WORKER_SOURCE = `
const logs = []
const fmt = (args) => args.map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch { return String(a) } })())).join(' ')
console.log = (...a) => logs.push(fmt(a))
console.info = console.log
console.warn = (...a) => logs.push('warn: ' + fmt(a))
console.error = (...a) => logs.push('error: ' + fmt(a))
self.onmessage = async (event) => {
	const { code, inputs } = event.data
	try {
		const module = { exports: {} }
		const exports = module.exports
		new Function('module', 'exports', code)(module, exports)
		const fn = module.exports.default ?? module.exports.run ?? (typeof module.exports === 'function' ? module.exports : null)
		if (typeof fn !== 'function') throw new Error('Export a function: export default function run(inputs) { … }')
		const result = await fn(inputs)
		self.postMessage({ ok: true, result: toTransferable(result), logs })
	} catch (e) {
		self.postMessage({ ok: false, error: (e && e.message) || String(e), logs })
	}
}
function toTransferable(v) {
	if (v === undefined) return null
	try { return JSON.parse(JSON.stringify(v)) } catch { return String(v) }
}
`

let workerUrl: string | null = null

function stringify(v: unknown): string | null {
	if (v == null) return null
	return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
}

export async function runCode(
	source: string,
	lang: 'ts' | 'js',
	inputs: Record<string, string | null>,
	outputIds: string[],
	timeoutMs = 15_000
): Promise<CodeRunResult> {
	const code = compileCode(source, lang)
	workerUrl ??= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
	const worker = new Worker(workerUrl)
	try {
		const reply = await new Promise<{ ok: boolean; result?: unknown; error?: string; logs: string[] }>(
			(resolve, reject) => {
				const timer = setTimeout(() => reject(new Error(`Code took longer than ${timeoutMs / 1000}s and was stopped`)), timeoutMs)
				worker.onmessage = (e) => {
					clearTimeout(timer)
					resolve(e.data)
				}
				worker.onerror = (e) => {
					clearTimeout(timer)
					reject(new Error(e.message || 'Code error'))
				}
				worker.postMessage({ code, inputs })
			}
		)
		if (!reply.ok) throw Object.assign(new Error(reply.error), { logs: reply.logs })
		const result = reply.result
		const outputs: Record<string, string | null> = {}
		// Several outputs: return { out1, out2, … }. One output: return any value.
		if (
			outputIds.length > 1 &&
			result &&
			typeof result === 'object' &&
			!Array.isArray(result) &&
			outputIds.some((id) => id in (result as object))
		) {
			for (const id of outputIds) outputs[id] = stringify((result as Record<string, unknown>)[id])
		} else {
			outputs[outputIds[0]] = stringify(result)
			for (const id of outputIds.slice(1)) outputs[id] = null
		}
		return { outputs, logs: reply.logs }
	} finally {
		worker.terminate()
	}
}

/** Pull the code out of a model reply (drops ``` fences and chatter). */
export function extractCode(reply: string): string {
	const fenced = reply.match(/```(?:ts|typescript|js|javascript)?\s*\n([\s\S]*?)```/)
	return (fenced ? fenced[1] : reply).trim() + '\n'
}
