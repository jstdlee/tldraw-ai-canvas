import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator } from './helpers'

test.describe('DataPipe formula column: live preview', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('shows a "= ..." preview line computed from the sample rows', async ({ page }) => {
		const id = await createNode(
			page,
			{
				type: 'table',
				text: 'name,amount\nAda,10\nLin,20\n',
				format: 'auto',
				op: 'formula',
				columns: '',
				column: '',
				as: '',
				expr: 'round(amount * 1.2, 1)',
				sep: ' ',
				pattern: '',
				with: '',
				name: 'bonus',
				error: null,
				source: 'inline',
			},
			{ x: 0, y: 0 }
		)

		const preview = nodeLocator(page, id).locator('.FormulaField-preview')
		await expect(preview).toBeVisible()
		await expect(preview).toHaveText('= 12.0, 24.0')
	})
})
