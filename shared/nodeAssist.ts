/** Tolerant JSON extraction shared by every AI reply parser (shared/aiPlan.ts). */

/** Pull the first JSON object out of a reply: fenced code block, or the outermost {…}. */
export function extractJsonObject(text: string): unknown {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
	const raw = (fenced ? fenced[1] : text).trim()
	const start = raw.indexOf('{')
	const end = raw.lastIndexOf('}')
	if (start < 0 || end <= start) throw new Error('The reply has no JSON object')
	return JSON.parse(raw.slice(start, end + 1))
}
