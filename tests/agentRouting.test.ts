import { describe, expect, it } from 'vitest'
import { getQuickActions, revisionGoal, routeAgentTask, taskHistoryLine } from '../shared/agentRouting'

const canvas = { kind: 'canvas' as const }
const card = { kind: 'card' as const }
const cards = { kind: 'cards' as const }
const text = { kind: 'text' as const }
const image = { kind: 'image' as const }
const mixed = { kind: 'mixed' as const }

describe('getQuickActions (WP44)', () => {
	it('lists the chips for each scope', () => {
		expect(getQuickActions(canvas).map((a) => a.label)).toEqual(['Draw a flowchart', 'Build a workflow', 'What can you do?'])
		expect(getQuickActions(cards).map((a) => a.label)).toEqual(['Wire these up', 'Explain this flow'])
		expect(getQuickActions(text).map((a) => a.label)).toEqual([
			'Summarize',
			'Translate…',
			'Improve writing',
			'Brainstorm',
			'Rewrite…',
			'Make a checklist',
		])
		expect(getQuickActions(image).map((a) => a.label)).toEqual(['Describe', 'Extract text', 'Send to pipeline'])
		expect(getQuickActions(mixed).map((a) => a.label)).toEqual(['Explain', 'Summarize'])
	})

	it('a card gets its own chips, Explain, and Fix error only when it shows an error', () => {
		const ok = getQuickActions(card, { chips: ['GET this URL', 'POST JSON to…'], hasError: false })
		expect(ok.map((a) => a.label)).toEqual(['GET this URL', 'POST JSON to…', 'Explain this card'])
		// A chip ending in "…" asks for more: it prefills the input instead of running.
		expect(ok[1]).toMatchObject({ id: 'card-chip', needs: 'input', prefill: 'POST JSON to ' })
		expect(ok[0].needs).toBeUndefined()
		const broken = getQuickActions(card, { chips: [], hasError: true })
		expect(broken.map((a) => a.id)).toEqual(['fix-error', 'explain-card'])
	})

	it('Translate… needs input and Rewrite… needs a sheet', () => {
		const actions = getQuickActions(text)
		expect(actions.find((a) => a.id === 'translate')?.needs).toBe('input')
		expect(actions.find((a) => a.id === 'rewrite')?.needs).toBe('sheet')
	})
})

describe('routeAgentTask (WP44)', () => {
	it('maps quick actions to fixed routes', () => {
		expect(routeAgentTask(text, { action: 'summarize' })).toMatchObject({ route: 'text-job', job: 'summarize', label: 'Summarize' })
		expect(routeAgentTask(text, { action: 'improve' })).toMatchObject({ route: 'text-job', job: 'improve' })
		expect(routeAgentTask(text, { action: 'brainstorm' })).toMatchObject({ route: 'text-job', job: 'brainstorm' })
		expect(routeAgentTask(text, { action: 'translate', text: 'French' })).toMatchObject({
			route: 'text-job',
			job: 'translate',
			text: 'French',
			label: 'Translate → French',
		})
		expect(routeAgentTask(image, { action: 'describe' })).toMatchObject({ route: 'image-job', job: 'describe' })
		expect(routeAgentTask(image, { action: 'ocr' })).toMatchObject({ route: 'image-job', job: 'ocr' })
		expect(routeAgentTask(image, { action: 'send-to-pipeline' })?.route).toBe('send-to-pipeline')
		expect(routeAgentTask(mixed, { action: 'explain' })?.route).toBe('explain')
		expect(routeAgentTask(card, { action: 'explain-card' })?.route).toBe('explain')
		expect(routeAgentTask(cards, { action: 'explain-flow' })?.route).toBe('explain')
		expect(routeAgentTask(text, { action: 'rewrite', text: 'Shorter.', label: 'Shorter' })).toMatchObject({
			route: 'rewrite',
			text: 'Shorter.',
			label: 'Shorter',
		})
		expect(routeAgentTask(text, { action: 'checklist' })?.route).toBe('list-format')
		expect(routeAgentTask(card, { action: 'card-chip', text: 'GET this URL' })).toMatchObject({ route: 'node-assist', text: 'GET this URL' })
		expect(routeAgentTask(card, { action: 'fix-error', text: 'HTTP 404' })).toMatchObject({
			route: 'node-assist',
			text: 'Fix this error: HTTP 404',
		})
		expect(routeAgentTask(cards, { action: 'wire-up' })?.route).toBe('build')
		expect(routeAgentTask(canvas, { action: 'build-workflow', text: 'load sales.xlsx' })).toMatchObject({
			route: 'build',
			text: 'load sales.xlsx',
			label: 'Build: load sales.xlsx',
		})
		expect(routeAgentTask(canvas, { action: 'draw-flowchart' })?.route).toBe('agent')
		expect(routeAgentTask(canvas, { action: 'what-can-you-do' })?.route).toBe('agent')
	})

	it('returns null when a quick action still needs its answer', () => {
		expect(routeAgentTask(text, { action: 'translate' })).toBeNull()
		expect(routeAgentTask(text, { action: 'rewrite' })).toBeNull()
		expect(routeAgentTask(canvas, { action: 'build-workflow' })).toBeNull()
		expect(routeAgentTask(card, { action: 'card-chip', text: ' ' })).toBeNull()
	})

	it('routes free text by scope', () => {
		expect(routeAgentTask(card, { text: 'filter rows over 3' })).toMatchObject({ route: 'node-assist', text: 'filter rows over 3' })
		expect(routeAgentTask(cards, { text: 'wire them' })?.route).toBe('build')
		expect(routeAgentTask(canvas, { text: 'draw a cat' })?.route).toBe('agent')
		expect(routeAgentTask(text, { text: 'what is this?' })?.route).toBe('agent')
		expect(routeAgentTask(image, { text: 'hi' })?.route).toBe('agent')
		expect(routeAgentTask(mixed, { text: 'hi' })?.route).toBe('agent')
		expect(routeAgentTask(canvas, { text: '   ' })).toBeNull()
	})

	it('free text after an unapplied plan revises it', () => {
		const lastTask = { route: 'build', status: 'done' }
		expect(routeAgentTask(canvas, { text: 'use a line chart' }, { lastTask })).toMatchObject({ route: 'build', revision: true })
		expect(routeAgentTask(card, { text: 'use a line chart' }, { lastTask })).toMatchObject({ route: 'build', revision: true })
		// Applied, discarded or failed plans do not.
		expect(routeAgentTask(canvas, { text: 'hi' }, { lastTask: { route: 'build', status: 'applied' } })?.route).toBe('agent')
		expect(routeAgentTask(canvas, { text: 'hi' }, { lastTask: { route: 'build', status: 'discarded' } })?.route).toBe('agent')
		expect(routeAgentTask(canvas, { text: 'hi' }, { lastTask: { route: 'text-job', status: 'done' } })?.route).toBe('agent')
		// A quick action is never a revision.
		expect(routeAgentTask(text, { action: 'summarize' }, { lastTask })?.route).toBe('text-job')
	})

	it('builds the revision prompt from the goal, the change and the previous plan', () => {
		const goal = revisionGoal('chart sales', 'use a line chart', { summary: 'x' })
		expect(goal).toBe('chart sales\n\nRevision: use a line chart\n\nPrevious plan (adjust it, do not start over unless asked):\n{"summary":"x"}')
	})
})

describe('taskHistoryLine (WP44)', () => {
	it('is one short line with the first 300 characters of the result', () => {
		const line = taskHistoryLine({ label: 'Summarize', scopeLabel: '2 texts', status: 'done', text: 'a'.repeat(400) })
		expect(line).toBe(`[Task Summarize on 2 texts: done] ${'a'.repeat(300)}`)
		expect(taskHistoryLine({ label: 'Build: x', scopeLabel: 'Canvas', status: 'error', error: 'HTTP 500' })).toBe(
			'[Task Build: x on Canvas: error] HTTP 500'
		)
		expect(taskHistoryLine({ label: 'Make a checklist', scopeLabel: '1 text', status: 'running' })).toBe('[Task Make a checklist on 1 text: running]')
	})
})

describe('drawing agent chat history with task items (WP44)', async () => {
	const { ChatHistoryPartDefinition } = await import('../shared/schema/PromptPartDefinitions')
	it('turns a task item into one assistant text line, without its plan', () => {
		const messages = ChatHistoryPartDefinition.buildMessages!({
			type: 'chatHistory',
			history: [
				{ type: 'prompt', promptSource: 'user', agentFacingMessage: 'Summarize', userFacingMessage: 'Summarize', contextItems: [], selectedShapes: [] },
				{
					type: 'task',
					id: 't1',
					route: 'text-job',
					label: 'Summarize',
					scopeLabel: '2 texts',
					scopeIds: ['shape:a', 'shape:b'],
					status: 'done',
					text: '# Title\n- one',
					plan: { big: true },
				},
				{ type: 'prompt', promptSource: 'user', agentFacingMessage: 'next', userFacingMessage: null, contextItems: [], selectedShapes: [] },
			],
		} as any)
		expect(messages).toHaveLength(2)
		expect(messages[1]).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: '[Task Summarize on 2 texts: done] # Title\n- one' }] })
	})
})
