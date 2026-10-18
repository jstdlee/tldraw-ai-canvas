import { expect, test } from '@playwright/test'
import { createDefaultNode, gotoApp, nodeProps, runNode, wire, zoomToFit } from './helpers'

/**
 * FLOW-03: wiring a Prompt into Chat's "Reply to" (`parent`) seeds prior conversation history,
 * not this turn's message — the "Chat message" example did exactly that and always hit "Type a
 * message first." The outgoing message is the `userMessage` field itself, already wirable via
 * its own `field:userMessage` port (WP17) — this proves that path actually sends the wired text,
 * matching the fixed example in shared/examples.ts. The model call is always mocked.
 */
test.describe('a prompt wired into Chat\'s Message field is sent as the turn', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('runs without "Type a message first." and sends the wired text', async ({ page }) => {
		const captured: { body: { messages?: { role: string; content: unknown }[] } | null } = { body: null }
		await page.route('/api/chat', async (route) => {
			captured.body = route.request().postDataJSON()
			await route.fulfill({ status: 200, contentType: 'text/plain', body: 'Hello there!' })
		})

		const promptId = await createDefaultNode(page, 'prompt', { text: 'Say hello in one short sentence.' }, { x: 0, y: 0 })
		const chatId = await createDefaultNode(page, 'chat', {}, { x: 460, y: 0 })
		await zoomToFit(page)
		await wire(page, promptId, 'output', chatId, 'field:userMessage')

		await runNode(page, chatId)

		const props = await nodeProps<{ error: string | null; assistantMessage: string }>(page, chatId)
		expect(props.error).not.toBe('Type a message first.')
		expect(props.assistantMessage).toBe('Hello there!')
		const lastMessage = captured.body?.messages?.at(-1)
		expect(lastMessage?.content).toBe('Say hello in one short sentence.')
	})
})
