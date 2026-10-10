/** Generic file store: upload any file, get back a /api/files/:id URL. Used by DataPipe (xls/xlsx/csv upload) and Database (.sqlite upload). */

function newFileId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16))
	return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function storeFile(file: File): Promise<{ url: string; name: string; size: number }> {
	const fileId = newFileId()
	const response = await fetch(`/api/files/${fileId}`, {
		method: 'POST',
		headers: {
			'Content-Type': file.type || 'application/octet-stream',
			'X-File-Name': encodeURIComponent(file.name),
		},
		body: await file.arrayBuffer(),
	})
	if (!response.ok) {
		const payload = await response.json().catch(() => ({ error: response.statusText }))
		throw new Error(String((payload as { error?: string }).error || response.statusText))
	}
	return { url: `/api/files/${fileId}`, name: file.name, size: file.size }
}

const bytesCache = new Map<string, Uint8Array>()

/** Load a stored file's bytes, cached in memory by URL. */
export async function loadFileBytes(url: string): Promise<Uint8Array> {
	const cached = bytesCache.get(url)
	if (cached) return cached
	const response = await fetch(url)
	if (!response.ok) throw new Error(`Failed to load file: ${response.status}`)
	const bytes = new Uint8Array(await response.arrayBuffer())
	bytesCache.set(url, bytes)
	return bytes
}
