import {
	AssetRecordType,
	createShapeId,
	Editor,
	TLArrowBinding,
	TLArrowShape,
	TLShape,
	TLShapeId,
	toRichText,
} from 'tldraw'
import { detectContentKind } from '../../../shared/contentKind'
import { shapeText } from '../../clips/shapeText'
import { getNodePortConnections, getNodePorts } from '../nodes/nodePorts'
import { NodeShape } from '../nodes/NodeShapeUtil'
import { getNodeHeightPx } from '../nodes/nodeTypes'
import { PipelineValue, STOP_EXECUTION } from '../nodes/types/shared'
import { ShapePort } from '../ports/Port'

/**
 * Plain tldraw arrows work as wires between the canvas and nodes:
 *  - shape ──arrow──▶ node : the shape's text / image becomes a node input
 *  - node  ──arrow──▶ shape: the node's output is written into the shape
 *    (an arrow that ends on empty canvas creates a fitting shape there)
 */

function arrowBindings(editor: Editor, arrowId: TLShapeId) {
	const bindings = editor.getBindingsFromShape<TLArrowBinding>(arrowId, 'arrow')
	return {
		start: bindings.find((b) => b.props.terminal === 'start'),
		end: bindings.find((b) => b.props.terminal === 'end'),
	}
}

/** Pick the port nearest to where the arrow touches the node. */
function nearestPort(editor: Editor, node: NodeShape, terminal: 'start' | 'end', anchorY: number) {
	const ports = Object.values(getNodePorts(editor, node)).filter(
		(p): p is ShapePort => p.terminal === terminal && !p.feedback
	)
	if (!ports.length) return null
	const y = anchorY * getNodeHeightPx(editor, node)
	return ports.reduce((best, p) => (Math.abs(p.y - y) < Math.abs(best.y - y) ? p : best))
}

async function blobUrlToDataUrl(url: string) {
	const blob = await (await fetch(url)).blob()
	return new Promise<string>((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(reader.result as string)
		reader.onerror = () => reject(reader.error)
		reader.readAsDataURL(blob)
	})
}

/** The value a canvas shape gives to a node: image URL for images, text otherwise. */
export async function shapeValue(editor: Editor, shape: TLShape): Promise<string | null> {
	if (shape.type === 'image') {
		const assetId = (shape.props as { assetId?: TLArrowShape['id'] | null }).assetId as any
		if (!assetId) return null
		const asset = editor.getAsset(assetId)
		const src = (asset?.props as { src?: string } | undefined)?.src
		if (src && (src.startsWith('data:') || src.startsWith('/api/images/') || /^https?:/.test(src))) return src
		const url = await editor.resolveAssetUrl(assetId, { shouldResolveToOriginal: true })
		return url ? blobUrlToDataUrl(url) : null
	}
	if (shape.type === 'video') {
		const assetId = (shape.props as { assetId?: any }).assetId
		if (!assetId) return null
		const src = (editor.getAsset(assetId)?.props as { src?: string } | undefined)?.src
		if (src && /^(https?:|\/api\/)/.test(src)) return src
		// Kept in the browser: a blob: URL is enough to read frames on this page.
		return (await editor.resolveAssetUrl(assetId, { shouldResolveToOriginal: true })) ?? null
	}
	if (shape.type === 'bookmark') {
		return (shape.props as { url?: string }).url ?? null
	}
	const text = shapeText(editor, shape)
	return text || null
}

/** Inputs that arrive through tldraw arrows ending on this node. */
export async function getArrowInputs(editor: Editor, nodeId: TLShapeId): Promise<Record<string, PipelineValue>> {
	const node = editor.getShape<NodeShape>(nodeId)
	if (!node) return {}
	const wired = new Set(
		getNodePortConnections(editor, node)
			.filter((c) => c.terminal === 'end')
			.map((c) => c.ownPortId)
	)
	const result: Record<string, PipelineValue> = {}
	for (const binding of editor.getBindingsToShape<TLArrowBinding>(nodeId, 'arrow')) {
		if (binding.props.terminal !== 'end') continue
		const source = arrowBindings(editor, binding.fromId).start
		if (!source) continue
		const sourceShape = editor.getShape(source.toId)
		if (!sourceShape || sourceShape.type === 'node') continue
		const port = nearestPort(editor, node, 'end', binding.props.normalizedAnchor.y)
		if (!port || wired.has(port.id) || port.id in result) continue
		const value = await shapeValue(editor, sourceShape)
		if (value != null) result[port.id] = value
	}
	return result
}

/** Write node outputs into the shapes its tldraw arrows point at. */
export async function writeArrowOutputs(
	editor: Editor,
	nodeId: TLShapeId,
	outputs: Record<string, PipelineValue | typeof STOP_EXECUTION>
) {
	const node = editor.getShape<NodeShape>(nodeId)
	if (!node) return
	for (const binding of editor.getBindingsToShape<TLArrowBinding>(nodeId, 'arrow')) {
		if (binding.props.terminal !== 'start') continue
		const port = nearestPort(editor, node, 'start', binding.props.normalizedAnchor.y)
		const raw = port ? outputs[port.id] : Object.values(outputs).find((v) => v != null && v !== STOP_EXECUTION)
		if (raw == null || raw === STOP_EXECUTION) continue
		const value = String(raw)
		const arrow = editor.getShape<TLArrowShape>(binding.fromId)
		if (!arrow) continue
		const end = arrowBindings(editor, arrow.id).end
		const target = end ? editor.getShape(end.toId) : null
		if (target && target.type !== 'node') await writeValueIntoShape(editor, target, value)
		else if (!target) await createShapeAtArrowEnd(editor, arrow, value)
	}
}

async function imageSize(src: string): Promise<{ w: number; h: number }> {
	return new Promise((resolve) => {
		const img = new Image()
		img.onload = () => resolve({ w: img.naturalWidth || 512, h: img.naturalHeight || 512 })
		img.onerror = () => resolve({ w: 512, h: 512 })
		img.src = src
	})
}

async function writeValueIntoShape(editor: Editor, target: TLShape, value: string) {
	const kind = detectContentKind(value)
	const props = target.props as Record<string, unknown>
	if (target.type === 'image' && kind === 'image') {
		const { w, h } = await imageSize(value)
		const assetId = AssetRecordType.createId()
		editor.createAssets([
			{ id: assetId, typeName: 'asset', type: 'image', props: { src: value, w, h, mimeType: 'image/png', name: 'output', isAnimated: false }, meta: {} },
		])
		const shapeW = (props.w as number) ?? w
		editor.updateShape({ id: target.id, type: 'image', props: { assetId, h: Math.round((shapeW * h) / w), crop: null } })
	} else if (target.type === 'markdown') {
		editor.updateShape({ id: target.id, type: 'markdown', props: { md: value } })
	} else if (target.type === 'mermaid') {
		editor.updateShape({ id: target.id, type: 'mermaid', props: { code: value } })
	} else if ('richText' in props) {
		editor.updateShape({ id: target.id, type: target.type, props: { richText: toRichText(value) } } as any)
	}
}

async function createShapeAtArrowEnd(editor: Editor, arrow: TLArrowShape, value: string) {
	const point = editor.getShapePageTransform(arrow).applyToPoint(arrow.props.end)
	const kind = detectContentKind(value)
	const id = createShapeId()
	if (kind === 'image') {
		const { w, h } = await imageSize(value)
		const scale = Math.min(1, 360 / Math.max(w, h))
		const assetId = AssetRecordType.createId()
		editor.createAssets([
			{ id: assetId, typeName: 'asset', type: 'image', props: { src: value, w, h, mimeType: 'image/png', name: 'output', isAnimated: false }, meta: {} },
		])
		editor.createShape({ id, type: 'image', x: point.x, y: point.y - (h * scale) / 2, props: { assetId, w: w * scale, h: h * scale } })
	} else if (kind === 'mermaid') {
		editor.createShape({ id, type: 'mermaid', x: point.x, y: point.y - 150, props: { code: value } })
	} else if (kind === 'markdown' || kind === 'json' || value.length > 200 || value.includes('\n')) {
		const md = kind === 'json' ? '```json\n' + value + '\n```' : value
		editor.createShape({ id, type: 'markdown', x: point.x, y: point.y - 120, props: { w: 380, h: 260, md } })
	} else {
		editor.createShape({ id, type: 'text', x: point.x, y: point.y - 16, props: { richText: toRichText(value) } })
	}
	// Bind the arrow so the next run updates this shape instead of making a new one.
	editor.createBinding({
		type: 'arrow',
		fromId: arrow.id,
		toId: id,
		props: { terminal: 'end', normalizedAnchor: { x: 0, y: 0.5 }, isExact: false, isPrecise: false },
	} as any)
}
