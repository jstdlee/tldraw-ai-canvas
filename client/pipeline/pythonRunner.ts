import { formatCodeError, pythonErrorInfo, PYTHON_DOWNLOAD_MESSAGE } from '../../shared/codeRun'
import { pythonProgram, readPythonLogs, readPythonResult } from '../../shared/pythonSource'
import { CodeRunResult, RunOptions } from './codeRunner'

/**
 * Run Python in Pyodide (WASM), in a Web Worker. The runtime is loaded on the first call.
 * That download needs a network once; later loads come from the browser cache.
 *
 * WP45: one loaded worker is kept between runs (it used to be thrown away after every run, so
 * every run loaded Pyodide again). A run that times out or is stopped ends its worker, which is
 * the only way to stop Python that never returns. Loading has its own time limit and a clear
 * message, so an offline machine gets an answer, not a two-minute hang.
 */

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/'
/** How long the one-time runtime download may take before we give up. */
const LOAD_TIMEOUT_MS = 90_000

const WORKER_SOURCE = `
self.onmessage = async (event) => {
  const { program } = event.data
  if (!self.pyodide) {
    try {
      importScripts('${PYODIDE_URL}pyodide.js')
      self.pyodide = await loadPyodide({ indexURL: '${PYODIDE_URL}' })
    } catch (error) {
      self.postMessage({ type: 'done', ok: false, loadFailed: true, error: (error && error.message) || String(error) })
      return
    }
  }
  self.postMessage({ type: 'loaded' })
  const stdout = []
  self.pyodide.setStdout({ batched: (line) => stdout.push(line) })
  try {
    await self.pyodide.runPythonAsync(program)
    self.postMessage({ type: 'done', ok: true, stdout: stdout.join('\\n') })
  } catch (error) {
    self.postMessage({ type: 'done', ok: false, error: (error && error.message) || String(error), stdout: stdout.join('\\n') })
  }
}
`

interface PythonReply {
	type: 'done'
	ok: boolean
	loadFailed?: boolean
	error?: string
	stdout?: string
}

let workerUrl: string | null = null
/** A worker with Pyodide already loaded (or loading), free for the next run. */
let idleWorker: Worker | null = null

function takeWorker(): Worker {
	const worker = idleWorker
	idleWorker = null
	if (worker) return worker
	workerUrl ??= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
	return new Worker(workerUrl)
}

function giveBack(worker: Worker) {
	// Two Python cards running at the same time each get a worker; keep just one afterwards.
	if (idleWorker) worker.terminate()
	else idleWorker = worker
}

export async function runPython(
	source: string,
	inputs: Record<string, string | null>,
	outputIds: string[],
	options: RunOptions = {}
): Promise<CodeRunResult> {
	const timeoutMs = options.timeoutMs ?? 10_000
	const signal = options.signal
	if (signal?.aborted) throw new DOMException('Stopped', 'AbortError')
	const program = pythonProgram(source, inputs, outputIds)
	const worker = takeWorker()
	let healthy = false
	let onAbort: (() => void) | null = null
	try {
		const reply = await new Promise<PythonReply>((resolve, reject) => {
			// First the runtime load (only slow the first time), then the user's own time limit.
			let timer = setTimeout(() => reject(new Error(PYTHON_DOWNLOAD_MESSAGE)), LOAD_TIMEOUT_MS)
			onAbort = () => {
				clearTimeout(timer)
				reject(new DOMException('Stopped', 'AbortError'))
			}
			signal?.addEventListener('abort', onAbort, { once: true })
			worker.onmessage = (event: MessageEvent<PythonReply | { type: 'loaded' }>) => {
				if (event.data.type === 'loaded') {
					clearTimeout(timer)
					timer = setTimeout(
						() => reject(new Error(`Python took longer than ${timeoutMs / 1000} s and was stopped (Timeout field)`)),
						timeoutMs
					)
					return
				}
				clearTimeout(timer)
				resolve(event.data)
			}
			worker.onerror = () => {
				clearTimeout(timer)
				reject(new Error(PYTHON_DOWNLOAD_MESSAGE))
			}
			worker.postMessage({ program })
		})
		if (reply.loadFailed) throw new Error(PYTHON_DOWNLOAD_MESSAGE)
		// A Python error leaves the runtime fine: keep the worker for the next run.
		healthy = true
		const stdout = reply.stdout ?? ''
		if (!reply.ok) {
			const info = pythonErrorInfo(reply.error || 'Python error')
			const logs = readPythonLogs(stdout)
			throw Object.assign(new Error(formatCodeError(info.message, info.line)), { logs: logs ? logs.split('\n') : [] })
		}
		const { outputs, logs } = readPythonResult(stdout)
		const text: Record<string, string | null> = {}
		for (const id of outputIds) {
			const value = outputs[id]
			text[id] = value == null ? null : typeof value === 'string' ? value : JSON.stringify(value)
		}
		return { outputs: text, logs: logs ? logs.split('\n') : [] }
	} finally {
		if (onAbort) signal?.removeEventListener('abort', onAbort)
		if (healthy) giveBack(worker)
		else worker.terminate()
	}
}
