import { useRef } from 'react'
import { T, useEditor } from 'tldraw'
import { categoryOf } from '../../../../shared/nodeGroups'
import { asWebUrl } from '../../../../shared/webUrl'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEIGHT_PX, NODE_WIDTH_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { stopEvent } from './fields'
import {
	areAnyInputsOutOfDate,
	ExecutionResult,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	STOP_EXECUTION,
	updateNode,
} from './shared'

const mark = <span className="NodeShape-emoji">▤</span>
const MAX_UPLOAD_TEXT_BYTES = 1_000_000

function out(): ShapePort {
	return { id: 'output', x: NODE_WIDTH_PX, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' }
}

function info(shape: NodeShape, value: string | null, inputs: InfoValues): InfoValues {
	return { output: { value, isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate, dataType: 'text' } }
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
	const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
	const payload = (await response.json()) as Record<string, unknown>
	if (!response.ok) throw new Error(String(payload.error || response.statusText))
	return payload
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes)
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// File in: a local file, by upload or by path. Output is its text or its SHA-256.
// ---------------------------------------------------------------------------

export type FileInNode = T.TypeOf<typeof FileInNode>
export const FileInNode = T.object({
	type: T.literal('file_in'),
	/** upload: a file picked in the page. path: a file on the machine that runs the server. */
	mode: T.string,
	path: T.string,
	/** text or sha256 */
	action: T.string,
	fileName: T.string,
	/** Text of the uploaded file (up to 1 MB). */
	content: T.string,
	/** SHA-256 of the uploaded file, computed in the browser. */
	hash: T.string,
	lastText: T.string.nullable(),
	error: T.string.nullable(),
})

export class FileInNodeDefinition extends NodeDefinition<FileInNode> {
	static type = 'file_in'
	static validator = FileInNode
	title = 'File in'
	heading = 'File'
	icon = mark
	category = categoryOf('file_in')
	resultKeys = ['lastText', 'error'] as const
	getDefault(): FileInNode {
		return { type: 'file_in', mode: 'upload', path: '', action: 'text', fileName: '', content: '', hash: '', lastText: null, error: null }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 3 + 24
	}
	getPorts(): Record<string, ShapePort> {
		return { output: out() }
	}
	async execute(shape: NodeShape, node: FileInNode, _inputs: InputValues): Promise<ExecutionResult> {
		try {
			let text: string
			if (node.mode === 'path') {
				if (!node.path.trim()) throw new Error('Type a file path')
				const payload = await postJson('/api/file/read', { path: node.path.trim(), action: node.action })
				text = String(payload.output ?? '')
			} else {
				if (!node.fileName) throw new Error('Choose a file')
				text = node.action === 'sha256' ? node.hash : node.content
				if (!text) throw new Error('The file is empty or was not read. Choose it again.')
			}
			updateNode<FileInNode>(this.editor, shape, (n) => ({ ...n, lastText: text, error: null }), false)
			return { output: text }
		} catch (error) {
			updateNode<FileInNode>(this.editor, shape, (n) => ({ ...n, error: (error as Error).message }), false)
			return { output: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: FileInNode, inputs: InfoValues): InfoValues {
		return info(shape, node.lastText, inputs)
	}
	Component = FileInComponent
}

function FileInComponent({ shape, node }: NodeComponentProps<FileInNode>) {
	const editor = useEditor()
	const picker = useRef<HTMLInputElement>(null)
	const set = (patch: Partial<FileInNode>) => updateNode<FileInNode>(editor, shape, (n) => ({ ...n, ...patch }))
	const choose = async (file: File) => {
		const bytes = await file.arrayBuffer()
		const hash = await sha256Hex(bytes)
		// Only keep text that fits in the document. The hash always works.
		const tooBig = bytes.byteLength > MAX_UPLOAD_TEXT_BYTES
		const content = tooBig ? '' : new TextDecoder().decode(bytes)
		set({
			fileName: file.name,
			hash,
			content,
			error: tooBig && node.action === 'text' ? 'Over 1 MB: text is not kept. Use SHA-256, or the path mode.' : null,
		})
	}
	return (
		<>
			<NodeRow>
				<select className="NodeField-select" value={node.mode} onPointerDown={stopEvent} onChange={(e) => set({ mode: e.target.value })}>
					<option value="upload">Upload</option>
					<option value="path">Path on server</option>
				</select>
				<select className="NodeField-select" value={node.action} onPointerDown={stopEvent} onChange={(e) => set({ action: e.target.value })}>
					<option value="text">Text</option>
					<option value="sha256">SHA-256</option>
				</select>
			</NodeRow>
			<NodeRow>
				{node.mode === 'path' ? (
					<input className="NodeField-input" placeholder="/home/you/file.txt" value={node.path} onPointerDown={stopEvent} onKeyDown={stopEvent} onChange={(e) => set({ path: e.target.value })} />
				) : (
					<>
						<input
							ref={picker}
							type="file"
							hidden
							onChange={(e) => {
								const file = e.target.files?.[0]
								if (file) void choose(file)
								e.target.value = ''
							}}
						/>
						<button type="button" className="NodeField-button" onPointerDown={stopEvent} onClick={() => picker.current?.click()}>
							{node.fileName || 'Choose a file…'}
						</button>
					</>
				)}
			</NodeRow>
			{node.lastText && node.action === 'sha256' && <code className="NodeHint">{node.lastText}</code>}
			{node.error && (
				<NodeRow>
					<span className="NodeStatus is-error">{node.error}</span>
				</NodeRow>
			)}
		</>
	)
}

// ---------------------------------------------------------------------------
// URL in: an address, normalized. Optionally the fetched page text.
// ---------------------------------------------------------------------------

export type UrlInNode = T.TypeOf<typeof UrlInNode>
export const UrlInNode = T.object({
	type: T.literal('url_in'),
	url: T.string,
	/** Fetch the page and send its readable text instead of the address. */
	fetchBody: T.boolean,
	lastText: T.string.nullable(),
	error: T.string.nullable(),
})

export class UrlInNodeDefinition extends NodeDefinition<UrlInNode> {
	static type = 'url_in'
	static validator = UrlInNode
	title = 'URL in'
	heading = 'URL'
	icon = mark
	category = categoryOf('url_in')
	resultKeys = ['lastText', 'error'] as const
	getDefault(): UrlInNode {
		return { type: 'url_in', url: '', fetchBody: false, lastText: null, error: null }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 2
	}
	getPorts(): Record<string, ShapePort> {
		return { output: out() }
	}
	async execute(shape: NodeShape, node: UrlInNode, _inputs: InputValues): Promise<ExecutionResult> {
		try {
			const url = asWebUrl(node.url)
			if (!url) throw new Error('Type a web address, like www.example.com')
			let text = url
			if (node.fetchBody) {
				const payload = await postJson('/api/http', { url, extractText: true })
				text = String(payload.text ?? '')
			}
			updateNode<UrlInNode>(this.editor, shape, (n) => ({ ...n, lastText: text, error: null }), false)
			return { output: text }
		} catch (error) {
			updateNode<UrlInNode>(this.editor, shape, (n) => ({ ...n, error: (error as Error).message }), false)
			return { output: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: UrlInNode, inputs: InfoValues): InfoValues {
		return info(shape, node.lastText, inputs)
	}
	Component = UrlInComponent
}

function UrlInComponent({ shape, node }: NodeComponentProps<UrlInNode>) {
	const editor = useEditor()
	const set = (patch: Partial<UrlInNode>) => updateNode<UrlInNode>(editor, shape, (n) => ({ ...n, ...patch }))
	return (
		<>
			<NodeRow>
				<input className="NodeField-input" placeholder="www.wikipedia.org" value={node.url} onPointerDown={stopEvent} onKeyDown={stopEvent} onChange={(e) => set({ url: e.target.value })} />
			</NodeRow>
			<NodeRow>
				<label className="NodeField-check" onPointerDown={stopEvent}>
					<input type="checkbox" checked={node.fetchBody} onChange={(e) => set({ fetchBody: e.target.checked })} /> Fetch page text
				</label>
			</NodeRow>
			{node.error && (
				<NodeRow>
					<span className="NodeStatus is-error">{node.error}</span>
				</NodeRow>
			)}
		</>
	)
}
