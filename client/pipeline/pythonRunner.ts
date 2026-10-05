import { pythonProgram, readPythonResult } from '../../shared/pythonSource'
import { CodeRunResult } from './codeRunner'

/**
 * Run Python in Pyodide (WASM). The runtime is loaded on the first call.
 * That download needs a network once; later runs use the browser cache.
 */

const WORKER_SOURCE = `
self.onmessage = async (event) => {
  const { program } = event.data
  try {
    if (!self.pyodide) {
      importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.js')
      self.pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/' })
    }
    const stdout = []
    self.pyodide.setStdout({ batched: (line) => stdout.push(line) })
    await self.pyodide.runPythonAsync(program)
    self.postMessage({ ok: true, stdout: stdout.join('\\n') })
  } catch (error) {
    self.postMessage({ ok: false, error: (error && error.message) || String(error) })
  }
}
`

let workerUrl: string | null = null

export async function runPython(
	source: string,
	inputs: Record<string, string | null>,
	outputIds: string[],
	timeoutMs = 120_000
): Promise<CodeRunResult> {
	const program = pythonProgram(source, inputs, outputIds)
	workerUrl ??= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
	const worker = new Worker(workerUrl)
	try {
		const reply = await new Promise<{ ok: boolean; stdout?: string; error?: string }>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error('Python took too long and was stopped. The first run also downloads the WASM runtime.'))
			}, timeoutMs)
			worker.onmessage = (event) => {
				clearTimeout(timer)
				resolve(event.data)
			}
			worker.onerror = () => {
				clearTimeout(timer)
				reject(new Error('Python failed to start. The first run needs a network to load Pyodide.'))
			}
			worker.postMessage({ program })
		})
		if (!reply.ok) throw new Error(reply.error || 'Python error')
		const { outputs, logs } = readPythonResult(reply.stdout ?? '')
		const text: Record<string, string | null> = {}
		for (const id of outputIds) {
			const value = outputs[id]
			text[id] = value == null ? null : typeof value === 'string' ? value : JSON.stringify(value)
		}
		return { outputs: text, logs: logs ? logs.split('\n') : [] }
	} finally {
		worker.terminate()
	}
}
