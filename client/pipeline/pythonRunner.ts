import { formatCodeError, pythonErrorInfo, PYTHON_DOWNLOAD_MESSAGE } from '../../shared/codeRun'
import { pythonProgram, readPythonLogs, readPythonResult } from '../../shared/pythonSource'
import { CodeRunResult, RunOptions } from './codeRunner'

/**
 * Run Python in Pyodide (WASM), in a Web Worker. The runtime is loaded on the first call.
 *
 * WP49: the runtime ships with the app (the `pyodide` npm package, served at /pyodide/ by
 * scripts/vite-pyodide-plugin.js and copied to dist/pyodide/ on build), so Python runs with no
 * network. The jsDelivr CDN is only a fallback for when the app's own copy is missing. Packages
 * (numpy, pandas, …) are not bundled: an `import` of one downloads it from the CDN on first use.
 *
 * WP45: one loaded worker is kept between runs (it used to be thrown away after every run, so
 * every run loaded Pyodide again). A run that times out or is stopped ends its worker, which is
 * the only way to stop Python that never returns. Loading has its own time limit and a clear
 * message, so an offline machine gets an answer, not a two-minute hang.
 */

const PYODIDE_CDN_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/'
/** How long the one-time runtime load may take before we give up. */
const LOAD_TIMEOUT_MS = 90_000

/** The app's own copy, as an absolute URL (the worker runs from a blob: URL). */
function localPyodideUrl(): string {
	return new URL('pyodide/', new URL(import.meta.env.BASE_URL ?? '/', location.href)).href
}

const WORKER_SOURCE = `
async function loadFrom(indexURL) {
  importScripts(indexURL + 'pyodide.js')
  return await loadPyodide({ indexURL })
}
self.onmessage = async (event) => {
  const { program, code, localURL, cdnURL } = event.data
  if (!self.pyodide) {
    try {
      try {
        self.pyodide = await loadFrom(localURL)
        self.pyodideSource = 'local'
      } catch (localError) {
        self.pyodide = await loadFrom(cdnURL)
        self.pyodideSource = 'cdn'
      }
      // Packages are not bundled: they always come from the CDN.
      self.pyodide._api.config.indexURL = cdnURL
    } catch (error) {
      self.postMessage({ type: 'done', ok: false, loadFailed: true, error: (error && error.message) || String(error) })
      return
    }
  }
  self.postMessage({ type: 'loaded', source: self.pyodideSource })
  const stdout = []
  self.pyodide.setStdout({ batched: (line) => stdout.push(line) })
  try {
    try {
      await self.pyodide.loadPackagesFromImports(code)
    } catch (error) {
      throw new Error('A Python package could not be downloaded (packages such as numpy come from cdn.jsdelivr.net on first use): ' + ((error && error.message) || String(error)))
    }
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
			worker.postMessage({ program, code: source, localURL: localPyodideUrl(), cdnURL: PYODIDE_CDN_URL })
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
