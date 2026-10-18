/**
 * Delays execution for a specified number of milliseconds.
 * @param ms - The number of milliseconds to delay.
 * @param signal - Aborts the wait early (FLOW-04: Stop must interrupt an in-flight Sleep, not
 *   just skip whatever was still downstream of it). Rejects the same way `fetch`/SDK calls do
 *   elsewhere in this codebase (`new DOMException(..., 'AbortError')`, see
 *   `client/pipeline/nodes/types/HtmlPreviewNode.tsx`), so `isAbortError`/the run engine's
 *   stopped-vs-failed check treat it the same way.
 * @returns A promise that resolves after the specified delay, or rejects if aborted first.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException('Stopped', 'AbortError'))
			return
		}
		const timer = setTimeout(resolve, ms)
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer)
				reject(new DOMException('Stopped', 'AbortError'))
			},
			{ once: true }
		)
	})
}
