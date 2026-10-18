/**
 * WP35 Part F: pure logic for the "Template" card. One input port per `{{name}}` — reusing
 * Generate text's own `{{vars}}` convention (`shared/templateVars.ts`'s `findVars`, and
 * `client/pipeline/nodes/types/llmSettings.tsx`'s `llmVarPorts`/`LlmVarRows` for the ports
 * themselves) — plus `{{name|table}}`, which renders a table value as a table instead of raw
 * CSV text. No tldraw import; tested in Node.
 */
import { parseTableText } from './tableText'
import { findVars } from './templateVars'

export type TemplateEscape = 'none' | 'json' | 'html' | 'url' | 'csv'

const TABLE_VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\|\s*table\s*\}\}/g
const PLAIN_VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/**
 * Every variable `template` references, whether as plain `{{name}}` (found the same way
 * Generate text finds its own — `findVars`, which this reuses directly) or as `{{name|table}}`
 * (a syntax `findVars`'s own regex doesn't recognize, since it requires `}}` right after the
 * name). Each distinct name becomes one `var:<name>` input port, same convention either way.
 */
export function findTemplateVars(template: string): string[] {
	const names = findVars([template])
	const seen = new Set(names)
	for (const m of template.matchAll(TABLE_VAR_RE)) {
		if (!seen.has(m[1])) {
			seen.add(m[1])
			names.push(m[1])
		}
	}
	return names
}

/** A data URL, an uploaded image, or an http(s) image URL — the same test `fields.tsx`'s own
 * `isImageValue` uses for a wired-value preview. */
export function isImageValue(value: string): boolean {
	return (
		/^data:image\//i.test(value) ||
		/^\/api\/images\//.test(value) ||
		/^https?:\/\/\S+\.(png|jpe?g|webp|gif|svg)(\?\S*)?$/i.test(value)
	)
}

function escapeHtmlAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeHtmlText(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** An image value in HTML mode becomes a real `<img>` tag (so a Template building an HTML
 * report shows the picture, not a wall of base64); every other escape mode leaves it as the
 * plain URL/data-URL text, which is already what a downstream card expects. */
function imageToken(value: string, escape: TemplateEscape): string {
	return escape === 'html' ? `<img src="${escapeHtmlAttr(value)}">` : value
}

function escapeValue(value: string, escape: TemplateEscape): string {
	switch (escape) {
		case 'json':
			// Escaped as a JSON string's *body* (no surrounding quotes) — the template itself
			// supplies those, e.g. `{"text": "{{input}}"}` (GAPS-18).
			return JSON.stringify(value).slice(1, -1)
		case 'html':
			return escapeHtmlText(value)
		case 'url':
			return encodeURIComponent(value)
		case 'csv':
			return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
		default:
			return value
	}
}

/** `{{name|table}}`: the var's value as an HTML table (`escape: 'html'`) or a Markdown table
 * (every other mode — readable in plain text too). Falls back to the raw value, unescaped, if
 * it doesn't actually parse as a table (`parseTableText` already accepts CSV/TSV/JSON/Markdown). */
function renderTable(value: string, escape: TemplateEscape): string {
	let table: ReturnType<typeof parseTableText>
	try {
		table = parseTableText(value)
	} catch {
		return value
	}
	if (escape === 'html') {
		const th = table.headers.map((h) => `<th>${escapeHtmlText(h)}</th>`).join('')
		const rows = table.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtmlText(c)}</td>`).join('')}</tr>`).join('')
		return `<table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`
	}
	const esc = (v: string) => v.replace(/\|/g, '\\|').trim()
	return [
		`| ${table.headers.map(esc).join(' | ')} |`,
		`| ${table.headers.map(() => '---').join(' | ')} |`,
		...table.rows.map((r) => `| ${table.headers.map((_, i) => esc(r[i] ?? '')).join(' | ')} |`),
	].join('\n')
}

export interface FillTemplateOptions {
	escape: TemplateEscape
	/** name -> raw (unescaped) value, straight from the wired `var:<name>` inputs. */
	values: Record<string, string>
}

/**
 * Fills every `{{name}}`/`{{name|table}}` in `template`. `{{name|table}}` is resolved first
 * (its own rendering, never escaped — a table/image already has its own safe structure); every
 * plain `{{name}}` is then resolved with `escape` applied, and an image-looking value becomes
 * an `<img>` tag in HTML mode. A name with no value becomes ''.
 */
export function fillTemplate(template: string, options: FillTemplateOptions): string {
	const { escape, values } = options
	let filled = template.replace(TABLE_VAR_RE, (_whole, name: string) => renderTable(values[name] ?? '', escape))
	filled = filled.replace(PLAIN_VAR_RE, (_whole, name: string) => {
		const raw = values[name] ?? ''
		return isImageValue(raw) ? imageToken(raw, escape) : escapeValue(raw, escape)
	})
	return filled
}
