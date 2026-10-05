/** Read an image or text from the clipboard. */

export async function readClipboard(): Promise<{ text?: string; imageUrl?: string }> {
	try {
		const items = await navigator.clipboard.read()
		for (const item of items) {
			const type = item.types.find((entry) => entry.startsWith('image/'))
			if (!type) continue
			const blob = await item.getType(type)
			const imageUrl = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader()
				reader.onload = () => resolve(String(reader.result))
				reader.onerror = () => reject(reader.error)
				reader.readAsDataURL(blob)
			})
			return { imageUrl }
		}
	} catch {
		// Some browsers only allow readText.
	}
	try {
		const text = await navigator.clipboard.readText()
		return text ? { text } : {}
	} catch {
		return {}
	}
}
