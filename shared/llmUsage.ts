/** Token and time figures for one model call. */

export interface LlmUsage {
	inputTokens?: number
	outputTokens?: number
	totalTokens?: number
	ms?: number
}

export function formatRunMs(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return ''
	if (ms < 1000) return `${Math.round(ms)} ms`
	const seconds = ms / 1000
	return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`
}

/** "128 tok · 20 in / 108 out · 1.4 s · 77 tok/s" */
export function formatLlmUsage(usage: LlmUsage): string {
	const parts: string[] = []
	const total =
		usage.totalTokens ??
		(usage.inputTokens != null || usage.outputTokens != null
			? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
			: undefined)
	if (total) parts.push(`${total} tok`)
	if (usage.inputTokens != null || usage.outputTokens != null) {
		parts.push(`${usage.inputTokens ?? 0} in / ${usage.outputTokens ?? 0} out`)
	}
	if (usage.ms != null) {
		const time = formatRunMs(usage.ms)
		if (time) parts.push(time)
	}
	if (usage.outputTokens && usage.ms && usage.ms > 0) {
		const tps = usage.outputTokens / (usage.ms / 1000)
		parts.push(`${tps >= 10 ? Math.round(tps) : tps.toFixed(1)} tok/s`)
	}
	return parts.join(' · ')
}

/** Accept AI SDK names (`inputTokens`) and older names (`promptTokens`). */
export function normalizeLlmUsage(raw: unknown, ms?: number): LlmUsage {
	const usage = (raw ?? {}) as Record<string, unknown>
	const inputTokens = asCount(usage.inputTokens ?? usage.promptTokens)
	const outputTokens = asCount(usage.outputTokens ?? usage.completionTokens)
	const totalTokens =
		asCount(usage.totalTokens) ??
		(inputTokens != null || outputTokens != null ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined)
	return { inputTokens, outputTokens, totalTokens, ms }
}

function asCount(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Pull a trailing `[usage] {json}` line off a chat stream. Hide a partial trailer too. */
export function takeUsageTrailer(text: string): { text: string; usage?: LlmUsage } {
	const marker = '\n\n[usage] '
	const at = text.lastIndexOf(marker)
	if (at === -1) return { text }
	const raw = text.slice(at + marker.length).trim()
	try {
		return { text: text.slice(0, at), usage: normalizeLlmUsage(JSON.parse(raw)) }
	} catch {
		return { text: text.slice(0, at) }
	}
}
