/**
 * Stop (WP19 Part 2) aborts in-flight server calls through an `AbortSignal`. A node's own
 * catch block uses this to tell "the user pressed Stop" apart from a real failure, so it can
 * leave its error field empty instead of showing the browser's raw "The operation was aborted"
 * message in the result box.
 */
export function isAbortError(error: unknown): boolean {
	if (!error) return false
	if (error instanceof DOMException) return error.name === 'AbortError'
	if (error instanceof Error) return error.name === 'AbortError'
	return false
}
