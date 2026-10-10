/**
 * `{{name}}` template variables in an LLM card's prompt/instruction/message/
 * system text. Each distinct name becomes an input port on the card.
 */

const VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

export const MAX_TEMPLATE_VARS = 12

/** Distinct variable names across several texts, in order of first appearance, capped at 12. */
export function findVars(texts: (string | null | undefined)[]): string[] {
	const seen = new Set<string>()
	for (const text of texts) {
		if (!text) continue
		for (const match of text.matchAll(VAR_RE)) {
			seen.add(match[1])
			if (seen.size >= MAX_TEMPLATE_VARS) return [...seen]
		}
	}
	return [...seen]
}

/** Replace every `{{name}}` with its value (missing values become ''). */
export function fillVars(text: string, values: Record<string, string>): string {
	return text.replace(VAR_RE, (_whole, name: string) => values[name] ?? '')
}
