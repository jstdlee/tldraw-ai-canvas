import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigError, DATA_DIR } from './config'

/** Generic file store: any content type, served back at /api/files/:fileId. */
export const FILE_DIR = join(DATA_DIR, 'files')

export const MAX_FILE_BYTES = 50 * 1024 * 1024

export function isValidFileId(id: string) {
	return /^[A-Za-z0-9_-]{1,80}$/.test(id)
}

interface FileMeta {
	mime: string
	name: string
}

function binPath(fileId: string) {
	return join(FILE_DIR, `${fileId}.bin`)
}
function metaPath(fileId: string) {
	return join(FILE_DIR, `${fileId}.json`)
}

export function saveFile(fileId: string, bytes: Uint8Array, mime: string, name: string) {
	if (!isValidFileId(fileId)) throw new ConfigError('Invalid file id')
	if (bytes.byteLength > MAX_FILE_BYTES) throw new ConfigError('File is larger than 50 MB')
	mkdirSync(FILE_DIR, { recursive: true })
	writeFileSync(binPath(fileId), bytes)
	writeFileSync(metaPath(fileId), JSON.stringify({ mime: mime || 'application/octet-stream', name: name || fileId } satisfies FileMeta))
}

export function readFile(fileId: string): { bytes: Uint8Array; mime: string; name: string } | null {
	if (!isValidFileId(fileId)) return null
	if (!existsSync(binPath(fileId))) return null
	const bytes = readFileSync(binPath(fileId))
	let meta: FileMeta = { mime: 'application/octet-stream', name: fileId }
	try {
		meta = JSON.parse(readFileSync(metaPath(fileId), 'utf8'))
	} catch {
		// Missing or unreadable metadata: fall back to the default above.
	}
	return { bytes, mime: meta.mime, name: meta.name }
}
