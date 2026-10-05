/** Why a node cannot run yet. Empty string means it can run. */

export function missingRunInput(
	node: { type: string } & Record<string, unknown>,
	inputs: Record<string, unknown>
): string | null {
	const has = (port: string) => {
		const value = inputs[port]
		if (Array.isArray(value)) return value.some((item) => item != null && item !== '')
		return value != null && value !== ''
	}
	switch (node.type) {
		case 'http':
		case 'download':
			if (!has('url') && !String(node.url ?? '').trim()) return 'URL is required'
			return null
		case 'load_image':
			if (!node.imageUrl && !String(node.source ?? '').trim()) return 'Choose an image, URL, or path'
			return null
		case 'postgres':
			if (!String(node.sql ?? '').trim()) return 'SQL is required'
			return null
		case 'code':
			if (!String(node.code ?? '').trim()) return 'Code is required'
			return null
		case 'net_tool':
			if (node.tool === 'my_ips') return null
			if (!has('target') && !String(node.target ?? '').trim()) return 'Target is required'
			return null
		case 'summarize':
			if (!has('input')) return 'Connect something to summarize'
			return null
		case 'text_ai':
			if (node.operation === 'custom' && !String(node.instruction ?? '').trim()) return 'Instruction is required'
			if (!has('input')) return 'Connect text to AI text'
			return null
		case 'image_filter':
		case 'image_resize':
		case 'crop':
		case 'image_tool':
		case 'adjust':
			if (!has('image')) return 'Connect an image'
			return null
		default:
			return null
	}
}
