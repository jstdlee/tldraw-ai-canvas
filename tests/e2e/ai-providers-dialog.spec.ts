import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeProps, runNode, zoomToFit } from './helpers'

/**
 * WP31 owner follow-up: search providers and MCP servers are entries in the same unified
 * "+ Add provider" list as model providers (each with its own detail pane), not separate
 * sections. Confirms: adding a search provider from the menu, saving its key as a `secret:`
 * ref (never raw), and that the Web search card still resolves it; and that an MCP server's
 * secret-looking env/header is only ever saved as a ref, never a raw value.
 */
async function openProvidersDialog(page: import('@playwright/test').Page) {
	await page.evaluate(async () => {
		// @ts-expect-error dynamic import of an app source file, only resolvable by the dev
		// server — same trick tests/e2e/helpers.ts uses elsewhere.
		const mod = await import('/client/ai/aiConfig.tsx')
		mod.openProvidersDialog()
	})
	await page.waitForSelector('.ai-dialog')
}

test.describe('AI providers dialog: unified Models / Search / MCP list', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('adding a search provider saves its key as a secret ref, and the Web search card finds it', async ({
		page,
	}) => {
		await openProvidersDialog(page)

		// "+ Add provider" -> Search -> Exa.
		await page.locator('.ai-dialog__add').selectOption('search:exa')
		await expect(page.locator('.ai-dialog__list-item.is-selected .ai-dialog__list-name')).toHaveText('Exa')

		// Type a key into the (now visible) secret input and blur to save it.
		const keyInput = page.locator('.ai-dialog__detail .UiSecretInput input[type="password"]')
		await keyInput.fill('fake-exa-test-key')
		await keyInput.blur()
		await expect(page.locator('.ai-dialog__detail')).toContainText('Key saved')

		const config = await page.evaluate(async () => (await fetch('/api/search-config')).json())
		expect(config.exa?.keyRef).toMatch(/^secret:/)

		await page.locator('.ai-icon-button[aria-label="Close"]').click()

		// The Web search card (no key of its own) still works: the server resolves the
		// saved default. `/api/search` is mocked here so this never calls a real API —
		// the point is the card's own request has no keyRef, relying on the saved default.
		await page.route('**/api/search', async (route) => {
			const body = route.request().postDataJSON() as { provider: string; keyRef?: string }
			expect(body.provider).toBe('exa')
			expect(body.keyRef).toBeFalsy()
			await route.fulfill({
				json: { provider: 'exa', ms: 1, results: [{ title: 'T', url: 'https://example.com', snippet: 's' }] },
			})
		})
		const id = await createNode(
			page,
			{
				type: 'web_search',
				provider: 'exa',
				query: 'test',
				count: 5,
				tavilyDepth: 'basic',
				tavilyIncludeAnswer: false,
				exaIncludeText: false,
				keyRef: '',
				lastResultsJson: null,
				lastAnswer: null,
				lastInfo: '',
				error: null,
			},
			{ x: 100, y: 100 }
		)
		await zoomToFit(page)
		await runNode(page, id)
		const node = await nodeProps<{ lastResultsJson: string | null; error: string | null }>(page, id)
		expect(node.error).toBeNull()
		expect(JSON.parse(node.lastResultsJson ?? '[]')).toHaveLength(1)
	})

	test('an MCP server env var named like a secret is only ever saved as a ref', async ({ page }) => {
		// Another agent's concurrently-running dev server in this shared working tree can
		// trigger a Vite full-page reload (a "Could not Fast Refresh" HMR invalidate) mid-test,
		// which wipes this dialog's in-memory state. Retry the whole open+add sequence a few
		// times so one unlucky reload doesn't fail an otherwise-correct test.
		const keyField = page.locator('.ai-kv-editor input.ai-kv-key')
		let ready = false
		for (let attempt = 0; attempt < 4 && !ready; attempt++) {
			if (attempt > 0) await gotoApp(page)
			await openProvidersDialog(page)
			await page.locator('.ai-dialog__add').selectOption('mcp:stdio')
			await expect(page.locator('.ai-dialog__list-item.is-selected .ai-dialog__list-kind')).toHaveText('stdio')
			// A command is required for the server to validate/save at all (a real server
			// needs one anyway); set it before adding an env row.
			const commandField = page.locator('.ai-dialog__detail input[placeholder="node, uvx, npx…"]')
			await commandField.fill('node')
			await commandField.blur()
			await page.locator('.ai-dialog__detail').getByText('+ Add').click()
			try {
				await keyField.waitFor({ timeout: 3000 })
				ready = true
			} catch {
				// Retry: the page may have reloaded out from under us.
			}
		}
		expect(ready, 'the new MCP server\'s env-row key field never appeared (after retries)').toBe(true)

		// The new row defaults to key "NAME"; rename it to something secret-looking.
		await keyField.fill('Authorization')
		await keyField.blur()

		// Secret-looking name -> the value control defaults to the secret store, never plain text.
		const valueInput = page.locator('.ai-kv-editor .UiSecretInput input[type="password"]')
		await valueInput.fill('fake-mcp-token')
		await valueInput.blur()
		await expect(page.locator('.ai-kv-editor')).toContainText('Key saved')

		const config = await page.evaluate(async () => (await fetch('/api/mcp-config')).json())
		const server = config.find((s: { transport: string }) => s.transport === 'stdio')
		expect(server.env.Authorization).toMatch(/^secret:/)
		expect(server.env.Authorization).not.toContain('fake-mcp-token')
	})
})
