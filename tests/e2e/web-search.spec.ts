import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, nodeProps, runNode, zoomToFit } from './helpers'

/**
 * WP24: the Web search card (Exa/Tavily/Brave). `/api/search` is mocked with `page.route` —
 * this suite never calls a real search API or needs a real key.
 */
test.describe('Web search card', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('runs, shows the result list, and fills every output', async ({ page }) => {
		await page.route('**/api/search', async (route) => {
			expect(route.request().method()).toBe('POST')
			const body = route.request().postDataJSON() as { provider: string; query: string; count: number }
			expect(body.provider).toBe('exa')
			expect(body.query).toBe('local-first software')
			expect(body.count).toBe(5)
			await route.fulfill({
				json: {
					provider: 'exa',
					ms: 42,
					results: [
						{ title: 'Local-first software', url: 'https://example.com/local-first', snippet: 'A short summary.' },
						{ title: 'Another result', url: 'https://example.org/post', snippet: 'Second snippet.' },
					],
				},
			})
		})

		const id = await createNode(
			page,
			{
				type: 'web_search',
				provider: 'exa',
				query: 'local-first software',
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

		const node = await nodeProps<{
			lastResultsJson: string | null
			lastAnswer: string | null
			error: string | null
		}>(page, id)
		expect(node.error).toBeNull()
		const results = JSON.parse(node.lastResultsJson ?? '[]')
		expect(results).toHaveLength(2)
		expect(results[0]).toMatchObject({ title: 'Local-first software', url: 'https://example.com/local-first' })

		const card = nodeLocator(page, id)
		await expect(card.locator('.WebSearchNode-result')).toHaveCount(2)
		await expect(card.getByText('Local-first software', { exact: true })).toBeVisible()
		await expect(card.getByText('example.com', { exact: true })).toBeVisible()
	})

	test('a provider error shows in the banner, not the key', async ({ page }) => {
		await page.route('**/api/search', async (route) => {
			await route.fulfill({ status: 400, json: { error: 'Exa 401: Unauthorized' } })
		})

		const id = await createNode(
			page,
			{
				type: 'web_search',
				provider: 'exa',
				query: 'local-first software',
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

		const card = nodeLocator(page, id)
		await expect(card.locator('.NodeStatus.is-error')).toContainText('Exa 401: Unauthorized')
	})
})
