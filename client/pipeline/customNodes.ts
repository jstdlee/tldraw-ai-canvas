import { atom, createBindingId, createShapeId, Editor, TLBinding, TLShape, TLShapeId, VecModel } from 'tldraw'
import { NodeShape } from './nodes/NodeShapeUtil'
import type { SubgraphNode } from './nodes/types/SubgraphNode'

/**
 * Custom nodes: a packed group saved under a name, so it can be added to any
 * canvas again. The template holds the inner shapes, the wires between them
 * and the outer ports; ids are replaced with fresh ones on every use.
 */

export interface CustomNodeTemplate {
	version: 1
	proxy: SubgraphNode
	shapes: TLShape[]
	bindings: TLBinding[]
}

export interface CustomNodeMeta {
	id: string
	name: string
	description: string
	savedAt: string
}

export const $customNodes = atom<CustomNodeMeta[]>('custom nodes', [])

async function readJson<T>(res: Response): Promise<T> {
	const data = await res.json().catch(() => ({ error: res.statusText }))
	if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
	return data as T
}

export async function refreshCustomNodes() {
	try {
		$customNodes.set((await readJson<{ nodes: CustomNodeMeta[] }>(await fetch('/api/custom-nodes'))).nodes)
	} catch {
		// Server not reachable: the list stays as it is.
	}
}

async function toDataUrl(url: string | null): Promise<string | null> {
	if (!url || url.startsWith('data:')) return url
	try {
		const blob = await (await fetch(url)).blob()
		return await new Promise((resolve) => {
			const r = new FileReader()
			r.onload = () => resolve(r.result as string)
			r.onerror = () => resolve(null)
			r.readAsDataURL(blob)
		})
	} catch {
		return null
	}
}

/** Build a template from a packed node on the canvas. */
export async function templateFromPacked(editor: Editor, proxyId: TLShapeId): Promise<CustomNodeTemplate> {
	const proxy = editor.getShape<NodeShape>(proxyId)
	if (!proxy || proxy.props.node.type !== 'subgraph') throw new Error('Select a packed node (right-click → Pack into one node)')
	const node = structuredClone(proxy.props.node as SubgraphNode)
	const inner = new Set(node.innerIds as TLShapeId[])
	const shapes = [...inner].map((id) => editor.getShape(id)).filter((s): s is TLShape => !!s)
	const bindings: TLBinding[] = []
	for (const s of shapes) {
		for (const b of editor.getBindingsFromShape(s.id, 'connection')) {
			if (inner.has(b.toId)) bindings.push(structuredClone(b))
		}
	}
	// Embed the thumbnail so the node file works on another machine too.
	node.thumbnail = await toDataUrl(node.thumbnail)
	node.lastOutputs = null
	node.error = null
	return { version: 1, proxy: node, shapes: structuredClone(shapes), bindings }
}

/** Add a saved node to the canvas (top-left at `point`). Returns the packed node's id. */
export function instantiateTemplate(editor: Editor, template: CustomNodeTemplate, point: VecModel, title?: string): TLShapeId {
	const ids = new Map<string, TLShapeId>()
	for (const s of template.shapes) ids.set(s.id, createShapeId())
	const proxyId = createShapeId()
	const minX = Math.min(...template.shapes.map((s) => s.x))
	const minY = Math.min(...template.shapes.map((s) => s.y))
	const pageId = editor.getCurrentPageId()
	const map = (id: string) => ids.get(id) ?? (id as TLShapeId)

	const proxy: SubgraphNode = {
		...structuredClone(template.proxy),
		title: title ?? template.proxy.title,
		innerIds: template.shapes.map((s) => map(s.id)),
		inputs: template.proxy.inputs.map((p) => ({ ...p, nodeId: map(p.nodeId) })),
		outputs: template.proxy.outputs.map((p) => ({ ...p, nodeId: map(p.nodeId) })),
		lastOutputs: null,
		error: null,
	}

	editor.run(() => {
		editor.markHistoryStoppingPoint('add custom node')
		editor.createShapes(
			template.shapes.map((s) => ({
				...structuredClone(s),
				id: map(s.id),
				parentId: pageId,
				x: s.x - minX + point.x,
				y: s.y - minY + point.y,
				meta: { ...s.meta, packedIn: proxyId },
			}))
		)
		editor.createBindings(
			template.bindings.map((b) => ({
				...structuredClone(b),
				id: createBindingId(),
				fromId: map(b.fromId),
				toId: map(b.toId),
			}))
		)
		editor.createShape({ id: proxyId, type: 'node', x: point.x, y: point.y, props: { node: proxy, isOutOfDate: true } })
		editor.select(proxyId)
	})
	return proxyId
}

export async function saveCustomNode(editor: Editor, proxyId: TLShapeId, name: string, description = '') {
	const template = await templateFromPacked(editor, proxyId)
	template.proxy.title = name
	const saved = await readJson<CustomNodeMeta>(
		await fetch('/api/custom-nodes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, description, template }),
		})
	)
	editor.updateShape<NodeShape>({
		id: proxyId,
		type: 'node',
		props: { node: { ...(editor.getShape<NodeShape>(proxyId)!.props.node as SubgraphNode), title: name } },
	})
	await refreshCustomNodes()
	return saved
}

export async function addCustomNodeToCanvas(editor: Editor, id: string, point?: VecModel) {
	const file = await readJson<CustomNodeMeta & { template: CustomNodeTemplate }>(await fetch(`/api/custom-nodes/${id}`))
	const at = point ?? editor.getViewportPageBounds().center
	return instantiateTemplate(editor, file.template, at, file.name)
}

export async function deleteCustomNode(id: string) {
	await readJson(await fetch(`/api/custom-nodes/${id}`, { method: 'DELETE' }))
	await refreshCustomNodes()
}

// ---------------------------------------------------------------------------
// Files: export / import a custom node, save / open the whole canvas
// ---------------------------------------------------------------------------

function download(name: string, text: string) {
	const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
	const a = document.createElement('a')
	a.href = url
	a.download = name
	document.body.appendChild(a)
	a.click()
	a.remove()
	URL.revokeObjectURL(url)
}

function pickFile(): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement('input')
		input.type = 'file'
		input.accept = '.json,application/json'
		input.onchange = () => resolve(input.files?.[0] ?? null)
		input.click()
	})
}

export async function exportCustomNodeFile(editor: Editor, proxyId: TLShapeId) {
	const template = await templateFromPacked(editor, proxyId)
	const name = template.proxy.title || 'custom-node'
	download(`${name.replace(/[^\w-]+/g, '-')}.node.json`, JSON.stringify({ kind: 'ai-canvas-node', name, template }, null, '\t'))
}

/** Import a node file into the library and put it on the canvas. */
export async function importCustomNodeFile(editor: Editor) {
	const file = await pickFile()
	if (!file) return null
	const data = JSON.parse(await file.text()) as { kind?: string; name?: string; template?: CustomNodeTemplate }
	if (data.kind !== 'ai-canvas-node' || !data.template) throw new Error('Not a node file (.node.json)')
	const name = data.name || file.name.replace(/\.node\.json$|\.json$/, '')
	await readJson(
		await fetch('/api/custom-nodes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, template: data.template }),
		})
	)
	await refreshCustomNodes()
	return instantiateTemplate(editor, data.template, editor.getViewportPageBounds().center, name)
}

export function saveCanvasFile(editor: Editor) {
	const snapshot = editor.getSnapshot()
	const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
	download(`canvas-${stamp}.canvas.json`, JSON.stringify({ kind: 'ai-canvas', version: 1, snapshot }))
}

export async function openCanvasFile(editor: Editor) {
	const file = await pickFile()
	if (!file) return false
	const data = JSON.parse(await file.text())
	const snapshot = data.kind === 'ai-canvas' ? data.snapshot : data
	if (!snapshot?.document) throw new Error('Not a canvas file')
	editor.loadSnapshot(snapshot)
	return true
}
