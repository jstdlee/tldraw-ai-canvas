/**
 * WP36 "P" (Gallery): parse a card's `images` input into an ordered list of image URLs. Three
 * auto-detected shapes, same spirit as `shared/tableText.ts`'s "never guessed by a per-card
 * setting": a JSON array (of URL strings, or of objects with a `url`/`image`/`src` field — e.g.
 * Generate image's `images` port, or a table-shaped list after `JSON.stringify`), a table with a
 * `url`/`image`/`src` column (only when the first line genuinely looks like a header naming one
 * of those — a plain URL-per-line list is never mistaken for a one-column table), or one URL per
 * line. Pure, no tldraw import, testable in Node.
 */
import { parseTableText } from './tableText'

const URL_COLUMN = /^(url|image|src)$/i

function imageFromJsonItem(item: unknown): string | null {
	if (typeof item === 'string') {
		const s = item.trim()
		return s || null
	}
	if (item && typeof item === 'object') {
		const obj = item as Record<string, unknown>
		const v = obj.url ?? obj.image ?? obj.src
		return typeof v === 'string' && v.trim() ? v.trim() : null
	}
	return null
}

export function parseImageList(value: string | null | undefined): string[] {
	const text = (value ?? '').trim()
	if (!text) return []

	if (text.startsWith('[')) {
		try {
			const parsed = JSON.parse(text)
			if (Array.isArray(parsed)) {
				return parsed.map(imageFromJsonItem).filter((s): s is string => !!s)
			}
		} catch {
			// Not JSON after all — fall through.
		}
	}

	// A real table (a header row naming url/image/src, with an actual delimiter) — not just any
	// line that happens to contain one of those words.
	const firstLine = text.split('\n', 1)[0]
	if (/[,;\t]/.test(firstLine) && firstLine.split(/[,;\t]/).some((cell) => URL_COLUMN.test(cell.trim()))) {
		try {
			const table = parseTableText(text)
			const col = table.headers.findIndex((h) => URL_COLUMN.test(h.trim()))
			if (col >= 0) {
				return table.rows.map((row) => (row[col] ?? '').trim()).filter(Boolean)
			}
		} catch {
			// Not actually a table — fall through to the plain line list below.
		}
	}

	return text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
}
