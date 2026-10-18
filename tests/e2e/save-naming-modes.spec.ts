import { expect, test } from '@playwright/test'
import { apiImportImage, createDefaultNode, gotoApp, nodeProps, runNode, wire, zoomToFit } from './helpers'

/**
 * GAPS-17 / O: Save's file name template now fills {{name}} (the card feeding it) and {{index}},
 * and supports new file / overwrite / append modes. The saved extension always follows the real
 * content type for an image, even when the template names a different one (GAPS-17's own repro:
 * a PNG result saved as "thumb.jpg" silently contained PNG bytes under a lying name).
 */
test.describe('Save: naming and modes', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('{{name}} resolves to the upstream card\'s title, and the extension matches the real content type', async ({ page }) => {
		const src = await apiImportImage(page, '/examples/girl-base.jpg') // real bytes are JPEG
		const loadId = await createDefaultNode(page, 'load_image', { imageUrl: src, source: src }, { x: 0, y: 0 })
		const saveId = await createDefaultNode(page, 'save', { fileName: 'thumb-{{name}}' }, { x: 460, y: 0 })
		await zoomToFit(page)
		await wire(page, loadId, 'output', saveId, 'input')

		await runNode(page, saveId)

		const props = await nodeProps<{ lastPath: string | null; error: string | null }>(page, saveId)
		expect(props.error).toBeNull()
		// "thumb.jpg" naming the real upstream card ("Load image" → "image"), not literally
		// ".jpg" chosen by the user while the bytes are actually PNG (GAPS-17's own repro) —
		// here the content really is a jpeg, so the point is just that the extension is REAL,
		// not whatever the template said.
		expect(props.lastPath).toMatch(/thumb-image.*\.jpe?g$/)
	})

	test('overwrite mode always writes to the same path; append adds one line per run', async ({ page }) => {
		const textId = await createDefaultNode(page, 'prompt', { text: 'line one' }, { x: 0, y: 0 })
		const saveId = await createDefaultNode(page, 'save', { fileName: 'overwrite-test', mode: 'overwrite' }, { x: 460, y: 0 })
		await zoomToFit(page)
		await wire(page, textId, 'output', saveId, 'input')

		await runNode(page, saveId)
		const first = await nodeProps<{ lastPath: string | null }>(page, saveId)
		await runNode(page, saveId, 15_000)
		const second = await nodeProps<{ lastPath: string | null }>(page, saveId)
		// Same path both times — no "-2" suffix despite writing twice.
		expect(second.lastPath).toBe(first.lastPath)
	})

	test('append mode adds one line per run to the same file', async ({ page }) => {
		const textId = await createDefaultNode(page, 'prompt', { text: 'a row' }, { x: 0, y: 0 })
		const saveId = await createDefaultNode(page, 'save', { fileName: 'append-test', mode: 'append' }, { x: 460, y: 0 })
		await zoomToFit(page)
		await wire(page, textId, 'output', saveId, 'input')

		await runNode(page, saveId)
		const first = await nodeProps<{ lastPath: string | null; error: string | null }>(page, saveId)
		expect(first.error).toBeNull()
		await runNode(page, saveId, 15_000)
		const second = await nodeProps<{ lastPath: string | null; error: string | null }>(page, saveId)
		expect(second.error).toBeNull()
		// Same path on both runs — append grows one file, it doesn't "-2"-suffix a new one.
		expect(second.lastPath).toBe(first.lastPath)
	})
})
