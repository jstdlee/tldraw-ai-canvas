import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, nodeProps, runNode, wire, zoomToFit } from './helpers'
import { buildAdhocModelValue } from '../../shared/modelRef'

const BASE_AGENT_NODE = {
	type: 'agent' as const,
	model: '',
	task: '',
	search: '[]',
	mcpServers: '[]',
	skills: '[]',
	systemPrompt: '',
	maxSteps: 12,
	answerFormat: 'text',
	lastOutput: null,
	lastStepsJson: null,
	error: null,
}

/**
 * WP31 Part D: the Agent card. `/api/agent/run` is mocked with `page.route` as an SSE stream —
 * this suite never calls a real model, search provider or MCP server.
 */
test.describe('Agent card', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('runs, shows the step list, and fills output + steps', async ({ page }) => {
		await page.route('**/api/agent/run', async (route) => {
			expect(route.request().method()).toBe('POST')
			const body = route.request().postDataJSON() as { task: string }
			expect(body.task).toBe('What color is the sky?')
			const events = [
				{ type: 'step_start', step: 1 },
				{ type: 'tool_call', step: 1, toolCallId: 'c1', name: 'web_search', argsPreview: '{"query":"sky color"}' },
				{ type: 'tool_result', step: 1, toolCallId: 'c1', name: 'web_search', resultPreview: 'The sky is blue', isError: false },
				{ type: 'final', output: 'The sky is blue.', steps: [{ step: 1, kind: 'tool_call', name: 'web_search' }] },
			]
			const sse = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
			await route.fulfill({ contentType: 'text/event-stream', body: sse })
		})

		const id = await createNode(
			page,
			{
				type: 'agent',
				model: '',
				task: 'What color is the sky?',
				search: '["exa"]',
				mcpServers: '[]',
				skills: '[]',
				systemPrompt: '',
				maxSteps: 12,
				lastOutput: null,
				lastStepsJson: null,
				error: null,
			},
			{ x: 100, y: 100 }
		)
		await zoomToFit(page)
		await runNode(page, id)

		const node = await nodeProps<{ lastOutput: string | null; lastStepsJson: string | null; error: string | null }>(
			page,
			id
		)
		expect(node.error).toBeNull()
		expect(node.lastOutput).toBe('The sky is blue.')
		const steps = JSON.parse(node.lastStepsJson ?? '[]')
		expect(steps).toHaveLength(1)
		expect(steps[0].name).toBe('web_search')

		await expect(nodeLocator(page, id)).toContainText('web_search')
		await expect(nodeLocator(page, id)).toContainText('The sky is blue.')
	})

	test('a server error shows in the status line, not a crash', async ({ page }) => {
		await page.route('**/api/agent/run', async (route) => {
			const sse = `data: ${JSON.stringify({ type: 'error', message: 'No model for "agent".', steps: [] })}\n\n`
			await route.fulfill({ contentType: 'text/event-stream', body: sse })
		})

		const id = await createNode(
			page,
			{
				type: 'agent',
				model: '',
				task: 'anything',
				search: '[]',
				mcpServers: '[]',
				skills: '[]',
				systemPrompt: '',
				maxSteps: 12,
				lastOutput: null,
				lastStepsJson: null,
				error: null,
			},
			{ x: 100, y: 100 }
		)
		await zoomToFit(page)
		await runNode(page, id)

		const node = await nodeProps<{ error: string | null }>(page, id)
		expect(node.error).toMatch(/No model for/)
		await expect(nodeLocator(page, id)).toContainText('No model for')
	})

	// AI-02/GAPS-02: the `model` port was drawn as wirable but `execute()` never actually read
	// it — the card's own dropdown value (even empty) was always sent instead.
	test('a wired Model provider overrides the dropdown', async ({ page }) => {
		let sentModel: string | undefined
		await page.route('**/api/agent/run', async (route) => {
			sentModel = (route.request().postDataJSON() as { model?: string }).model
			const sse = `data: ${JSON.stringify({ type: 'final', output: 'ok', steps: [] })}\n\n`
			await route.fulfill({ contentType: 'text/event-stream', body: sse })
		})

		const modelId = await createNode(
			page,
			{
				type: 'model_source',
				baseURL: 'https://example.com/v1',
				keyRef: undefined,
				models: JSON.stringify([{ id: 'wired-model' }]),
				model: 'wired-model',
				filter: '',
				kind: 'chat',
				fetchedAt: null,
				error: null,
			},
			{ x: 0, y: 300 }
		)
		const agentId = await createNode(page, { ...BASE_AGENT_NODE, task: 'say ok', model: 'card-own-model' }, { x: 400, y: 100 })
		await wire(page, modelId, 'model', agentId, 'model')
		await zoomToFit(page)
		await runNode(page, agentId)

		expect(sentModel).toBe(buildAdhocModelValue({ kind: 'adhoc', baseURL: 'https://example.com/v1', model: 'wired-model' }))
		const node = await nodeProps<{ error: string | null }>(page, agentId)
		expect(node.error).toBeNull()
	})

	// AI-08: the status row used to read "Not run yet" permanently, even right after a clean
	// finish — no success state existed at all.
	test('the status row shows "Done" after a successful run', async ({ page }) => {
		await page.route('**/api/agent/run', async (route) => {
			const sse = `data: ${JSON.stringify({ type: 'final', output: 'The answer.', steps: [] })}\n\n`
			await route.fulfill({ contentType: 'text/event-stream', body: sse })
		})
		const id = await createNode(page, { ...BASE_AGENT_NODE, task: 'anything' }, { x: 100, y: 100 })
		await zoomToFit(page)
		await expect(nodeLocator(page, id)).toContainText('Not run yet')
		await runNode(page, id)
		await expect(nodeLocator(page, id)).toContainText('Done')
	})

	// WP33 item E: answerFormat adds a format instruction and validates the answer; an invalid
	// first answer is re-asked once, and the card's output is the clean, re-serialized format.
	test('answerFormat "json": an invalid first answer is re-asked once; output is clean JSON', async ({ page }) => {
		let callCount = 0
		const tasksSent: string[] = []
		await page.route('**/api/agent/run', async (route) => {
			callCount++
			tasksSent.push((route.request().postDataJSON() as { task: string }).task)
			const output = callCount === 1 ? 'Sure! Here you go: {"a":1}' : '{"a":1,"b":2}'
			const sse = `data: ${JSON.stringify({ type: 'final', output, steps: [] })}\n\n`
			await route.fulfill({ contentType: 'text/event-stream', body: sse })
		})
		const id = await createNode(page, { ...BASE_AGENT_NODE, task: 'Give me a small JSON object.', answerFormat: 'json' }, { x: 100, y: 100 })
		await zoomToFit(page)
		await runNode(page, id)

		expect(callCount).toBe(2)
		expect(tasksSent[0]).toMatch(/only valid JSON/)
		expect(tasksSent[1]).toContain('not valid JSON') // the re-ask quotes the problem
		const node = await nodeProps<{ lastOutput: string | null; error: string | null }>(page, id)
		expect(node.error).toBeNull()
		expect(JSON.parse(node.lastOutput ?? '')).toEqual({ a: 1, b: 2 })
	})

	test('answerFormat "table": a Markdown table answer is normalized to clean CSV', async ({ page }) => {
		await page.route('**/api/agent/run', async (route) => {
			const md = '| name | score |\n| --- | --- |\n| Ada | 3 |'
			const sse = `data: ${JSON.stringify({ type: 'final', output: md, steps: [] })}\n\n`
			await route.fulfill({ contentType: 'text/event-stream', body: sse })
		})
		const id = await createNode(page, { ...BASE_AGENT_NODE, task: 'Give me a one-row table.', answerFormat: 'table' }, { x: 100, y: 100 })
		await zoomToFit(page)
		await runNode(page, id)
		const node = await nodeProps<{ lastOutput: string | null; error: string | null }>(page, id)
		expect(node.error).toBeNull()
		expect(node.lastOutput).toBe('name,score\nAda,3')
	})

	// WP33 item E: {{vars}} in the task get their own `var:<name>` input ports, same mechanism
	// as Web search / Generate text.
	test('{{vars}} in the task are filled from wired var: ports', async ({ page }) => {
		let taskSent = ''
		await page.route('**/api/agent/run', async (route) => {
			taskSent = (route.request().postDataJSON() as { task: string }).task
			const sse = `data: ${JSON.stringify({ type: 'final', output: 'ok', steps: [] })}\n\n`
			await route.fulfill({ contentType: 'text/event-stream', body: sse })
		})
		const promptId = await createNode(page, { type: 'prompt', text: 'France' }, { x: 0, y: 300 })
		const agentId = await createNode(page, { ...BASE_AGENT_NODE, task: 'Tell me the capital of {{country}}.' }, { x: 400, y: 100 })
		await wire(page, promptId, 'output', agentId, 'var:country')
		await zoomToFit(page)
		await runNode(page, agentId)
		expect(taskSent).toContain('Tell me the capital of France.')
	})
})
