/**
 * Pure routing logic for the Decision switch card (WP22 A). No tldraw import — testable in
 * Node. The card reads a JEV decision (its `probs` JSON output, or its `final`/`output` plain
 * text) and routes a value to one of several outputs based on the decision's shape:
 *  - yes/no: route by P(yes) vs a threshold, with an optional "unsure" band.
 *  - choice: route to one output per configured option, or "other" when unmatched.
 *  - score: route to one output per configured band, by a 0..1 score.
 */

export type DecisionSwitchMode = 'auto' | 'noul' | 'choice' | 'score'
export type ResolvedDecisionMode = 'noul' | 'choice' | 'score'

export interface ParsedDecision {
	/** Probabilities per label, when the decision input was JSON (JEV's `probs` output). */
	probabilities: Record<string, number> | null
	/** The decision's own best answer, whichever form the input took. */
	answer: string | null
	/**
	 * The decision's own declared kind, when the source tagged it — e.g. JEV's `probs` output
	 * carries a reserved `__kind` key alongside its probabilities. A flat `{label: probability}`
	 * object is otherwise structurally indistinguishable between a choice and a score decision
	 * (GAPS-04/AI-04), so `detectMode` prefers this tag over its shape-guessing heuristic when
	 * it's present. Absent (not just `undefined`) whenever the source didn't tag it, so a plain
	 * `ParsedDecision` without this field still deep-equals older callers' expectations.
	 */
	kind?: ResolvedDecisionMode
}

const DECISION_KINDS = new Set(['noul', 'choice', 'score'])

function kindTag(value: unknown): ResolvedDecisionMode | undefined {
	return typeof value === 'string' && DECISION_KINDS.has(value) ? (value as ResolvedDecisionMode) : undefined
}

/** Parse the wired "decision" value: a JSON object of probabilities (optionally tagged with a
 * `__kind`), a JSON object with a string `value`/`answer`/`choice` (e.g. an HTML form's `json`
 * output routed straight in — GAPS-05), or plain text. */
export function parseDecision(raw: string | null | undefined): ParsedDecision {
	const text = (raw ?? '').trim()
	if (!text) return { probabilities: null, answer: null }
	if (text.startsWith('{')) {
		try {
			const obj: unknown = JSON.parse(text)
			if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
				const record = obj as Record<string, unknown>
				const entries = Object.entries(record).filter(
					(entry): entry is [string, number] => typeof entry[1] === 'number'
				)
				if (entries.length) {
					const probabilities = Object.fromEntries(entries)
					const answer = entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0]
					const kind = kindTag(record.__kind)
					return kind ? { probabilities, answer, kind } : { probabilities, answer }
				}
				// No numeric entries: a plain decision object (e.g. an HTML form's `json`, or
				// something built by hand) — use its own string `value`/`answer`/`choice`.
				const stringAnswer = [record.value, record.answer, record.choice].find(
					(v): v is string => typeof v === 'string' && v.trim() !== ''
				)
				if (stringAnswer !== undefined) return { probabilities: null, answer: stringAnswer.trim() }
			}
		} catch {
			// Not JSON after all: fall through and treat the whole thing as plain text.
		}
	}
	return { probabilities: null, answer: text }
}

const YES_NO_KEYS = new Set(['yes', 'no'])

/** Guess the mode from the decision's own shape: a tagged `kind` wins outright; otherwise
 * exactly {yes, no} keys means yes/no. */
export function detectMode(parsed: ParsedDecision): ResolvedDecisionMode {
	if (parsed.kind) return parsed.kind
	if (parsed.probabilities) {
		const keys = Object.keys(parsed.probabilities).map((k) => k.toLowerCase())
		if (keys.length === 2 && keys.every((k) => YES_NO_KEYS.has(k))) return 'noul'
	}
	if (parsed.answer && YES_NO_KEYS.has(parsed.answer.trim().toLowerCase())) return 'noul'
	return 'choice'
}

export function resolveMode(mode: DecisionSwitchMode, parsed: ParsedDecision): ResolvedDecisionMode {
	return mode === 'auto' ? detectMode(parsed) : mode
}

/** A label turned into a stable port-id slug: lower-case, non-alphanumerics to `_`. */
export function slugOption(label: string): string {
	const s = label
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
	return s || 'opt'
}

/** Parse the switch's own "options" field: one per line, "label: description" keeps the label. */
export function parseSwitchOptions(text: string | null | undefined): string[] {
	return (text ?? '')
		.split('\n')
		.map((line) => line.split(':')[0].trim())
		.filter(Boolean)
}

export interface ScoreBand {
	name: string
	/** Upper bound (score < upper routes here); null for the last, open-ended band. */
	upper: number | null
}

/**
 * Parse the bands field: one row per line, "name: upper bound" (the last row may omit the
 * bound, meaning "everything else"). Matches the simple name + upper-bound row editor.
 */
export function parseBands(text: string | null | undefined): ScoreBand[] {
	const rows = (text ?? '')
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
	return rows.map((row) => {
		const m = /^(.+?)\s*[:,]\s*([\d.]+)\s*$/.exec(row)
		if (m) return { name: m[1].trim(), upper: Number(m[2]) }
		return { name: row.replace(/[:,]\s*$/, '').trim(), upper: null }
	})
}

export const DEFAULT_BANDS_TEXT = 'low: 0.33\nmid: 0.66\nhigh'

/** The band a 0..1 score falls into: the first band whose upper bound is greater than it,
 * or the last (open-ended) band otherwise. */
export function bandForScore(score: number, bands: ScoreBand[]): string | null {
	if (!bands.length) return null
	for (const band of bands) {
		if (band.upper == null || score < band.upper) return band.name
	}
	return bands[bands.length - 1].name
}

/** A 0..1 score from the parsed decision: a weighted position over ordered probabilities
 * (worst to best, matching JEV's own level order), or a parsed plain number otherwise. */
export function scoreFromDecision(parsed: ParsedDecision): number | null {
	if (parsed.probabilities) {
		const entries = Object.entries(parsed.probabilities)
		if (!entries.length) return null
		if (entries.length === 1) return clamp01(entries[0][1])
		const score = entries.reduce((sum, [, p], i) => sum + p * (i / (entries.length - 1)), 0)
		return clamp01(score)
	}
	if (parsed.answer != null) {
		const n = Number(parsed.answer.trim())
		if (Number.isFinite(n)) return clamp01(n > 1 ? n / 100 : n)
	}
	return null
}

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n))
}

export interface PortLabel {
	id: string
	label: string
}

/** The choice mode's output ports: one per configured option (or the last decision's options
 * when none are configured), plus a final catch-all "other". */
export function choiceOutputs(optionsText: string | null | undefined, lastOptions?: string[] | null): PortLabel[] {
	const explicit = parseSwitchOptions(optionsText)
	return buildChoicePorts(explicit.length ? explicit : (lastOptions ?? []))
}

/** The score mode's output ports: one per configured band. */
export function scoreOutputs(bandsText: string | null | undefined): PortLabel[] {
	const bands = parseBands(bandsText)
	return bands.map((b) => ({ id: `band:${slugOption(b.name)}`, label: b.name }))
}

/**
 * The option labels to route against for one run of the choice mode: the user's own typed
 * options when there are any, otherwise the categories the decision itself just produced (its
 * `probabilities` keys), falling back to the decision's plain-text answer, or (when a run has
 * no decision at all, e.g. the very first time) the last run's labels. Live, per-run — unlike
 * `choiceOutputs`, which is for display between runs (getPorts/the card body), this always
 * prefers what the *current* decision says over stale `lastOptions`, so an empty "Options"
 * field picks up the real categories (e.g. "billing/support/sales") from the first run instead
 * of staying stuck on nothing.
 */
export function choiceLabelsForRoute(
	optionsText: string | null | undefined,
	parsed: ParsedDecision,
	lastOptions?: string[] | null
): string[] {
	const explicit = parseSwitchOptions(optionsText)
	if (explicit.length) return explicit
	if (parsed.probabilities) return Object.keys(parsed.probabilities)
	if (parsed.answer) {
		const base = lastOptions ?? []
		if (base.some((label) => slugOption(label) === slugOption(parsed.answer!))) return base
		return [...base, parsed.answer]
	}
	return lastOptions ?? []
}

function buildChoicePorts(labels: string[]): PortLabel[] {
	const seen = new Set<string>()
	const ports: PortLabel[] = []
	for (const label of labels) {
		const id = `opt:${slugOption(label)}`
		if (seen.has(id)) continue
		seen.add(id)
		ports.push({ id, label })
	}
	ports.push({ id: 'other', label: 'Other' })
	return ports
}

export interface DecisionRouteInput {
	mode: DecisionSwitchMode
	decisionRaw: string | null | undefined
	/** The value to route; defaults to the decision text itself when not wired. */
	value: string | null | undefined
	threshold: number
	margin: number
	optionsText: string | null | undefined
	bandsText: string | null | undefined
	lastOptions?: string[] | null
}

export interface DecisionRouteResult {
	resolvedMode: ResolvedDecisionMode
	parsed: ParsedDecision
	/** The output port id that got the value, or null when nothing could be decided. */
	chosenPortId: string | null
	/** Every output this mode defines, keyed by port id; null means STOP_EXECUTION. */
	outputs: Record<string, string | null>
	/** The value that was (or would be) routed — the wired "value" input, or the decision's
	 * own answer text when "value" isn't wired. Never null as long as there's a decision at
	 * all; shown by `getOutputInfo` and used as the output for whichever port was chosen. */
	value: string
	unsure: boolean
	/** The option labels actually used to route (for persisting as `lastOptions`). */
	options: string[]
}

/** Route `input.value` (or the decision text) to exactly one output, by the resolved mode. */
export function routeDecision(input: DecisionRouteInput): DecisionRouteResult {
	const parsed = parseDecision(input.decisionRaw)
	const resolvedMode = resolveMode(input.mode, parsed)
	const value = input.value != null && input.value !== '' ? input.value : parsed.answer ?? input.decisionRaw ?? ''

	if (resolvedMode === 'noul') {
		const pYesRaw =
			(parsed.probabilities &&
				(parsed.probabilities.yes ?? parsed.probabilities.Yes ?? parsed.probabilities.YES)) ??
			(parsed.answer?.trim().toLowerCase() === 'yes'
				? 1
				: parsed.answer?.trim().toLowerCase() === 'no'
					? 0
					: null)
		const outputs: Record<string, string | null> = { yes: null, no: null, unsure: null }
		if (pYesRaw == null) {
			return { resolvedMode, parsed, chosenPortId: null, outputs, value, unsure: false, options: [] }
		}
		const diff = Math.abs(pYesRaw - input.threshold)
		const unsure = input.margin > 0 && diff < input.margin
		const chosen = unsure ? 'unsure' : pYesRaw >= input.threshold ? 'yes' : 'no'
		outputs[chosen] = value
		return { resolvedMode, parsed, chosenPortId: chosen, outputs, value, unsure, options: [] }
	}

	if (resolvedMode === 'choice') {
		// WP22 follow-up: when the user hasn't typed options, derive them live from this
		// decision (its probabilities' keys, or its plain-text answer) rather than from stale
		// `lastOptions` — otherwise a fresh switch (empty options, no prior run) can never
		// match anything and everything falls through to "other".
		const labels = choiceLabelsForRoute(input.optionsText, parsed, input.lastOptions)
		const ports = buildChoicePorts(labels)
		const options = ports.filter((p) => p.id !== 'other').map((p) => p.label)
		const outputs: Record<string, string | null> = {}
		for (const p of ports) outputs[p.id] = null

		let chosenId: string | null = null
		if (parsed.probabilities) {
			let best: { id: string; p: number } | null = null
			for (const [label, p] of Object.entries(parsed.probabilities)) {
				const match = ports.find((port) => port.id === `opt:${slugOption(label)}`)
				if (match && (!best || p > best.p)) best = { id: match.id, p }
			}
			chosenId = best?.id ?? null
		}
		if (!chosenId && parsed.answer) {
			const match = ports.find((port) => port.id === `opt:${slugOption(parsed.answer!)}`)
			chosenId = match?.id ?? null
		}
		if (!chosenId) chosenId = 'other'
		outputs[chosenId] = value
		return { resolvedMode, parsed, chosenPortId: chosenId, outputs, value, unsure: false, options }
	}

	// score
	const bands = parseBands(input.bandsText)
	const ports = scoreOutputs(input.bandsText)
	const outputs: Record<string, string | null> = {}
	for (const p of ports) outputs[p.id] = null
	const score = scoreFromDecision(parsed)
	const bandName = score == null ? null : bandForScore(score, bands)
	const chosenId = bandName ? `band:${slugOption(bandName)}` : null
	if (chosenId && chosenId in outputs) outputs[chosenId] = value
	return { resolvedMode, parsed, chosenPortId: chosenId, outputs, value, unsure: false, options: [] }
}
