import { describe, expect, it } from 'vitest'
import {
	bandForScore,
	choiceLabelsForRoute,
	choiceOutputs,
	detectMode,
	parseBands,
	parseDecision,
	parseSwitchOptions,
	resolveMode,
	routeDecision,
	scoreFromDecision,
	scoreOutputs,
	slugOption,
} from '../shared/decisionRoute'

describe('parseDecision', () => {
	it('parses a JEV probs JSON object and picks the top answer', () => {
		const parsed = parseDecision('{"yes":0.8,"no":0.2}')
		expect(parsed.probabilities).toEqual({ yes: 0.8, no: 0.2 })
		expect(parsed.answer).toBe('yes')
	})

	it('treats plain text (JEV final/output) as the answer with no probabilities', () => {
		const parsed = parseDecision('approve')
		expect(parsed.probabilities).toBeNull()
		expect(parsed.answer).toBe('approve')
	})

	it('empty input parses to nothing', () => {
		expect(parseDecision(null)).toEqual({ probabilities: null, answer: null })
		expect(parseDecision('')).toEqual({ probabilities: null, answer: null })
	})

	it('non-JSON text starting with { is still treated as plain text', () => {
		const parsed = parseDecision('{not valid json')
		expect(parsed.probabilities).toBeNull()
		expect(parsed.answer).toBe('{not valid json')
	})

	it('GAPS-05: a JSON object with a string value/answer/choice becomes the answer, not the raw JSON', () => {
		expect(parseDecision('{"value":"formal"}')).toEqual({ probabilities: null, answer: 'formal' })
		expect(parseDecision('{"answer":"yes"}')).toEqual({ probabilities: null, answer: 'yes' })
		expect(parseDecision('{"choice":"b"}')).toEqual({ probabilities: null, answer: 'b' })
		// `value` wins when more than one of value/answer/choice is present.
		expect(parseDecision('{"value":"a","answer":"b"}').answer).toBe('a')
	})

	it('a JSON object with none of probabilities/value/answer/choice falls through to plain answer', () => {
		expect(parseDecision('{"clicked":"Go"}').answer).toBe('{"clicked":"Go"}')
	})

	it('AI-04: an untagged probs object carries no kind; a tagged one does (filtered out of probabilities)', () => {
		expect(parseDecision('{"yes":0.3,"no":0.7}').kind).toBeUndefined()
		const tagged = parseDecision('{"low":0.2,"mid":0.3,"high":0.5,"__kind":"score"}')
		expect(tagged.kind).toBe('score')
		expect(tagged.probabilities).toEqual({ low: 0.2, mid: 0.3, high: 0.5 })
	})
})

describe('detectMode / resolveMode', () => {
	it('detects noul from exactly {yes, no} probability keys', () => {
		expect(detectMode(parseDecision('{"yes":0.3,"no":0.7}'))).toBe('noul')
	})

	it('detects noul from a plain yes/no answer', () => {
		expect(detectMode(parseDecision('no'))).toBe('noul')
	})

	it('falls back to choice for anything else', () => {
		expect(detectMode(parseDecision('{"approve":0.5,"reject":0.5}'))).toBe('choice')
		expect(detectMode(parseDecision('approve'))).toBe('choice')
	})

	it('resolveMode honors an explicit mode over auto-detection', () => {
		expect(resolveMode('score', parseDecision('yes'))).toBe('score')
		expect(resolveMode('auto', parseDecision('yes'))).toBe('noul')
	})

	it('AI-04: a tagged __kind resolves Auto to Score, even when the labels alone would read as choice', () => {
		const tagged = parseDecision('{"low":0.2,"mid":0.3,"high":0.5,"__kind":"score"}')
		expect(detectMode(tagged)).toBe('score')
		expect(resolveMode('auto', tagged)).toBe('score')
		// A tag wins even over the yes/no shape heuristic (a score decision whose two levels
		// happen to be named "yes"/"no" must stay Score, not fall into the yes/no gate).
		const yesNoScore = parseDecision('{"yes":0.3,"no":0.7,"__kind":"score"}')
		expect(detectMode(yesNoScore)).toBe('score')
	})
})

describe('slugOption / parseSwitchOptions', () => {
	it('slugifies labels to stable port-id-safe strings', () => {
		expect(slugOption('Approve!')).toBe('approve')
		expect(slugOption('  Needs More Info  ')).toBe('needs_more_info')
		expect(slugOption('')).toBe('opt')
	})

	it('parses one option per line, dropping a trailing description', () => {
		expect(parseSwitchOptions('approve: looks fine\nreject: nope\n\n')).toEqual(['approve', 'reject'])
	})
})

describe('bands', () => {
	it('parses "name: upper" rows, with an open-ended last row', () => {
		expect(parseBands('low: 0.33\nmid: 0.66\nhigh')).toEqual([
			{ name: 'low', upper: 0.33 },
			{ name: 'mid', upper: 0.66 },
			{ name: 'high', upper: null },
		])
	})

	it('bandForScore picks the first band whose upper bound exceeds the score', () => {
		const bands = parseBands('low: 0.33\nmid: 0.66\nhigh')
		expect(bandForScore(0.1, bands)).toBe('low')
		expect(bandForScore(0.5, bands)).toBe('mid')
		expect(bandForScore(0.9, bands)).toBe('high')
		expect(bandForScore(0.33, bands)).toBe('mid') // boundary: not < upper, falls to next
	})
})

describe('scoreFromDecision', () => {
	it('computes a weighted position from ordered probabilities', () => {
		// All weight on the last key -> score 1; all on the first -> score 0.
		expect(scoreFromDecision({ probabilities: { low: 0, mid: 0, high: 1 }, answer: 'high' })).toBeCloseTo(1)
		expect(scoreFromDecision({ probabilities: { low: 1, mid: 0, high: 0 }, answer: 'low' })).toBeCloseTo(0)
	})

	it('parses a plain numeric answer, scaling >1 as a percentage', () => {
		expect(scoreFromDecision({ probabilities: null, answer: '0.7' })).toBeCloseTo(0.7)
		expect(scoreFromDecision({ probabilities: null, answer: '70' })).toBeCloseTo(0.7)
	})

	it('returns null when nothing numeric is available', () => {
		expect(scoreFromDecision({ probabilities: null, answer: 'approve' })).toBeNull()
		expect(scoreFromDecision({ probabilities: null, answer: null })).toBeNull()
	})
})

describe('choiceOutputs / scoreOutputs', () => {
	it('builds one port per option plus a catch-all "other"', () => {
		expect(choiceOutputs('approve\nreject')).toEqual([
			{ id: 'opt:approve', label: 'approve' },
			{ id: 'opt:reject', label: 'reject' },
			{ id: 'other', label: 'Other' },
		])
	})

	it('falls back to lastOptions when the options field is empty', () => {
		expect(choiceOutputs('', ['approve', 'reject'])).toEqual([
			{ id: 'opt:approve', label: 'approve' },
			{ id: 'opt:reject', label: 'reject' },
			{ id: 'other', label: 'Other' },
		])
	})

	it('builds one port per band', () => {
		expect(scoreOutputs('low: 0.5\nhigh')).toEqual([
			{ id: 'band:low', label: 'low' },
			{ id: 'band:high', label: 'high' },
		])
	})
})

describe('routeDecision', () => {
	it('noul: routes yes above threshold, no below, only the chosen output is non-null', () => {
		const base = { mode: 'auto' as const, decisionRaw: '{"yes":0.8,"no":0.2}', value: null, threshold: 0.5, margin: 0, optionsText: '', bandsText: '' }
		const result = routeDecision(base)
		expect(result.resolvedMode).toBe('noul')
		expect(result.chosenPortId).toBe('yes')
		expect(result.outputs).toEqual({ yes: 'yes', no: null, unsure: null })
	})

	it('noul: uses the decision text as the routed value when "value" is not wired', () => {
		const result = routeDecision({
			mode: 'auto', decisionRaw: '{"yes":0.9,"no":0.1}', value: null, threshold: 0.5, margin: 0, optionsText: '', bandsText: '',
		})
		expect(result.outputs.yes).toBe('yes')
	})

	it('noul: routes a wired value through the chosen branch instead of the decision text', () => {
		const result = routeDecision({
			mode: 'auto', decisionRaw: '{"yes":0.9,"no":0.1}', value: 'the actual payload', threshold: 0.5, margin: 0, optionsText: '', bandsText: '',
		})
		expect(result.outputs.yes).toBe('the actual payload')
		expect(result.outputs.no).toBeNull()
	})

	it('noul: routes to "unsure" when within the margin of the threshold', () => {
		const result = routeDecision({
			mode: 'noul', decisionRaw: '{"yes":0.52,"no":0.48}', value: null, threshold: 0.5, margin: 0.05, optionsText: '', bandsText: '',
		})
		expect(result.chosenPortId).toBe('unsure')
		expect(result.unsure).toBe(true)
	})

	it('noul: margin 0 (off) never routes to unsure', () => {
		const result = routeDecision({
			mode: 'noul', decisionRaw: '{"yes":0.5001,"no":0.4999}', value: null, threshold: 0.5, margin: 0, optionsText: '', bandsText: '',
		})
		expect(result.chosenPortId).toBe('yes')
	})

	it('choice: routes by the configured option that matches the decision', () => {
		const result = routeDecision({
			mode: 'auto', decisionRaw: '{"approve":0.2,"ask":0.1,"reject":0.7}', value: null, threshold: 0.5, margin: 0,
			optionsText: 'approve\nask\nreject', bandsText: '',
		})
		expect(result.resolvedMode).toBe('choice')
		expect(result.chosenPortId).toBe('opt:reject')
		expect(result.outputs['opt:reject']).toBe('reject')
		expect(result.outputs['opt:approve']).toBeNull()
		expect(result.outputs.other).toBeNull()
	})

	it('choice: unmatched answer routes to "other"', () => {
		const result = routeDecision({
			mode: 'choice', decisionRaw: 'something else entirely', value: null, threshold: 0.5, margin: 0,
			optionsText: 'approve\nreject', bandsText: '',
		})
		expect(result.chosenPortId).toBe('other')
		expect(result.outputs.other).toBe('something else entirely')
	})

	it('choice: falls back to the last seen options when none are configured', () => {
		const result = routeDecision({
			mode: 'choice', decisionRaw: 'approve', value: null, threshold: 0.5, margin: 0,
			optionsText: '', bandsText: '', lastOptions: ['approve', 'reject'],
		})
		expect(result.chosenPortId).toBe('opt:approve')
		expect(result.options).toEqual(['approve', 'reject'])
	})

	it('score: routes to the band matching the computed score', () => {
		const result = routeDecision({
			mode: 'score', decisionRaw: '{"low":0,"mid":0,"high":1}', value: null, threshold: 0.5, margin: 0,
			optionsText: '', bandsText: 'low: 0.33\nmid: 0.66\nhigh',
		})
		expect(result.chosenPortId).toBe('band:high')
		expect(result.outputs['band:high']).toBe('high')
		expect(result.outputs['band:low']).toBeNull()
	})

	it('score: a plain numeric decision also routes', () => {
		const result = routeDecision({
			mode: 'score', decisionRaw: '0.2', value: null, threshold: 0.5, margin: 0,
			optionsText: '', bandsText: 'low: 0.33\nmid: 0.66\nhigh',
		})
		expect(result.chosenPortId).toBe('band:low')
	})

	it('noul: nothing to decide (no probabilities, no yes/no answer) chooses nothing', () => {
		const result = routeDecision({ mode: 'noul', decisionRaw: 'maybe', value: null, threshold: 0.5, margin: 0, optionsText: '', bandsText: '' })
		expect(result.chosenPortId).toBeNull()
		expect(result.outputs).toEqual({ yes: null, no: null, unsure: null })
	})

	// Real-model bug (Clef Flash, billing/support/sales): empty "Options" with no prior run
	// must still route by the decision's own categories, not fall through to "other".
	it('choice: empty options routes by the decision\'s own probability keys on the very first run', () => {
		const result = routeDecision({
			mode: 'auto', decisionRaw: '{"billing":0.96,"support":0.02,"sales":0.02}', value: null, threshold: 0.5, margin: 0,
			optionsText: '', bandsText: '',
		})
		expect(result.resolvedMode).toBe('choice')
		expect(result.chosenPortId).toBe('opt:billing')
		expect(result.outputs['opt:billing']).toBe('billing')
		expect(result.outputs.other).toBeNull()
		expect(result.options).toEqual(['billing', 'support', 'sales'])
	})

	it('choice: empty options + a plain-text answer (no probabilities) still routes, not to "other"', () => {
		const result = routeDecision({
			mode: 'choice', decisionRaw: 'billing', value: null, threshold: 0.5, margin: 0, optionsText: '', bandsText: '',
		})
		expect(result.chosenPortId).toBe('opt:billing')
		expect(result.outputs['opt:billing']).toBe('billing')
	})

	it('value is never null when there is a decision, even when "value" is not wired', () => {
		const noul = routeDecision({ mode: 'auto', decisionRaw: '{"yes":0.9,"no":0.1}', value: null, threshold: 0.5, margin: 0, optionsText: '', bandsText: '' })
		expect(noul.value).toBe('yes')
		const choice = routeDecision({ mode: 'auto', decisionRaw: '{"billing":0.96,"support":0.04}', value: null, threshold: 0.5, margin: 0, optionsText: '', bandsText: '' })
		expect(choice.value).toBe('billing')
		const score = routeDecision({ mode: 'score', decisionRaw: '0.8', value: null, threshold: 0.5, margin: 0, optionsText: '', bandsText: 'low: 0.5\nhigh' })
		expect(score.value).toBe('0.8')
	})

	it('value uses the wired "value" input instead of the decision text when both are present', () => {
		const result = routeDecision({
			mode: 'auto', decisionRaw: '{"billing":0.96,"support":0.04}', value: 'the real payload', threshold: 0.5, margin: 0, optionsText: '', bandsText: '',
		})
		expect(result.outputs['opt:billing']).toBe('the real payload')
	})
})

describe('choiceLabelsForRoute', () => {
	it('prefers the user\'s typed options over anything derived from the decision', () => {
		const parsed = parseDecision('{"billing":0.9,"support":0.1}')
		expect(choiceLabelsForRoute('approve\nreject', parsed)).toEqual(['approve', 'reject'])
	})

	it('derives labels from the decision\'s probability keys when options are empty', () => {
		const parsed = parseDecision('{"billing":0.9,"support":0.1}')
		expect(choiceLabelsForRoute('', parsed)).toEqual(['billing', 'support'])
	})

	it('derives a single label from a plain-text answer, reusing a matching lastOptions label\'s case', () => {
		const parsed = parseDecision('billing')
		expect(choiceLabelsForRoute('', parsed, null)).toEqual(['billing'])
		expect(choiceLabelsForRoute('', parsed, ['Billing', 'Support'])).toEqual(['Billing', 'Support'])
	})

	it('falls back to lastOptions when the decision has nothing at all', () => {
		expect(choiceLabelsForRoute('', parseDecision(''), ['billing', 'support'])).toEqual(['billing', 'support'])
	})
})
