/**
 * Coerce a wired value (from another card's output) to the kind a field expects, for WP17
 * (every card parameter can be wired). Pure — no tldraw import, testable in Node.
 */

import type { FieldKind } from './nodeSpecs'

/** Thrown when a wired value can't be coerced to the field's kind; the node's `execute` lets
 * this propagate so the run banner shows it (per RULES.md: throw, don't swallow). */
export class FieldCoerceError extends Error {}

const TRUE_WORDS = new Set(['true', '1', 'yes'])
const FALSE_WORDS = new Set(['false', '0', 'no', ''])

/** Coerce a raw wired value to the given field kind. `value` is whatever a port carries:
 * a string, a number, or null. Throws `FieldCoerceError` with a short human message on failure. */
export function coerceFieldValue(
	kind: FieldKind,
	value: unknown,
	label: string,
	options?: string[]
): string | number | boolean {
	if (kind === 'number') {
		if (typeof value === 'number') {
			if (Number.isNaN(value)) throw new FieldCoerceError(`"${label}" needs a number`)
			return value
		}
		const text = String(value ?? '').trim()
		const n = Number(text)
		if (text === '' || Number.isNaN(n)) {
			throw new FieldCoerceError(`"${label}" needs a number, got "${value}"`)
		}
		return n
	}

	if (kind === 'boolean') {
		if (typeof value === 'boolean') return value
		const text = String(value ?? '').trim().toLowerCase()
		if (TRUE_WORDS.has(text)) return true
		if (FALSE_WORDS.has(text)) return false
		throw new FieldCoerceError(`"${label}" needs true/false, got "${value}"`)
	}

	if (kind === 'enum') {
		const text = String(value ?? '')
		if (options && options.length) {
			const match = options.find((option) => option.toLowerCase() === text.toLowerCase())
			if (!match) {
				throw new FieldCoerceError(`"${label}" must be one of ${options.join(', ')}, got "${text}"`)
			}
			return match
		}
		return text
	}

	if (kind === 'json') {
		const text = String(value ?? '')
		try {
			JSON.parse(text)
		} catch {
			throw new FieldCoerceError(`"${label}" must be valid JSON`)
		}
		return text
	}

	// text / longtext / code / sql / model / url: any wired value becomes its string form.
	if (value == null) return ''
	return typeof value === 'string' ? value : String(value)
}
