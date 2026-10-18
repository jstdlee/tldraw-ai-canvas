import { describe, expect, it } from 'vitest'
import { buildZip } from '../client/pipeline/utils/zip'

/** A tiny STORE-only ZIP reader, just enough to round-trip what `buildZip` writes — the point is
 * to prove the bytes `buildZip` emits are structurally a real ZIP, not to build a general parser. */
function readStoredZip(buf: Uint8Array): { name: string; data: Uint8Array }[] {
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
	const entries: { name: string; data: Uint8Array }[] = []
	let offset = 0
	while (offset < buf.length && view.getUint32(offset, true) === 0x04034b50) {
		const nameLen = view.getUint16(offset + 26, true)
		const extraLen = view.getUint16(offset + 28, true)
		const size = view.getUint32(offset + 18, true)
		const nameStart = offset + 30
		const name = new TextDecoder().decode(buf.slice(nameStart, nameStart + nameLen))
		const dataStart = nameStart + nameLen + extraLen
		const data = buf.slice(dataStart, dataStart + size)
		entries.push({ name, data })
		offset = dataStart + size
	}
	return entries
}

describe('buildZip (Gallery "Download all")', () => {
	it('round-trips entry names and bytes', async () => {
		const a = new TextEncoder().encode('hello world')
		const b = new TextEncoder().encode('{"ok":true}')
		const blob = buildZip([
			{ name: '1-photo.png', data: a },
			{ name: '2-photo.json', data: b },
		])
		expect(blob.type).toBe('application/zip')
		const buf = new Uint8Array(await blob.arrayBuffer())

		// End-of-central-directory signature must be present near the tail.
		const tail = new DataView(buf.buffer, buf.byteOffset + buf.length - 22, 22)
		expect(tail.getUint32(0, true)).toBe(0x06054b50)
		expect(tail.getUint16(8, true)).toBe(2) // entry count

		const entries = readStoredZip(buf)
		expect(entries).toHaveLength(2)
		expect(entries[0].name).toBe('1-photo.png')
		expect(new TextDecoder().decode(entries[0].data)).toBe('hello world')
		expect(entries[1].name).toBe('2-photo.json')
		expect(new TextDecoder().decode(entries[1].data)).toBe('{"ok":true}')
	})

	it('builds an empty archive without throwing', async () => {
		const blob = buildZip([])
		const buf = new Uint8Array(await blob.arrayBuffer())
		expect(buf.length).toBe(22) // just the EOCD record
	})
})
