/**
 * Text for a failed node run.
 * `Error.message` has no "Error: " prefix. `String(error)` does. Drop that prefix.
 */
export function runErrorMessage(error: unknown): string {
	const raw = error instanceof Error && error.message ? error.message : String(error)
	return raw.replace(/^Error:\s*/, '')
}
