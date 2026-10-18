import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A 1x1 transparent PNG, as a data URL — real enough for resolveImage's header-only parsing.
const PNG_DATA_URL =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('saveContent (GAPS-17 / O)', () => {
	// server/http.ts reads DATA_DIR once, at module load, into its own EXPORT_DIR constant — a
	// fresh temp dir per test needs a fresh module instance (vi.resetModules()) to actually take
	// effect, or every test in this file would share one directory and its leftover files.
	beforeEach(() => {
		vi.resetModules()
		process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'ai-canvas-save-'))
	})

	it('a mismatched user-chosen extension is replaced by the real content type for an image', async () => {
		const { saveContent, EXPORT_DIR } = await import('../server/http')
		const r = await saveContent(PNG_DATA_URL, 'thumb.jpg')
		expect(r.path.endsWith('.png')).toBe(true)
		expect(r.path).toContain(EXPORT_DIR)
		expect(existsSync(r.path)).toBe(true)
	})

	it('fills {{name}}, {{date}}, {{index}} in the file name', async () => {
		const { saveContent } = await import('../server/http')
		const r = await saveContent('hello', '{{name}}-{{index}}', { name: 'crop' })
		expect(r.path).toMatch(/crop-1\.txt$/)
	})

	it('"new" mode suffixes a colliding name ("-2"), matching the old behavior for a plain template', async () => {
		const { saveContent } = await import('../server/http')
		const a = await saveContent('one', 'thumb')
		const b = await saveContent('two', 'thumb')
		expect(a.path).not.toBe(b.path)
		expect(b.path).toMatch(/thumb-2\.txt$/)
	})

	it('"new" mode with an explicit {{index}} finds the first free slot instead of suffixing', async () => {
		const { saveContent } = await import('../server/http')
		const a = await saveContent('one', 'thumb-{{index}}')
		const b = await saveContent('two', 'thumb-{{index}}')
		expect(a.path).toMatch(/thumb-1\.txt$/)
		expect(b.path).toMatch(/thumb-2\.txt$/)
	})

	it('"overwrite" mode always writes the same path', async () => {
		const { saveContent } = await import('../server/http')
		const a = await saveContent('one', 'fixed', { mode: 'overwrite' })
		const b = await saveContent('two', 'fixed', { mode: 'overwrite' })
		expect(a.path).toBe(b.path)
		expect(readFileSync(b.path, 'utf8')).toBe('two')
	})

	it('"append" mode adds one line per run to the same file', async () => {
		const { saveContent } = await import('../server/http')
		const a = await saveContent('line one', 'log', { mode: 'append' })
		const b = await saveContent('line two', 'log', { mode: 'append' })
		expect(a.path).toBe(b.path)
		expect(readFileSync(b.path, 'utf8')).toBe('line one\nline two')
	})
})
