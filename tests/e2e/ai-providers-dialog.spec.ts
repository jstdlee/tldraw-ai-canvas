import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, nodeProps, runNode, zoomToFit } from './helpers'

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

/** AI-03/UI-01/UI-11: a provider with a realistic number of models (20+) used to let the model
 * table's lower rows paint underneath/through "Default model for each job" and Skills —
 * unreadable, and unclickable (confirmed via elementFromPoint in the original review). */
test.describe('AI providers dialog: a provider with many models does not overlap', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
		// A synthetic 21-model provider, PUT straight at the config endpoint (no real network;
		// mirrors the project's own shipped 20+-model Magpie config that triggered this bug).
		const provider = { id: 'many', name: 'Many Models', kind: 'openai-compatible', baseURL: 'http://127.0.0.1:1/v1', enabled: true, apiKey: '' }
		const models = Array.from({ length: 21 }, (_, i) => ({
			key: `many/model-${i}`,
			providerId: 'many',
			model: `model-${i}`,
			label: `Model ${i}`,
			capabilities: ['chat'],
			supportsTemperature: true,
		}))
		// This describe block's own tests share one server/config for the whole run (not reset
		// between tests): drop any earlier copy of 'many' before adding a fresh one, or repeat
		// runs accumulate duplicate provider/model entries (duplicate React keys, broken list).
		const current = await page.evaluate(async () => (await fetch('/api/config')).json())
		await page.evaluate(
			async ({ current, provider, models }) => {
				const providers = current.providers.filter((p: { id: string }) => p.id !== 'many')
				const otherModels = current.models.filter((m: { providerId: string }) => m.providerId !== 'many')
				await fetch('/api/config', {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ...current, providers: [...providers, provider], models: [...otherModels, ...models] }),
				})
			},
			{ current, provider, models }
		)
		// The app loads `/api/config` once on mount into a client-side atom (`$aiConfig`); this
		// PUT went straight to the server, bypassing that atom. Reload so the dialog (which reads
		// the atom synchronously at open-time) actually sees the provider just added — otherwise
		// this is a race against the page's own initial config fetch.
		await gotoApp(page)
	})

	test('no row overlaps "Default model for each job" / Skills, and every row is clickable', async ({ page }) => {
		await openProvidersDialog(page)
		await page.locator('.ai-dialog__list-item', { hasText: 'Many Models' }).click()

		const rows = page.locator('table.ai-models tbody tr')
		await expect(rows).toHaveCount(21)

		// AI-03's fix: `.ai-dialog__columns` is the model table's real scroll-clipping ancestor
		// (its own box stays bounded; the table inside it keeps its full, un-clipped layout size
		// — that's normal for a scroll container, not a bug, so the check belongs on the
		// ancestor's box, not the table's own). It must never overlap "Default model for each job".
		const defaultsBox = await page.locator('.ai-defaults__title', { hasText: 'Default model for each job' }).boundingBox()
		const columnsBox = await page.locator('.ai-dialog__columns').boundingBox()
		expect(defaultsBox).toBeTruthy()
		expect(columnsBox).toBeTruthy()
		if (defaultsBox && columnsBox) {
			expect(columnsBox.y + columnsBox.height).toBeLessThanOrEqual(defaultsBox.y + 1)
		}

		// Scroll the model detail pane to its end so the last rows are in view, then confirm a
		// normal (non-forced) click on the last row's checkbox actually lands on it — the
		// original bug made `elementFromPoint` resolve to `.ai-defaults` instead.
		const detail = page.locator('.ai-dialog__detail')
		await detail.evaluate((el) => el.scrollTo(0, el.scrollHeight))
		const lastRow = rows.last()
		const checkbox = lastRow.locator('td.ai-center input[type="checkbox"]').first()
		// Direct proof the checkbox (not an overlapping element) is what's actually hit-tested
		// at its own on-screen position — this is exactly how the original bug was confirmed.
		const hitsCheckbox = await checkbox.evaluate((el) => {
			const r = el.getBoundingClientRect()
			return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el
		})
		expect(hitsCheckbox).toBe(true)
		const wasChecked = await checkbox.isChecked()
		await checkbox.click() // no force: true — must be really reachable
		await expect(checkbox).toBeChecked({ checked: !wasChecked })
	})

	test('still clean at a cramped 900x560 (UI-11)', async ({ page }) => {
		await page.setViewportSize({ width: 900, height: 560 })
		await openProvidersDialog(page)
		await page.locator('.ai-dialog__list-item', { hasText: 'Many Models' }).click()
		const defaultsBox = await page.locator('.ai-defaults__title', { hasText: 'Default model for each job' }).boundingBox()
		const columnsBox = await page.locator('.ai-dialog__columns').boundingBox()
		if (defaultsBox && columnsBox) {
			expect(columnsBox.y + columnsBox.height).toBeLessThanOrEqual(defaultsBox.y + 1)
		}
	})
})

/** AI-05: "Rescan" POSTed with no body/Content-Type, which the server's own CSRF guard (every
 * /api/* POST/PUT must be application/json) rejected with a 415 — an unhandled promise
 * rejection, nothing shown, and the skill list never actually refreshed. */
test.describe('AI providers dialog: Skills Rescan', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('Rescan succeeds with no unhandled rejection, and reflects a real re-scan', async ({ page }) => {
		const pageErrors: string[] = []
		page.on('pageerror', (e) => pageErrors.push(String(e)))

		await openProvidersDialog(page)
		const rescanResponse = page.waitForResponse((res) => res.url().includes('/api/skills/rescan'))
		await page.getByRole('button', { name: 'Rescan' }).click()
		const response = await rescanResponse
		expect(response.status(), 'Rescan must not 415').toBe(200)
		await expect(page.getByRole('button', { name: 'Rescan' })).toBeEnabled()
		await expect(page.locator('.ai-status.is-error')).toHaveCount(0)
		expect(pageErrors, `unhandled rejections: ${pageErrors.join(', ')}`).toEqual([])
	})

	test('a failed rescan shows a message instead of failing silently (mocked 500)', async ({ page }) => {
		const pageErrors: string[] = []
		page.on('pageerror', (e) => pageErrors.push(String(e)))
		await openProvidersDialog(page)
		await page.route('**/api/skills/rescan', (route) => route.fulfill({ status: 500, json: { error: 'disk read failed' } }))
		await page.getByRole('button', { name: 'Rescan' }).click()
		await expect(page.locator('.ai-status.is-error')).toContainText('disk read failed')
		expect(pageErrors, `unhandled rejections: ${pageErrors.join(', ')}`).toEqual([])
	})
})

/** UI-02: the OpenRouter card's Model dropdown used to show a raw browser exception
 * ("Failed to execute 'json' on 'Response'...") as its own option text whenever the free-model
 * fetch failed. Mocked here — no real network. */
test.describe('OpenRouter free card: fetch failure shows a friendly error, not a raw exception', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('shows a friendly message and a working Retry, never the raw exception text', async ({ page }) => {
		// Every request fails identically (React 18 StrictMode double-invokes effects in dev,
		// so the automatic on-mount fetch can fire more than once) — malformed/non-JSON body,
		// exactly the shape that used to make `response.json()` throw a raw DOMException
		// straight into the dropdown.
		await page.route('**/api/hub/openrouter', (route) => route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' }))

		const id = await createNode(page, { type: 'openrouter', model: '' }, { x: 100, y: 100 })
		await zoomToFit(page)

		const card = nodeLocator(page, id)
		await expect(card).toContainText("Couldn't load free models")
		await expect(card).not.toContainText('Failed to execute')
		await expect(card).not.toContainText('DOMException')

		// Only the explicit Retry click gets a success response — decoupled from however many
		// times the mount effect itself fired.
		await page.unroute('**/api/hub/openrouter')
		await page.route('**/api/hub/openrouter', (route) => route.fulfill({ json: { models: [{ id: 'free/model-1', name: 'Free Model 1' }] } }))
		await card.getByRole('button', { name: 'Retry' }).click()
		// NodeSelect is a custom dropdown (not a native <select>) styled as a button showing its
		// current placeholder/value text — just confirm the card moved out of the error state.
		await expect(card).toContainText('Free models')
		await expect(card).not.toContainText("Couldn't load free models")
	})
})
