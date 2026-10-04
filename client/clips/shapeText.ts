import { Editor, renderPlaintextFromRichText, TLAsset, TLShape } from 'tldraw'

/** Plain text of one shape (text, note, geo label, arrow label, clips, nodes). */
export function shapeText(editor: Editor, shape: TLShape): string {
	const props = shape.props as Record<string, any>
	if (props.richText) return renderPlaintextFromRichText(editor, props.richText)
	if (shape.type === 'markdown') return props.md ?? ''
	if (shape.type === 'mermaid') return props.code ?? ''
	if (shape.type === 'bookmark') {
		const asset = props.assetId ? (editor.getAsset(props.assetId) as TLAsset | undefined) : undefined
		const p = asset?.props as Record<string, string> | undefined
		return [p?.title, p?.description, props.url].filter(Boolean).join('\n')
	}
	if (shape.type === 'node') {
		const node = props.node ?? {}
		return [node.text, node.userMessage, node.assistantMessage, node.lastResultText, node.lastText]
			.filter((v) => typeof v === 'string' && v)
			.join('\n')
	}
	return ''
}
