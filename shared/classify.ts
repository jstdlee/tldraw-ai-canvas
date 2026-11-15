/**
 * WP50: the Classify card's pure logic — label parsing, the JSON prompt, and validation of the
 * model's JSON reply (the card retries once with the problems listed). Tested in
 * tests/classify.test.ts.
 */

export interface LabelDef {
	label: string
	description?: string
}

export interface ClassifyResult {
	labels: string[]
	/** Model-reported confidence, 0–1. */
	confidence: number
}

/**
 * One label per line, an optional description after the first ":" ("spam: unwanted ads").
 * Blank lines and "- " / "* " / "1. " list markers are ignored; duplicates (case-insensitive)
 * keep the first.
 */
export function parseLabels(text: string): LabelDef[] {
	const seen = new Set<string>()
	const out: LabelDef[] = []
	for (const raw of (text ?? '').split(/\r?\n/)) {
		const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()
		if (!line) continue
		const colon = line.indexOf(':')
		const label = (colon >= 0 ? line.slice(0, colon) : line).trim()
		const description = colon >= 0 ? line.slice(colon + 1).trim() : ''
		if (!label || seen.has(label.toLowerCase())) continue
		seen.add(label.toLowerCase())
		out.push(description ? { label, description } : { label })
	}
	return out
}

export function buildClassifyPrompt(input: string, labels: LabelDef[], multi: boolean): string {
	const list = labels.map((l) => `- ${l.label}${l.description ? `: ${l.description}` : ''}`).join('\n')
	const rule = multi
		? 'Pick every label that applies (at least one).'
		: 'Pick exactly one label: the one that fits best.'
	return [
		'Classify the input below.',
		rule,
		'Labels:',
		list,
		'',
		'Reply with JSON only, no other text, in this form:',
		multi
			? '{"labels": ["<label>", "<label>"], "confidence": <number from 0 to 1>}'
			: '{"labels": ["<label>"], "confidence": <number from 0 to 1>}',
		'Use the label names exactly as listed. "confidence" is how sure you are.',
		'',
		'Input:',
		input,
	].join('\n')
}

/** The first JSON object in a reply (fenced or bare, think blocks dropped). */
function findJsonObject(reply: string): unknown {
	const text = (reply ?? '').replace(/<think>[\s\S]*?<\/think>/g, '')
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
	const body = fenced ? fenced[1] : text
	const start = body.indexOf('{')
	const end = body.lastIndexOf('}')
	if (start < 0 || end <= start) throw new Error('the reply has no JSON object')
	try {
		return JSON.parse(body.slice(start, end + 1))
	} catch {
		throw new Error('the reply is not valid JSON')
	}
}

/**
 * Parse and check a model reply. Returns the result, or a list of problems to send back to the
 * model on the retry. Accepts `label` (a string) as well as `labels` (a list).
 */
export function validateClassifyReply(
	reply: string,
	labels: LabelDef[],
	multi: boolean
): { ok: true; result: ClassifyResult } | { ok: false; problems: string[] } {
	let json: unknown
	try {
		json = findJsonObject(reply)
	} catch (e) {
		return { ok: false, problems: [(e as Error).message] }
	}
	const problems: string[] = []
	const obj = (json ?? {}) as Record<string, unknown>
	const rawLabels: unknown = Array.isArray(obj.labels) ? obj.labels : typeof obj.label === 'string' ? [obj.label] : obj.labels
	let picked: string[] = []
	if (!Array.isArray(rawLabels)) problems.push('"labels" must be a list of label names')
	else {
		const byLower = new Map(labels.map((l) => [l.label.toLowerCase(), l.label]))
		for (const value of rawLabels) {
			const name = typeof value === 'string' ? byLower.get(value.trim().toLowerCase()) : undefined
			if (!name) problems.push(`"${String(value)}" is not one of the labels`)
			else if (!picked.includes(name)) picked.push(name)
		}
		if (!picked.length && !problems.length) problems.push('pick at least one label')
		if (!multi && picked.length > 1) problems.push('pick exactly one label')
	}
	const conf = typeof obj.confidence === 'string' ? Number(obj.confidence) : obj.confidence
	if (typeof conf !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1) {
		problems.push('"confidence" must be a number from 0 to 1')
	}
	if (problems.length) return { ok: false, problems }
	if (!multi) picked = picked.slice(0, 1)
	return { ok: true, result: { labels: picked, confidence: Math.round((conf as number) * 1000) / 1000 } }
}

/** The retry prompt: the first prompt plus what was wrong with the last reply. */
export function buildClassifyRetryPrompt(prompt: string, problems: string[]): string {
	return `${prompt}\n\nYour last reply had these problems:\n${problems.map((p) => `- ${p}`).join('\n')}\nReply again with JSON only.`
}

/**
 * Classify one input with a text model: ask, validate, retry once with the problems listed.
 * `generate` is the model call (the card passes `apiGenerateText`); throws a short message when
 * the second reply is still invalid.
 */
export async function classifyWithRetry(
	input: string,
	labels: LabelDef[],
	multi: boolean,
	generate: (prompt: string) => Promise<string>
): Promise<ClassifyResult> {
	const prompt = buildClassifyPrompt(input, labels, multi)
	const first = validateClassifyReply(await generate(prompt), labels, multi)
	if (first.ok) return first.result
	const second = validateClassifyReply(await generate(buildClassifyRetryPrompt(prompt, first.problems)), labels, multi)
	if (second.ok) return second.result
	throw new Error(`The model did not return a valid label (${second.problems.join('; ')}). Try a stronger model or clearer labels.`)
}
