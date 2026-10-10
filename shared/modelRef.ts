/**
 * A model field on an LLM card holds either a configured model key (today's
 * plain string, e.g. "openai/gpt-4o") or an ad-hoc provider from a Model
 * provider card: a JSON string with no key inside, only a reference to one
 * saved on the server.
 */

export interface AdhocModelRef {
	kind: 'adhoc'
	baseURL: string
	model: string
	/** `secret:<id>` or `env:NAME`; never a raw key. */
	keyRef?: string
}

export interface ParsedModelValue {
	/** A configured model key, e.g. "openai/gpt-4o". */
	key?: string
	/** An ad-hoc OpenAI-compatible provider, picked straight from a URL. */
	adhoc?: AdhocModelRef
}

/** Build the value a Model provider card outputs. */
export function buildAdhocModelValue(ref: AdhocModelRef): string {
	return JSON.stringify(ref)
}

/** Parse a model field: a plain key, or the JSON an ad-hoc Model provider card outputs. */
export function parseModelValue(value: string | undefined | null): ParsedModelValue {
	const text = (value ?? '').trim()
	if (!text) return {}
	if (text.startsWith('{')) {
		try {
			const obj = JSON.parse(text) as Partial<AdhocModelRef>
			if (obj && obj.kind === 'adhoc' && typeof obj.baseURL === 'string' && typeof obj.model === 'string') {
				return { adhoc: { kind: 'adhoc', baseURL: obj.baseURL, model: obj.model, keyRef: obj.keyRef } }
			}
		} catch {
			// Not valid JSON: fall through and treat the whole thing as a plain key.
		}
	}
	return { key: text }
}
