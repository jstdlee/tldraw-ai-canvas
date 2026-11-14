/**
 * WP45: pure helpers for running a Code card — the time limit and turning a JS / TypeScript /
 * Python error into "Line N: message" for the card's error banner. No browser import, so this
 * is testable in Node.
 */

export const CODE_DEFAULT_TIMEOUT_SEC = 10
export const CODE_MAX_TIMEOUT_SEC = 600

/** The Code card's "Timeout (s)": 0.1 to 600 seconds, default 10 (also for an old card that has
 * no such field). */
export function clampCodeTimeoutSec(value: unknown): number {
	const n = Number(value)
	if (value == null || value === '' || !Number.isFinite(n)) return CODE_DEFAULT_TIMEOUT_SEC
	return Math.min(CODE_MAX_TIMEOUT_SEC, Math.max(0.1, n))
}

/**
 * How many lines `new Function('module', 'exports', code)` puts before the user's code: V8
 * wraps the body as "function anonymous(module,exports\n) {\n". Sucrase keeps the line numbers
 * of the source when it strips types and rewrites imports, so after this offset a stack line
 * maps back to the line the user sees in the editor.
 */
export const JS_FUNCTION_HEADER_LINES = 2

/** The user's line number from a V8 stack trace of code run through `new Function`, or null.
 * Frames of that code read "<anonymous>:LINE:COLUMN"; the first such frame is where it threw. */
export function jsErrorLine(stack: string | null | undefined): number | null {
	const match = /<anonymous>:(\d+):(\d+)/.exec(stack ?? '')
	if (!match) return null
	const line = Number(match[1]) - JS_FUNCTION_HEADER_LINES
	return line >= 1 ? line : null
}

/** A sucrase (TypeScript / JavaScript parse) error: "Unexpected token (3:1)" → line 3. */
export function syntaxErrorInfo(message: string): { line: number | null; message: string } {
	const match = /^(.*?)\s*\((\d+):(\d+)\)\s*$/s.exec(message)
	if (!match) return { line: null, message: `Syntax error: ${message}` }
	return { line: Number(match[2]), message: `Syntax error: ${match[1]}` }
}

/**
 * A Python traceback (Pyodide's error message is the whole traceback) → the line in the user's
 * code and the last line, e.g. "NameError: name 'x' is not defined". The code is compiled with
 * the file name "<code>" (see pythonSource.ts), so its frames are easy to tell apart from
 * Pyodide's own.
 */
export function pythonErrorInfo(traceback: string): { line: number | null; message: string } {
	const text = traceback ?? ''
	let line: number | null = null
	for (const match of text.matchAll(/File "<code>", line (\d+)/g)) line = Number(match[1])
	const lines = text
		.split('\n')
		.map((l) => l.trimEnd())
		.filter((l) => l.trim() !== '')
	const message = lines.length ? lines[lines.length - 1].trim() : 'Python error'
	return { line, message }
}

/** "Line 3: message", or the message alone when the line is not known. */
export function formatCodeError(message: string, line: number | null | undefined): string {
	return line ? `Line ${line}: ${message}` : message
}

/** Shown when the Python runtime cannot be downloaded (offline, blocked, or too slow). */
export const PYTHON_DOWNLOAD_MESSAGE =
	'Python needs a one-time download of its runtime (Pyodide, about 10 MB, from cdn.jsdelivr.net), and it could not be loaded. ' +
	'Connect to the internet and run this card once; the browser then keeps a copy for later runs. ' +
	'JavaScript and TypeScript work offline.'
