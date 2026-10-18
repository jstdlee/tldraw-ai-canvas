/**
 * WP33 item E: the Agent card's `answerFormat` field (text / table (CSV) / JSON). Pure, no
 * network, no tldraw import — the card (client/pipeline/nodes/types/AgentNode.tsx) drives an
 * agent run with this, catching an invalid answer and re-asking once.
 */
import { parseTableText, toCsv } from './tableText'

export const AGENT_ANSWER_FORMATS = ['text', 'table', 'json'] as const
export type AgentAnswerFormat = (typeof AGENT_ANSWER_FORMATS)[number]

export const AGENT_ANSWER_FORMAT_LABELS: Record<AgentAnswerFormat, string> = {
	text: 'Text',
	table: 'Table (CSV)',
	json: 'JSON',
}

/** An old canvas (or a blank field) has no `answerFormat` saved: that means plain text, same as
 * before this field existed. */
export function normalizeAnswerFormat(value: string | undefined | null): AgentAnswerFormat {
	return value === 'table' || value === 'json' ? value : 'text'
}

/** Appended to the task so the model knows what shape to answer in. `text` needs nothing extra —
 * the model already free-answers in prose. */
export function answerFormatInstruction(format: AgentAnswerFormat): string | undefined {
	switch (format) {
		case 'table':
			return 'Answer with only a CSV table (a header row, then the data rows). No prose, no code fences, nothing before or after it.'
		case 'json':
			return 'Answer with only valid JSON (an object or an array). No prose, no code fences, nothing before or after it.'
		default:
			return undefined
	}
}

export interface AgentAnswerCheck {
	ok: boolean
	/** `text`: the answer, unchanged. `table`: re-written as clean RFC 4180 CSV. `json`: re-serialized. */
	clean: string
	/** Set when `ok` is false: why the answer didn't parse as the requested format. */
	error?: string
}

/** A fenced code block (```csv ... ``` / ```json ... ```, or a bare ```) around the real
 * answer — models asked for "only CSV/JSON" still sometimes wrap it one anyway. */
function stripCodeFence(text: string): string {
	const match = /^```[a-z]*\n?([\s\S]*?)\n?```$/i.exec(text.trim())
	return match ? match[1].trim() : text.trim()
}

/** Validate (and normalize) one answer against the requested format. Never throws. */
export function checkAgentAnswer(answer: string, format: AgentAnswerFormat): AgentAnswerCheck {
	const text = stripCodeFence(answer ?? '')
	if (format === 'text') return { ok: true, clean: answer }
	if (format === 'table') {
		try {
			const table = parseTableText(text)
			return { ok: true, clean: toCsv(table.headers, table.rows) }
		} catch (e) {
			return { ok: false, clean: answer, error: (e as Error).message }
		}
	}
	// json
	try {
		const parsed = JSON.parse(text)
		return { ok: true, clean: JSON.stringify(parsed, null, 2) }
	} catch (e) {
		return { ok: false, clean: answer, error: (e as Error).message }
	}
}

/** The follow-up task sent for the one re-ask, once, when the first answer didn't match the
 * requested format. */
export function buildReaskTask(originalTask: string, format: AgentAnswerFormat, previousAnswer: string, error: string): string {
	const label = AGENT_ANSWER_FORMAT_LABELS[format]
	return (
		`${originalTask}\n\n` +
		`Your previous answer was not valid ${label}: ${error}\n` +
		`Previous answer:\n${previousAnswer}\n\n` +
		`${answerFormatInstruction(format)}`
	)
}
