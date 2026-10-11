import { describe, expect, it } from 'vitest'
import { NODE_SPECS } from '../shared/nodeSpecs'
import { wirableFields } from '../shared/fieldOverrides'
import { TABLE_OPS } from '../shared/tableOps'

/**
 * WP17 rollout manifest: every wirable field's own row, per node type's `*.tsx` component.
 * This is a static record of "I wired this one, in this file" — kept in sync by hand. The
 * test below is the thing that catches drift: it fails the moment `NODE_SPECS` grows a new
 * wirable field that isn't listed here (or here but not really wired, since that's a human
 * bug this file can't see — the dev-only console.warn in `getNodeTypePorts` is the backstop
 * for that: it fires in the browser whenever an expanded card's field port has no measured
 * anchor, which is a pure-Node test can't check without a DOM).
 */
const WIRED_FIELD_COVERAGE: Record<string, string[]> = {
	prompt: ['text'],
	prompt_concat: ['separator'],
	text_tool: ['op', 'a', 'b'],
	http: ['method', 'query', 'headers', 'auth', 'extractText'],
	download: ['fileName'],
	net_tool: ['tool', 'option'],
	postgres: ['mode', 'sql', 'csv', 'sourceUrl'],
	text_ai: ['operation', 'option', 'instruction', 'promptOverride'],
	generate_text: ['promptText'],
	chat: ['userMessage'],
	model_source: ['baseURL', 'model', 'filter', 'kind'],
	summarize: ['length', 'format', 'language', 'focus', 'model', 'system'],
	jev: ['kind', 'options', 'filter'],
	load_image: ['imageUrl', 'source'],
	crop: ['aspect', 'x', 'y', 'w', 'h'],
	image_resize: ['mode', 'value', 'value2'],
	image_filter: [
		'preset', 'brightness', 'contrast', 'saturate', 'hue', 'grayscale', 'sepia', 'invert', 'blur', 'rotate', 'flipX', 'flipY',
	],
	image_tool: ['tool', 'a', 'b'],
	adjust: ['brightness', 'contrast', 'saturation'],
	image_gen: ['n', 'size', 'negative', 'seed'],
	number: ['value'],
	random: ['mode'],
	if: ['condition', 'operand'],
	logic: ['op'],
	for_each: ['split', 'separator', 'joiner'],
	router: ['outputCount'],
	code: ['lang', 'code', 'inputCount', 'outputCount'],
	output: ['kind'],
	save: ['fileName'],
	// table: op params only (DataPipe's own design — see RULES/WP17: "only the op's params
	// are shown and get ports"). "text"/"format"/"op" are never wired: see the note below.
	table: [...new Set(TABLE_OPS.flatMap((spec) => spec.params.map((p) => p.field)))],
	chart: [
		'text', 'kind', 'xCol', 'yCol', 'dualScale', 'series', 'aggregate', 'stack', 'sort', 'top', 'otherRow',
		'bins', 'title', 'xLabel', 'yLabel', 'labels', 'smooth',
	],
	profile: ['text', 'format'],
	openrouter: ['model'],
	raw_model: ['url', 'system', 'temperature', 'thinking', 'maxTokens'],
	video: ['autoplay'],
	file_in: ['source', 'action', 'asText'],
	url_in: ['url', 'fetchBody'],
	sleep: ['ms'],
}

/** Fields deliberately left unwired, each with a reason (kept with the `wire: false` flag
 * and a comment in shared/nodeSpecs.ts): */
const DELIBERATELY_EXCLUDED: Record<string, string[]> = {
	// Stored as string[], not the comma string this spec describes; wiring text in would
	// violate the T.arrayOf(T.string) schema.
	code: ['inputNames', 'outputNames'],
	// Only read for display (the heading rename control edits it directly); execute()/
	// getOutputInfo() never read it, so a wired override would have no visible effect.
	subgraph: ['title'],
	// DataPipe: dynamic per-op fields only (see RULES.md / WP17); text/format/op aren't any
	// op's own param, so they're never wirable regardless of which op is selected.
	table: ['text', 'format', 'op'],
}

describe('WP17 field-port rollout coverage', () => {
	it('every wirable field (per spec) is either wired in its component, or a documented exception', () => {
		for (const [type, spec] of Object.entries(NODE_SPECS)) {
			const wirable = new Set(wirableFields(spec).map((f) => f.key))
			const covered = new Set(WIRED_FIELD_COVERAGE[type] ?? [])
			const excluded = new Set(DELIBERATELY_EXCLUDED[type] ?? [])
			const missing = [...wirable].filter((key) => !covered.has(key) && !excluded.has(key))
			expect(missing, `${type}: ${missing.join(', ')}`).toEqual([])
		}
	})

	it("the coverage manifest doesn't claim a field the spec doesn't list as wirable", () => {
		for (const [type, keys] of Object.entries(WIRED_FIELD_COVERAGE)) {
			const wirable = new Set(wirableFields(NODE_SPECS[type]).map((f) => f.key))
			// table's manifest is every op's params, a superset of any one op's wirable set —
			// checked against TABLE_OPS directly below instead.
			if (type === 'table') continue
			const extra = keys.filter((key) => !wirable.has(key))
			expect(extra, `${type}: ${extra.join(', ')}`).toEqual([])
		}
	})

	it("table's manifest covers exactly the field keys used by some op's own params", () => {
		const allParamFields = new Set(TABLE_OPS.flatMap((spec) => spec.params.map((p) => p.field)))
		expect(new Set(WIRED_FIELD_COVERAGE.table)).toEqual(allParamFields)
	})
})
