import { expect, test } from '@playwright/test'
import { addCardFromLibrary, gotoApp, nodeProps, selectShapes, zoomToFit } from './helpers'

/**
 * IMAGE-01: the Load image card's own placeholder promises "paste", but nothing in the app
 * handled a native `paste` ClipboardEvent — `client/clips/canvasFeatures.ts` now registers a
 * `'files'` external-content handler (tldraw routes every paste/drop through
 * `registerExternalContentHandler`) that puts a pasted image into the selected node's own image
 * field instead of (or in addition to, when nothing is selected) tldraw's normal
 * "drop files on the canvas" behavior.
 */
test.describe('Ctrl+V pastes an image into the selected Load image card', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('a pasted clipboard image file lands in imageUrl as a data URL', async ({ page }) => {
		const id = await addCardFromLibrary(page, 'Load image')
		await zoomToFit(page)
		await selectShapes(page, [id])

		await page.evaluate(async () => {
			const res = await fetch('/examples/girl-base.jpg')
			const blob = await res.blob()
			const file = new File([blob], 'pasted.jpg', { type: 'image/jpeg' })
			const dt = new DataTransfer()
			dt.items.add(file)
			const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })
			document.activeElement?.dispatchEvent(ev) ?? document.dispatchEvent(ev)
		})

		await expect.poll(async () => (await nodeProps<{ imageUrl: string | null }>(page, id)).imageUrl).not.toBeNull()
		const props = await nodeProps<{ imageUrl: string }>(page, id)
		expect(props.imageUrl).toMatch(/^data:image\//)
	})
})
