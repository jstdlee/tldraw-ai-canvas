import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'ai-canvas-files-'))

describe('generic file store', () => {
	it('saves and reads back bytes, mime, and name', async () => {
		const { saveFile, readFile } = await import('../server/files')
		const bytes = new TextEncoder().encode('hello world')
		saveFile('abc123', bytes, 'text/plain', 'hi there.txt')
		const read = readFile('abc123')
		expect(read?.mime).toBe('text/plain')
		expect(read?.name).toBe('hi there.txt')
		expect(new TextDecoder().decode(read!.bytes)).toBe('hello world')
	})

	it('rejects an invalid file id', async () => {
		const { saveFile } = await import('../server/files')
		expect(() => saveFile('bad id!', new Uint8Array(), 'text/plain', 'x')).toThrow()
	})

	it('rejects a file over 50 MB', async () => {
		const { saveFile } = await import('../server/files')
		const big = new Uint8Array(50 * 1024 * 1024 + 1)
		expect(() => saveFile('toobig', big, 'application/octet-stream', 'big.bin')).toThrow(/50 MB/)
	})

	it('returns null for a missing file', async () => {
		const { readFile } = await import('../server/files')
		expect(readFile('doesnotexist')).toBeNull()
	})
})
