import { expect, test } from '@playwright/test'
import { addCardFromLibrary, gotoApp, zoomToFit } from './helpers'

/**
 * UI-06: the "Load" button beside the Source URL field shared `flex: 1 1 auto` with the text
 * input, so it could shrink below its own label's width ("Load" → "L…"). Fixed in
 * `client/pipeline/index.css` (`.LoadImageNode-browse { flex: 0 0 auto }`). A lightweight
 * regression guard: the button's full label must stay readable.
 */
test.describe('Load image: the "Load" button never truncates', () => {
	test('shows the full label "Load", not "L…"', async ({ page }) => {
		await gotoApp(page)
		const id = await addCardFromLibrary(page, 'Load image')
		await zoomToFit(page)
		const button = page.locator(`[data-shape-id="${id}"]`).getByRole('button', { name: 'Load', exact: true })
		await expect(button).toBeVisible()
		await expect(button).toHaveText('Load')
	})
})
