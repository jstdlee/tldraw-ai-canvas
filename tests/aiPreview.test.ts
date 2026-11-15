import { describe, expect, it } from 'vitest'
import {
	documentOnly,
	isDiffEmpty,
	PreviewDiff,
	previewMarks,
	previewMarksCss,
	previewSummary,
	rebaseDiff,
	reverseDiff,
	squashDiffs,
	turnHasReply,
} from '../shared/aiPreview'
import { errorText, getAgentErrorMessage } from '../shared/format/agentError'
import { getDefaultModelFallback } from '../shared/aiConfig'
import { cardCatalogText, fieldOptionsText, NODE_SPECS } from '../shared/nodeSpecs'

const card = (id: string, node: Record<string, unknown>) => ({ id, typeName: 'shape', type: 'node', props: { node } })

describe('preview diff bookkeeping (WP48)', () => {
	it('squashes add + update into one add, and add + remove into nothing', () => {
		const a = card('shape:a', { type: 'prompt', text: '1' })
		const a2 = card('shape:a', { type: 'prompt', text: '2' })
		const squashed = squashDiffs([
			{ added: { 'shape:a': a }, updated: {}, removed: {} },
			{ added: {}, updated: { 'shape:a': [a, a2] }, removed: {} },
		])
		expect(squashed.added['shape:a']).toEqual(a2)
		expect(Object.keys(squashed.updated)).toEqual([])
		const gone = squashDiffs([squashed, { added: {}, updated: {}, removed: { 'shape:a': a2 } }])
		expect(isDiffEmpty(gone)).toBe(true)
	})

	it('squashes two updates to the first from and last to, and drops a no-op', () => {
		const v1 = card('shape:b', { type: 'prompt', text: 'old' })
		const v2 = card('shape:b', { type: 'prompt', text: 'mid' })
		const v3 = card('shape:b', { type: 'prompt', text: 'new' })
		const squashed = squashDiffs([
			{ added: {}, updated: { 'shape:b': [v1, v2] }, removed: {} },
			{ added: {}, updated: { 'shape:b': [v2, v3] }, removed: {} },
		])
		expect(squashed.updated['shape:b']).toEqual([v1, v3])
		const back = squashDiffs([squashed, { added: {}, updated: { 'shape:b': [v3, v1] }, removed: {} }])
		expect(isDiffEmpty(back)).toBe(true)
	})

	it('keeps only shapes, bindings and assets', () => {
		const diff = documentOnly({
			added: { 'shape:a': { id: 'shape:a' }, 'binding:x': { id: 'binding:x' } },
			updated: { 'camera:page:1': [{ id: 'camera:page:1' }, { id: 'camera:page:1' }] },
			removed: { 'instance_page_state:p': { id: 'instance_page_state:p' } },
		})
		expect(Object.keys(diff.added).sort()).toEqual(['binding:x', 'shape:a'])
		expect(diff.updated).toEqual({})
		expect(diff.removed).toEqual({})
	})

	it('reverses: added become removed, updates swap', () => {
		const v1 = card('shape:b', { text: 'old' })
		const v2 = card('shape:b', { text: 'new' })
		const diff: PreviewDiff = { added: { 'shape:a': { id: 'shape:a' } }, updated: { 'shape:b': [v1, v2] }, removed: { 'shape:c': { id: 'shape:c' } } }
		const reversed = reverseDiff(diff)
		expect(Object.keys(reversed.removed)).toEqual(['shape:a'])
		expect(Object.keys(reversed.added)).toEqual(['shape:c'])
		expect(reversed.updated['shape:b']).toEqual([v2, v1])
	})

	it('rebases on the current records: later edits are kept, deleted shapes dropped', () => {
		const v1 = card('shape:b', { text: 'old' })
		const v2 = card('shape:b', { text: 'ai' })
		const moved = { ...card('shape:a', { text: 'x' }), x: 50 }
		const diff: PreviewDiff = {
			added: { 'shape:a': card('shape:a', { text: 'x' }), 'shape:gone': { id: 'shape:gone' } },
			updated: { 'shape:b': [v1, v2] },
			removed: {},
		}
		const now: Record<string, any> = { 'shape:a': moved, 'shape:b': { ...v2, y: 9 } }
		const rebased = rebaseDiff(diff, (id) => now[id])
		expect(rebased.added).toEqual({ 'shape:a': moved })
		expect(rebased.updated['shape:b']).toEqual([v1, { ...v2, y: 9 }])
	})

	it('marks new shapes, changed shapes and changed card fields', () => {
		const v1 = card('shape:b', { type: 'text_tool', tool: 'regex', text: 'a' })
		const v2 = card('shape:b', { type: 'text_tool', tool: 'upper', text: 'a' })
		const diff: PreviewDiff = { added: { 'shape:a': { id: 'shape:a' }, 'binding:z': { id: 'binding:z' } }, updated: { 'shape:b': [v1, v2] }, removed: {} }
		const marks = previewMarks(diff)
		expect(marks).toEqual({ added: ['shape:a'], changed: ['shape:b'], fields: { 'shape:b': ['tool'] } })
		const css = previewMarksCss(marks)
		expect(css).toContain('.tl-shape[data-shape-id="shape:a"]')
		expect(css).toContain('opacity: 0.55')
		expect(css).toContain('[data-field-keys~="tool"]')
		expect(previewSummary(diff)).toBe('1 new shape, 1 changed')
	})
})

describe('the end of an agent turn (WP48 bug 1)', () => {
	it('needs a message, a question, a task, an error or a change', () => {
		expect(turnHasReply([])).toBe(false)
		expect(turnHasReply([{ type: 'prompt' }, { type: 'action', actionType: 'think', complete: true }])).toBe(false)
		expect(turnHasReply([{ type: 'action', actionType: 'message', complete: true }])).toBe(true)
		expect(turnHasReply([{ type: 'action', actionType: 'create', complete: true, hasDiff: true }])).toBe(true)
		expect(turnHasReply([{ type: 'error' }])).toBe(true)
		expect(turnHasReply([{ type: 'task' }])).toBe(true)
	})
})

describe('readable error text (WP48 bug 2)', () => {
	it('never shows [object Object]', () => {
		expect(errorText({ error: { message: 'Rate limit reached' } })).toBe('Rate limit reached')
		expect(errorText({ message: 'Bad key', code: 401 })).toBe('Bad key')
		expect(errorText('[object Object]')).toBe('')
		expect(getAgentErrorMessage(new Error('[object Object]'))).not.toContain('object Object')
		expect(getAgentErrorMessage({ error: { message: 'Quota' } })).toBe('Quota')
		expect(errorText({ code: 7 })).toBe('{"code":7}')
	})
})

describe('default model fallback warning (WP48 bug 4)', () => {
	const models = [{ key: 'p/a', providerId: 'p', model: 'a', label: 'A', capabilities: ['agent' as const] }]
	it('reports a default that is not in the models list, and what is used', () => {
		expect(getDefaultModelFallback({ models, defaults: { agent: 'p/gone' } }, 'agent')).toEqual({ wanted: 'p/gone', used: models[0] })
		expect(getDefaultModelFallback({ models, defaults: { agent: 'p/a' } }, 'agent')).toBeNull()
		expect(getDefaultModelFallback({ models, defaults: {} }, 'agent')).toBeNull()
	})
})

describe('agent prompt text (WP48)', () => {
	it('lists the card catalog in one line per visible card', () => {
		const text = cardCatalogText()
		const visible = Object.values(NODE_SPECS).filter((s) => !s.hidden)
		expect(text.split('\n')).toHaveLength(visible.length)
		expect(text).toContain('- prompt — ')
	})

	it('lists every option of a card choice field, unclamped', () => {
		const withOptions = Object.values(NODE_SPECS).find((s) => s.fields.some((f) => (f.options?.length ?? 0) > 3))!
		const field = withOptions.fields.find((f) => (f.options?.length ?? 0) > 3)!
		const text = fieldOptionsText(withOptions.type)
		for (const option of field.options!) expect(text).toContain(JSON.stringify(option))
		expect(text).toMatch(/prefer an existing option/)
	})
})
