import { expect, test } from '@playwright/test'
import { clickEmptyCanvas, gotoApp } from './helpers'

test('an area marked with "c" for the agent clears with Escape', async ({ page }) => {
	await gotoApp(page)
	await clickEmptyCanvas(page)
	await page.keyboard.press('c')
	const box = (await page.locator('.tl-canvas').boundingBox())!
	await page.mouse.move(box.x + 300, box.y + 200)
	await page.mouse.down()
	await page.mouse.move(box.x + 450, box.y + 320, { steps: 8 })
	await page.mouse.up()

	const marked = () =>
		page.evaluate(async () => {
			const editor = (window as any).editor
			const { AgentAppAgentsManager } = await import('/client/agent/managers/AgentAppAgentsManager.ts' as string)
			return AgentAppAgentsManager.getAgents(editor)
				.flatMap((agent: any) => agent.context.getItems())
				.filter((item: any) => item.type === 'area').length
		})
	await expect.poll(marked).toBeGreaterThan(0)
	await page.keyboard.press('Escape')
	await expect.poll(marked).toBe(0)
})
