/** Where a paste (text or image) lands on a node. */

export function pastePatch(
	node: { type: string } & Record<string, unknown>,
	data: { text?: string; imageUrl?: string }
): Record<string, unknown> | null {
	const text = data.text?.trim()
	const imageUrl = data.imageUrl
	switch (node.type) {
		case 'load_image':
			if (imageUrl) return { imageUrl, source: '' }
			if (text) return { source: text }
			return null
		case 'prompt':
			return text ? { text } : null
		case 'http':
			if (!text) return null
			return /^https?:\/\//i.test(text) ? { url: text } : { body: text }
		case 'download':
			return text ? { url: text } : null
		case 'code':
			if (!text) return null
			return { code: text.endsWith('\n') ? text : `${text}\n` }
		case 'postgres':
			return text ? { sql: text } : null
		case 'text_ai':
			return text ? { instruction: text } : null
		case 'text_tool':
			return text ? { a: text } : null
		case 'generate_text':
		case 'chat':
		case 'summarize':
			return text ? { system: text } : null
		case 'net_tool':
			return text ? { target: text } : null
		case 'output':
			return null
		default:
			if (imageUrl && 'imageUrl' in node) return { imageUrl }
			if (text && typeof node.text === 'string') return { text }
			if (text && typeof node.sql === 'string') return { sql: text }
			if (text && typeof node.code === 'string') return { code: text }
			return null
	}
}
