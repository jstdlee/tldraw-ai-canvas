/**
 * A minimal, dependency-free ZIP writer (STORE method — no compression) for Gallery's
 * "Download all" (WP36 "P"). No npm package is named for this in the work package, and the repo
 * doesn't carry one — a stored-only ZIP is well within the standard and small enough to hand-roll.
 * Every mainstream unzip tool reads STORE entries; only the (optional) compression is skipped.
 */

export interface ZipEntry {
	name: string
	data: Uint8Array<ArrayBuffer>
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[n] = c
	}
	return table
})()

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff
	for (let i = 0; i < data.length; i++) {
		crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
	}
	return (crc ^ 0xffffffff) >>> 0
}

/** MS-DOS date/time (local time "now"), the format every ZIP header field uses. */
function dosDateTime(date = new Date()): { time: number; date: number } {
	const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f)
	const dosDate = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f)
	return { time, date: dosDate }
}

/** Builds a STORE-only ZIP archive from a list of entries, as a single Blob. */
export function buildZip(entries: ZipEntry[]): Blob {
	const { time, date } = dosDateTime()
	const chunks: Uint8Array<ArrayBuffer>[] = []
	const centralChunks: Uint8Array<ArrayBuffer>[] = []
	let offset = 0

	for (const entry of entries) {
		const nameBytes = new TextEncoder().encode(entry.name)
		const crc = crc32(entry.data)
		const size = entry.data.length

		const local = new DataView(new ArrayBuffer(30))
		local.setUint32(0, 0x04034b50, true)
		local.setUint16(4, 20, true) // version needed
		local.setUint16(6, 0, true) // flags
		local.setUint16(8, 0, true) // method: store
		local.setUint16(10, time, true)
		local.setUint16(12, date, true)
		local.setUint32(14, crc, true)
		local.setUint32(18, size, true) // compressed size
		local.setUint32(22, size, true) // uncompressed size
		local.setUint16(26, nameBytes.length, true)
		local.setUint16(28, 0, true) // extra length

		chunks.push(new Uint8Array(local.buffer), nameBytes, entry.data)

		const central = new DataView(new ArrayBuffer(46))
		central.setUint32(0, 0x02014b50, true)
		central.setUint16(4, 20, true) // version made by
		central.setUint16(6, 20, true) // version needed
		central.setUint16(8, 0, true) // flags
		central.setUint16(10, 0, true) // method: store
		central.setUint16(12, time, true)
		central.setUint16(14, date, true)
		central.setUint32(16, crc, true)
		central.setUint32(20, size, true)
		central.setUint32(24, size, true)
		central.setUint16(28, nameBytes.length, true)
		central.setUint16(30, 0, true) // extra length
		central.setUint16(32, 0, true) // comment length
		central.setUint16(34, 0, true) // disk number
		central.setUint16(36, 0, true) // internal attrs
		central.setUint32(38, 0, true) // external attrs
		central.setUint32(42, offset, true) // local header offset

		centralChunks.push(new Uint8Array(central.buffer), nameBytes)

		offset += local.buffer.byteLength + nameBytes.length + size
	}

	const centralStart = offset
	let centralSize = 0
	for (const chunk of centralChunks) centralSize += chunk.length

	const end = new DataView(new ArrayBuffer(22))
	end.setUint32(0, 0x06054b50, true)
	end.setUint16(4, 0, true) // disk number
	end.setUint16(6, 0, true) // disk with central dir
	end.setUint16(8, entries.length, true) // entries on this disk
	end.setUint16(10, entries.length, true) // total entries
	end.setUint32(12, centralSize, true)
	end.setUint32(16, centralStart, true)
	end.setUint16(20, 0, true) // comment length

	return new Blob([...chunks, ...centralChunks, new Uint8Array(end.buffer)], { type: 'application/zip' })
}
