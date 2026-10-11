import { useRef, useState } from 'react'
import { T, useEditor } from 'tldraw'
import { detectFileKind } from '../../../../shared/fileKind'
import { categoryOf } from '../../../../shared/nodeGroups'
import { parseTable } from '../../../../shared/tableOps'
import { asWebUrl } from '../../../../shared/webUrl'
import { readSpreadsheet } from '../../excel'
import { loadFileBytes, storeFile } from '../../fileStore'
import { apiImportImage, apiProbeImage } from '../../api/pipelineApi'
import { storeBlob } from '../../imageOps'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_IMAGE_PREVIEW_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_WIDTH_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { UiButton, UiCheckbox, UiEmpty, UiSegmented, UiTable, UiTextInput } from '../../../ui'
import { FieldMax, ImageZoom } from '../../editors/LargeEditor'
import { isImageValue, PortRow, stopEvent, NodeSelect, useInputConnected, WireField } from './fields'
import {
	areAnyInputsOutOfDate,
	ExecutionResult,
	getInputText,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeImage,
	NodeRow,
	STOP_EXECUTION,
	updateNode,
} from './shared'

const mark = <span className="NodeShape-emoji">▤</span>

function out(): ShapePort {
	return { id: 'output', x: NODE_WIDTH_PX, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'any' }
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
	const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
	const payload = (await response.json()) as Record<string, unknown>
	if (!response.ok) throw new Error(String(payload.error || response.statusText))
	return payload
}

async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes as ArrayBuffer)
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function sheetNames(node: { sheets?: string }): string[] {
	if (!node.sheets) return []
	try {
		const parsed = JSON.parse(node.sheets)
		return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : []
	} catch {
		return []
	}
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Read from (was "File in" + "URL in"): upload a file, or read a URL.
// ---------------------------------------------------------------------------

export type FileInNode = T.TypeOf<typeof FileInNode>
export const FileInNode = T.object({
	type: T.literal('file_in'),
	/** Legacy: 'upload' | 'path'. 'path' canvases show a removal note. */
	mode: T.string,
	/** Legacy: a server-side path. No longer read. */
	path: T.string,
	/** 'text' or 'sha256': output the content, or its SHA-256 hash. */
	action: T.string,
	fileName: T.string,
	/** Legacy: text of an uploaded file read entirely in the browser (pre-WP9, &lt;1 MB only). */
	content: T.string,
	/** Legacy: SHA-256 of that old-style upload. */
	hash: T.string,
	lastText: T.string.nullable(),
	error: T.string.nullable(),
	/** 'upload' | 'url'. Defaults to 'upload' when unset (older canvases). */
	source: T.string.optional(),
	url: T.string.optional(),
	/** File-store URL (new uploads go through /api/files, not inlined into the doc). */
	fileUrl: T.string.optional(),
	fileType: T.string.optional(),
	fileSize: T.number.optional(),
	/** 'auto' | 'text' | 'pagetext', for URL mode. */
	asText: T.string.optional(),
	/** Chosen sheet for an uploaded xls/xlsx/ods, and the sheet names found in it (JSON array). */
	sheet: T.string.optional(),
	sheets: T.string.optional(),
	/** The last output was an image URL, not text. */
	isImageOutput: T.boolean.optional(),
})

export class FileInNodeDefinition extends NodeDefinition<FileInNode> {
	static type = 'file_in'
	static validator = FileInNode
	title = 'Read from'
	heading = 'Read from'
	icon = mark
	category = categoryOf('file_in')
	override showsOutput = true
	resultKeys = ['lastText', 'error', 'isImageOutput'] as const
	getDefault(): FileInNode {
		return {
			type: 'file_in',
			mode: 'upload',
			path: '',
			action: 'text',
			fileName: '',
			content: '',
			hash: '',
			lastText: null,
			error: null,
			source: 'upload',
			url: '',
			fileUrl: '',
			fileType: '',
			fileSize: 0,
			asText: 'auto',
			sheet: '',
			sheets: '',
			isImageOutput: false,
		}
	}
	getBodyHeightPx(shape: NodeShape, node: FileInNode) {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		if (node.mode === 'path') return rowPx * 2
		const source = node.source ?? 'upload'
		let rows = 2 // segmented control + main row
		if (source === 'upload') {
			rows += 1 // "output SHA-256 instead" row
			if (sheetNames(node).length > 1) rows += 1 // sheet picker
		} else {
			rows += 1 // "as text" row
		}
		return rowPx * rows + NODE_IMAGE_PREVIEW_HEIGHT_PX
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		return {
			url: { id: 'url', x: 0, y: NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX + getNodeRowHeightPx(shape.props.fontSize) * 0.5, terminal: 'end', dataType: 'text' },
			output: out(),
		}
	}
	async execute(shape: NodeShape, node: FileInNode, inputs: InputValues): Promise<ExecutionResult> {
		try {
			if (node.mode === 'path') {
				throw new Error('Reading files from the server was removed. Upload the file or use a URL.')
			}
			const source = node.source ?? 'upload'
			const hashOutput = node.action === 'sha256'
			let text: string
			let isImage = false
			if (source === 'url') {
				const fromPort = getInputText(inputs, 'url').trim()
				const raw = fromPort || (node.url ?? '').trim()
				const url = asWebUrl(raw)
				if (!url) throw new Error('Type a web address, like www.example.com')
				const probe = await apiProbeImage(url).catch(() => ({ isImage: false }))
				if (probe.isImage) {
					text = await apiImportImage(url)
					isImage = true
				} else {
					const asText = node.asText ?? 'auto'
					const payload = await postJson('/api/http', { url, extractText: asText !== 'text' })
					const body = String(payload.text ?? '')
					text = hashOutput ? await sha256Hex(new TextEncoder().encode(body)) : body
				}
			} else if (node.fileUrl) {
				const bytes = await loadFileBytes(node.fileUrl)
				if (hashOutput) {
					text = await sha256Hex(bytes)
				} else {
					const kind = detectFileKind(node.fileName, node.fileType ?? '')
					if (kind === 'image') {
						text = await storeBlob(new Blob([bytes as BlobPart], { type: node.fileType || 'image/png' }))
						isImage = true
					} else if (kind === 'sheet') {
						const file = await readSpreadsheet(bytes, node.fileName)
						const names = sheetNames(node)
						const sheet = node.sheet && names.includes(node.sheet) ? node.sheet : (names[0] ?? file.sheets[0])
						text = file.toCsv(sheet)
					} else if (kind === 'text') {
						text = new TextDecoder('utf-8').decode(bytes)
					} else {
						text = `${node.fileUrl}\n(binary file, ${formatBytes(node.fileSize ?? bytes.length)} — open the link to download it)`
					}
				}
			} else if (node.content || node.hash) {
				// Pre-WP9 canvases: the file was read entirely in the browser; nothing is stored server-side.
				text = hashOutput ? node.hash : node.content
				if (!text) throw new Error('The file is empty or was not read. Choose it again.')
			} else {
				throw new Error('Choose a file')
			}
			updateNode<FileInNode>(this.editor, shape, (n) => ({ ...n, lastText: text, error: null, isImageOutput: isImage }), false)
			return { output: text }
		} catch (error) {
			updateNode<FileInNode>(this.editor, shape, (n) => ({ ...n, error: (error as Error).message }), false)
			return { output: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: FileInNode, inputs: InfoValues): InfoValues {
		return {
			output: {
				value: node.lastText,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: node.isImageOutput ? 'image' : 'text',
			},
		}
	}
	Component = FileInComponent
}

function FileInComponent({ shape, node }: NodeComponentProps<FileInNode>) {
	const editor = useEditor()
	const picker = useRef<HTMLInputElement>(null)
	const [busy, setBusy] = useState(false)
	const urlWired = useInputConnected(shape.id, 'url')
	const set = (patch: Partial<FileInNode>) => updateNode<FileInNode>(editor, shape, (n) => ({ ...n, ...patch }))

	if (node.mode === 'path') {
		return <UiEmpty text="Reading files from the server was removed. Upload the file or use a URL." />
	}

	const source = node.source ?? 'upload'
	const hashOutput = node.action === 'sha256'
	const names = sheetNames(node)

	const choose = async (file: File) => {
		setBusy(true)
		try {
			if (file.size > 50 * 1024 * 1024) throw new Error('Over 50 MB: choose a smaller file')
			const stored = await storeFile(file)
			const kind = detectFileKind(file.name, file.type)
			let sheets = ''
			let sheet = ''
			if (kind === 'sheet') {
				const bytes = await loadFileBytes(stored.url)
				const read = await readSpreadsheet(bytes, file.name)
				sheets = JSON.stringify(read.sheets)
				sheet = read.sheets[0] ?? ''
			}
			set({
				fileUrl: stored.url,
				fileName: file.name,
				fileType: file.type,
				fileSize: file.size,
				sheets,
				sheet,
				source: 'upload',
				error: null,
			})
		} catch (e) {
			set({ error: (e as Error).message })
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<WireField shapeId={shape.id} fieldKey="source" label="Source">
				<UiSegmented
					value={source}
					options={[
						{ value: 'upload', label: 'Upload' },
						{ value: 'url', label: 'URL' },
					]}
					onChange={(next) => set({ source: next })}
				/>
			</WireField>
			{source === 'upload' ? (
				<>
					<NodeRow>
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
						<UiButton
							size="sm"
							variant="low"
							disabled={busy}
							label={busy ? 'Reading…' : node.fileName ? `${node.fileName} (${formatBytes(node.fileSize ?? 0)})` : 'Choose a file…'}
							onClick={() => picker.current?.click()}
						/>
						{node.fileName && (
							<UiButton
								size="sm"
								variant="low"
								label="Clear"
								onClick={() => set({ fileUrl: '', fileName: '', fileType: '', fileSize: 0, sheets: '', sheet: '', content: '', hash: '', lastText: null, error: null })}
							/>
						)}
					</NodeRow>
					{names.length > 1 && (
						<NodeRow>
							<span className="NodeInputRow-label">Sheet</span>
							<NodeSelect className="NodeField-select" value={node.sheet || names[0]} onPointerDown={stopEvent} onChange={(e) => set({ sheet: e.target.value })}>
								{names.map((name) => (
									<option key={name} value={name}>
										{name}
									</option>
								))}
							</NodeSelect>
						</NodeRow>
					)}
					<WireField shapeId={shape.id} fieldKey="action" label="Action">
						<UiCheckbox checked={hashOutput} label="Output SHA-256 instead" onChange={(on) => set({ action: on ? 'sha256' : 'text' })} />
					</WireField>
				</>
			) : (
				<>
					<PortRow shapeId={shape.id} portId="url" label="URL" dataType="text" />
					{!urlWired && (
						<NodeRow>
							<UiTextInput placeholder="www.wikipedia.org" value={node.url ?? ''} onChange={(url) => set({ url })} />
						</NodeRow>
					)}
					<WireField shapeId={shape.id} fieldKey="asText" label="Read as">
						<NodeSelect className="NodeField-select" value={node.asText ?? 'auto'} onPointerDown={stopEvent} onChange={(e) => set({ asText: e.target.value })}>
							<option value="auto">Auto (page text, or raw)</option>
							<option value="text">Raw text</option>
							<option value="pagetext">Page text</option>
						</NodeSelect>
					</WireField>
				</>
			)}
			<FileInPreview node={node} shape={shape} />
		</>
	)
}

/** CSV/TSV-looking text: a real table (2+ columns), or a single column with a .csv/.tsv name. */
function looksTabular(node: FileInNode, text: string): boolean {
	const name = (node.fileName || '').toLowerCase()
	const namedAsTable = /\.(csv|tsv)$/.test(name) || node.fileType === 'csv' || node.fileType === 'tsv'
	try {
		const table = parseTable(text, 'auto')
		if (table.headers.length >= 2) return true
		return namedAsTable && table.headers.length >= 1
	} catch {
		return false
	}
}

function FileInPreview({ node, shape }: { node: FileInNode; shape: NodeShape }) {
	const editor = useEditor()
	const [open, setOpen] = useState(false)
	const text = node.lastText
	const isImage = !!text && (node.isImageOutput || isImageValue(text))
	if (isImage && text) {
		return (
			<div className="NodeImagePreview NodeScroll" style={{ height: NODE_IMAGE_PREVIEW_HEIGHT_PX - 8 }}>
				<NodeImage src={text} alt="result" />
				<FieldMax title="Open the image" onClick={() => setOpen(true)} />
				{open && <ImageZoom src={text} onClose={() => setOpen(false)} editor={editor} nextTo={shape} />}
			</div>
		)
	}
	const table = text && looksTabular(node, text) ? safeParseTable(text) : null
	return (
		<div className="NodeOutputView NodeGrow" style={{ height: NODE_IMAGE_PREVIEW_HEIGHT_PX - 8 }} onPointerDown={stopEvent}>
			{table ? (
				<UiTable columns={table.headers} rows={table.rows} maxRows={50} />
			) : text ? (
				<pre className="ValuePreview-text is-mono">{text.length > 2000 ? text.slice(0, 2000) + '…' : text}</pre>
			) : (
				<span className="NodeRow-disconnected">Press ▶ Play</span>
			)}
		</div>
	)
}

function safeParseTable(text: string) {
	try {
		return parseTable(text, 'auto')
	} catch {
		return null
	}
}

// ---------------------------------------------------------------------------
// URL in: replaced by "Read from" (source: 'url'). Kept so old canvases load.
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
	override hidden = true
	resultKeys = ['lastText', 'error'] as const
	getDefault(): UrlInNode {
		return { type: 'url_in', url: '', fetchBody: false, lastText: null, error: null }
	}
	getBodyHeightPx(shape: NodeShape, _node: UrlInNode) {
		return getNodeRowHeightPx(shape.props.fontSize) * 3
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
		return {
			output: { value: node.lastText, isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate, dataType: 'text' },
		}
	}
	Component = UrlInComponent
}

function UrlInComponent({ shape, node }: NodeComponentProps<UrlInNode>) {
	const editor = useEditor()
	const set = (patch: Partial<UrlInNode>) => updateNode<UrlInNode>(editor, shape, (n) => ({ ...n, ...patch }))
	const convert = () => {
		const next: FileInNode = {
			type: 'file_in',
			mode: 'upload',
			path: '',
			action: 'text',
			fileName: '',
			content: '',
			hash: '',
			lastText: node.lastText,
			error: node.error,
			source: 'url',
			url: node.url,
			fileUrl: '',
			fileType: '',
			fileSize: 0,
			asText: 'auto',
			sheet: '',
			sheets: '',
			isImageOutput: false,
		}
		updateNode<FileInNode>(editor, shape, () => next)
	}
	return (
		<>
			<NodeRow>
				<span className="NodeHint">Replaced by Read from.</span>
				<UiButton size="sm" variant="low" label="Convert" onClick={convert} />
			</NodeRow>
			<WireField shapeId={shape.id} fieldKey="url" label="URL">
				<UiTextInput placeholder="www.wikipedia.org" value={node.url} onChange={(url) => set({ url })} />
			</WireField>
			<WireField shapeId={shape.id} fieldKey="fetchBody" label="Fetch">
				<UiCheckbox checked={node.fetchBody} label="Fetch page text" onChange={(fetchBody) => set({ fetchBody })} />
			</WireField>
		</>
	)
}
