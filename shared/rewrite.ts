/**
 * "Rewrite branches" (idea from VibeText): split a text into paragraph cards,
 * rewrite one card into side-by-side variants, compare, keep the best one.
 * Pure helpers only; the canvas side lives in client/clips/rewrite.ts.
 */

export interface RewritePreset {
	id: string
	label: string
	prompt: string
}

export const REWRITE_PRESETS: RewritePreset[] = [
	{ id: 'clear', label: 'Clearer', prompt: 'Make it more clear, concise and easy to understand.' },
	{ id: 'fix', label: 'Fix grammar', prompt: 'Correct spelling, grammar and punctuation errors.' },
	{ id: 'shorter', label: 'Shorter', prompt: 'Make it about half as long. Keep the key facts.' },
	{ id: 'expand', label: 'Expand', prompt: 'Expand the idea with more detail and an example.' },
	{ id: 'professional', label: 'Professional', prompt: 'Use a professional, clear tone.' },
	{ id: 'casual', label: 'Casual', prompt: 'Use a casual, friendly tone.' },
	{ id: 'simple', label: 'Simple English', prompt: 'Use short sentences and common words, like ASD-STE100 Simplified Technical English.' },
	{ id: 'en', label: '→ English', prompt: 'Translate it into English.' },
	{ id: 'zh', label: '→ 中文', prompt: 'Translate it into simplified Chinese.' },
]

/** The instruction sent with the paragraph as input. */
export function buildRewritePrompt(instructions: string): string {
	return [
		'Revise the input text by following these instructions:',
		instructions.trim(),
		'Keep the language and the Markdown formatting unless the instructions say otherwise.',
		'Return only the revised text, without commentary or preamble.',
	].join('\n\n')
}

/** Selected presets plus the free note, one instruction per line. */
export function joinInstructions(presets: RewritePreset[], presetIds: string[], note: string): string {
	return [...presets.filter((p) => presetIds.includes(p.id)).map((p) => p.prompt), note.trim()]
		.filter(Boolean)
		.join('\n')
}

/** Short name of the action for the arrow label, e.g. "Shorter + → English" or the note itself. */
export function rewriteLabel(presets: RewritePreset[], presetIds: string[], note: string): string {
	const names = presets.filter((p) => presetIds.includes(p.id)).map((p) => p.label)
	const n = note.replace(/\s+/g, ' ').trim()
	if (n) names.push(names.length ? `“${n.length > 16 ? n.slice(0, 15) + '…' : n}”` : n)
	return names.join(' + ') || 'Rewrite'
}

/** Keep only well-formed presets (label and prompt set, unique ids); fall back to the defaults when none are left. */
export function cleanPresets(value: unknown): RewritePreset[] {
	if (!Array.isArray(value)) return REWRITE_PRESETS
	const seen = new Set<string>()
	const out = value.filter((p): p is RewritePreset => {
		const ok = p && typeof p.id === 'string' && typeof p.label === 'string' && typeof p.prompt === 'string' && p.label.trim() && p.prompt.trim() && !seen.has(p.id)
		if (ok) seen.add(p.id)
		return !!ok
	})
	return out.length ? out : REWRITE_PRESETS
}

/**
 * Split text into paragraphs at blank lines. A fenced code block (``` or ~~~)
 * stays in one piece even when it has blank lines inside.
 */
export function splitParagraphs(text: string): string[] {
	const out: string[] = []
	let buf: string[] = []
	let fence = ''
	const flush = () => {
		const block = buf.join('\n').trim()
		if (block) out.push(block)
		buf = []
	}
	for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
		const t = line.trim()
		if (fence) {
			buf.push(line)
			if (t.startsWith(fence)) fence = ''
			continue
		}
		const open = /^(```|~~~)/.exec(t)
		if (open) {
			fence = t.length > 3 && t.endsWith(open[1]) && t !== open[1] ? '' : open[1]
			buf.push(line)
			continue
		}
		if (!t) flush()
		else buf.push(line)
	}
	flush()
	return out
}
