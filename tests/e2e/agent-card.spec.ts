import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, nodeProps, runNode, zoomToFit } from './helpers'

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
})
