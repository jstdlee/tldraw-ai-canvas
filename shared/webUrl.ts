/**
 * Recognize a web address in node input even when the scheme is missing.
 * "www.wikipedia.com" and "en.wikipedia.org/wiki/Cat" are pages; "Hello world"
 * and "notes" are not (they contain spaces, or no dot).
 */

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const BARE_HOST =
	/^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?::\d{1,5})?(?:[/?#][^\s]*)?$/i

/** The page address of a value, with a scheme added when it is missing. Null when it is not a page. */
export function asWebUrl(value: string): string | null {
	const text = value.trim()
	if (!text || /\s/.test(text)) return null
	if (SCHEME.test(text)) {
		if (!/^https?:\/\//i.test(text)) return null
		try {
			const url = new URL(text)
			return url.hostname === 'localhost' || url.hostname.includes('.') ? url.toString() : null
		} catch {
			return null
		}
	}
	if (!BARE_HOST.test(text)) return null
	try {
		return new URL(`https://${text}`).toString()
	} catch {
		return null
	}
}

/** True when the whole value is one web address. */
export function isWebUrl(value: string): boolean {
	return asWebUrl(value) !== null
}
