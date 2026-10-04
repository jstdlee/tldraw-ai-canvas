import { generateText } from 'ai'
import { ConfigError, resolveModel } from './config'
import { getLanguageModel } from './llm'

/**
 * JEV decisions: a question + context → probabilities over answers.
 *  - System One API (e.g. Julia-1 /v1/systemone): native choice / yes-no / score.
 *  - Any chat model: asked for calibrated probabilities as JSON.
 */

export type JevKind = 'noul' | 'choice' | 'score'

export interface JevRequest {
	model?: string
	question: string
	context?: string
	type: JevKind
	/** Choice options ("label" or "label: description"). */
	options?: string[]
	/** Score levels, worst first. */
	levels?: string[]
}

export interface JevResult {
	type: JevKind
	answer: string
	probabilities: Record<string, number>
	confidence: number | null
	source: string
}

function parseOption(line: string): { label: string; description: string } {
	const m = line.match(/^\s*([^:]{1,60}):\s*(.+)$/)
	return m ? { label: m[1].trim(), description: m[2].trim() } : { label: line.trim(), description: line.trim() }
}

function normalize(probs: Record<string, number>): Record<string, number> {
	const entries = Object.entries(probs).filter(([, v]) => Number.isFinite(v) && v >= 0)
	const total = entries.reduce((s, [, v]) => s + v, 0)
	if (!entries.length || total <= 0) return probs
	return Object.fromEntries(entries.map(([k, v]) => [k, v / total]))
}

function top(probs: Record<string, number>) {
	return Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

export async function decide(req: JevRequest): Promise<JevResult> {
	if (!req.question?.trim()) throw new ConfigError('A question is required')
	const options = (req.options ?? []).map(parseOption).filter((o) => o.label)
	if (req.type === 'choice' && options.length < 2) throw new ConfigError('A choice needs at least 2 options (one per line)')
	const levels = (req.levels ?? []).map((l) => l.trim()).filter(Boolean)
	if (req.type === 'score' && levels.length < 2) throw new ConfigError('A score needs at least 2 levels (worst first)')

	const { model, provider } = resolveModel(req.model, 'jev')
	if (provider.kind === 'systemone') return systemOne(provider.baseURL, provider.apiKey, model.model, req, options, levels)
	return llmDecision(req, options, levels, getLanguageModel(provider, model), model.key)
}

async function systemOne(
	baseURL: string | undefined,
	apiKey: string | undefined,
	modelId: string,
	req: JevRequest,
	options: { label: string; description: string }[],
	levels: string[]
): Promise<JevResult> {
	const base = (baseURL ?? 'http://127.0.0.1:8011').replace(/\/+$/, '').replace(/\/v1$/, '')
	const question: Record<string, unknown> = { type: req.type, instructions: req.question.trim() }
	if (req.type === 'choice') question.criteria = Object.fromEntries(options.map((o) => [o.label, o.description]))
	if (req.type === 'score') question.criteria = levels
	const res = await fetch(`${base}/v1/systemone`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
		body: JSON.stringify({
			model: modelId || 'auto',
			// The model reads at most ~8k tokens of state.
			state: (req.context ?? '').slice(0, 24_000) || '(no context)',
			questions: { decision: question },
		}),
		signal: AbortSignal.timeout(60_000),
	})
	const data = (await res.json().catch(() => ({}))) as any
	if (!res.ok) throw new Error(`System One API ${res.status}: ${data?.detail ?? data?.error ?? JSON.stringify(data).slice(0, 300)}`)
	const a = data.answers?.decision
	if (!a) throw new Error('System One API returned no answer')
	if (req.type === 'noul') {
		const p = Number(a.noul)
		return { type: 'noul', answer: p >= 0.5 ? 'yes' : 'no', probabilities: { yes: p, no: 1 - p }, confidence: a.confidence ?? null, source: data.model ?? 'systemone' }
	}
	if (req.type === 'choice') {
		const probs = normalize(a.probabilities ?? { [a.choice]: 1 })
		return { type: 'choice', answer: a.choice ?? top(probs), probabilities: probs, confidence: a.confidence ?? a.max_probability ?? null, source: data.model ?? 'systemone' }
	}
	const raw = (a.probabilities ?? {}) as Record<string, number>
	const probs = normalize(Object.fromEntries(Object.entries(raw).map(([i, p]) => [levels[Number(i)] ?? i, p])))
	const idx = Math.round(Number(a.score))
	return { type: 'score', answer: levels[idx] ?? String(a.score), probabilities: probs, confidence: a.confidence ?? null, source: data.model ?? 'systemone' }
}

async function llmDecision(
	req: JevRequest,
	options: { label: string; description: string }[],
	levels: string[],
	model: ReturnType<typeof getLanguageModel>,
	modelKey: string
): Promise<JevResult> {
	const labels = req.type === 'noul' ? ['yes', 'no'] : req.type === 'choice' ? options.map((o) => o.label) : levels
	const described =
		req.type === 'choice'
			? options.map((o) => `- ${o.label}${o.description !== o.label ? `: ${o.description}` : ''}`).join('\n')
			: labels.map((l) => `- ${l}`).join('\n')
	const { text } = await generateText({
		model,
		system:
			'You are a careful judge. Read the context and the question, then give a calibrated probability for each answer. ' +
			'Probabilities must add up to 1. Reply with JSON only: {"probabilities": {"<answer>": <number>, ...}, "reason": "<one short sentence>"}',
		prompt: `Context:\n${(req.context ?? '').slice(0, 40_000) || '(none)'}\n\nQuestion: ${req.question}\n\nAnswers (use these exact keys):\n${described}`,
		temperature: 0,
		maxOutputTokens: 2000,
	})
	const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
	let parsed: { probabilities?: Record<string, number> } = {}
	try {
		parsed = JSON.parse(json)
	} catch {
		throw new Error(`The model did not return probabilities: ${text.slice(0, 200)}`)
	}
	const probs = normalize(
		Object.fromEntries(labels.map((l) => [l, Number(parsed.probabilities?.[l] ?? parsed.probabilities?.[l.toLowerCase()] ?? 0)]))
	)
	const answer = top(probs)
	return { type: req.type, answer, probabilities: probs, confidence: probs[answer] ?? null, source: modelKey }
}
