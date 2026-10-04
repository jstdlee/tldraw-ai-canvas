import { T, useEditor } from 'tldraw'
import { apiDownload, apiHttp, apiSave } from '../../api/pipelineApi'
import { LoadImageIcon } from '../../components/icons/LoadImageIcon'
import { PromptIcon } from '../../components/icons/PromptIcon'
import { UpscaleIcon } from '../../components/icons/UpscaleIcon'
import {
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_ROW_HEIGHT_PX,
	NODE_WIDTH_PX,
} from '../../constants'
import { Port as PortDot, ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { isImageValue, NodeTextResult, PortRow, stopEvent, useInputConnected } from './fields'
import {
	areAnyInputsOutOfDate,
	coerceToText,
	ExecutionResult,
	getInput,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeImage,
	NodeRow,
	STOP_EXECUTION,
	updateNode,
} from './shared'

const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
const portY = (row: number) => BASE_Y + NODE_ROW_HEIGHT_PX * (row + 0.5)

function formatBytes(n: number) {
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
	return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function parseHeaders(text: string): Record<string, string> {
	const trimmed = text.trim()
	if (!trimmed) return {}
	if (trimmed.startsWith('{')) {
		const parsed = JSON.parse(trimmed) as Record<string, unknown>
		return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]))
	}
	// "Name: value" lines
	return Object.fromEntries(
		trimmed
			.split(/\r?\n/)
			.map((l) => l.match(/^\s*([^:]+):\s*(.*)$/))
			.filter((m): m is RegExpMatchArray => !!m)
			.map((m) => [m[1].trim(), m[2].trim()])
	)
}

/** Shows the result: an image preview, or text. */
function ResultView({
	imageUrl,
	text,
	error,
	empty,
	height,
}: {
	imageUrl: string | null
	text: string | null
	error: string | null
	empty: string
	height: number
}) {
	if (imageUrl && !error) {
		return (
			<div className="NodeImagePreview" style={{ height: height - 8 }}>
				<NodeImage src={imageUrl} alt="result" />
			</div>
		)
	}
	return <NodeTextResult text={text} error={error} empty={empty} height={height} />
}

// ---------------------------------------------------------------------------
// HTTP request: GET / POST / PUT / PATCH / DELETE through the local server
// ---------------------------------------------------------------------------

export type HttpNode = T.TypeOf<typeof HttpNode>
export const HttpNode = T.object({
	type: T.literal('http'),
	method: T.string,
	url: T.string,
	headers: T.string,
	body: T.string,
	extractText: T.boolean,
	lastStatus: T.string.nullable(),
	lastText: T.string.nullable(),
	lastImageUrl: T.string.nullable(),
	error: T.string.nullable(),
})

const HTTP_HEADERS_HEIGHT_PX = 52
const HTTP_RESULT_HEIGHT_PX = 140

export class HttpNodeDefinition extends NodeDefinition<HttpNode> {
	static type = 'http'
	static validator = HttpNode
	title = 'HTTP request'
	heading = 'HTTP'
	icon = <UpscaleIcon />
	category = 'web'
	resultKeys = ['lastStatus', 'lastText', 'lastImageUrl', 'error'] as const
	getDefault(): HttpNode {
		return {
			type: 'http',
			method: 'GET',
			url: 'https://example.com',
			headers: '',
			body: '',
			extractText: true,
			lastStatus: null,
			lastText: null,
			lastImageUrl: null,
			error: null,
		}
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 5 + HTTP_HEADERS_HEIGHT_PX + HTTP_RESULT_HEIGHT_PX
	}
	getPorts(): Record<string, ShapePort> {
		return {
			url: { id: 'url', x: 0, y: portY(0), terminal: 'end', dataType: 'text' },
			body: { id: 'body', x: 0, y: portY(1), terminal: 'end', dataType: 'any' },
			output: { id: 'output', x: NODE_WIDTH_PX, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'any' },
		}
	}
	async execute(shape: NodeShape, node: HttpNode, inputs: InputValues): Promise<ExecutionResult> {
		const url = (coerceToText(getInput(inputs, 'url')) || node.url).trim()
		const bodyInput = getInput(inputs, 'body')
		const body = bodyInput != null ? coerceToText(bodyInput) : node.body
		try {
			const result = await apiHttp({
				method: node.method,
				url,
				headers: parseHeaders(node.headers),
				body,
				extractText: node.extractText,
			})
			const status = `${result.status} · ${result.contentType || 'no type'} · ${formatBytes(result.bytes)}`
			updateNode<HttpNode>(this.editor, shape, (n) => ({
				...n,
				lastStatus: status,
				lastText: result.text,
				lastImageUrl: result.imageUrl ?? null,
				error: result.ok ? null : `HTTP ${result.status}`,
			}))
			if (!result.ok) return { output: STOP_EXECUTION }
			return { output: result.imageUrl ?? result.text }
		} catch (e) {
			updateNode<HttpNode>(this.editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
			return { output: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: HttpNode, inputs: InfoValues): InfoValues {
		return {
			output: {
				value: node.lastImageUrl ?? node.lastText,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: node.lastImageUrl ? 'image' : 'text',
			},
		}
	}
	Component = HttpNodeComponent
}

function HttpNodeComponent({ shape, node }: NodeComponentProps<HttpNode>) {
	const editor = useEditor()
	const urlConnected = useInputConnected(shape.id, 'url')
	const bodyConnected = useInputConnected(shape.id, 'body')
	const set = (patch: Partial<HttpNode>) => updateNode<HttpNode>(editor, shape, (n) => ({ ...n, ...patch }))
	const needsBody = !['GET', 'HEAD', 'DELETE'].includes(node.method)
	return (
		<>
			{urlConnected ? (
				<PortRow shapeId={shape.id} portId="url" label="URL" dataType="text" />
			) : (
				<NodeRow>
					<PortDot shapeId={shape.id} portId="url" />
					<input
						className="NodeField-input"
						placeholder="https://…"
						value={node.url}
						onPointerDown={stopEvent}
						onKeyDown={stopEvent}
						onChange={(e) => set({ url: e.target.value })}
					/>
				</NodeRow>
			)}
			{bodyConnected || !needsBody ? (
				<PortRow
					shapeId={shape.id}
					portId="body"
					label="Body"
					dataType="any"
					hint={needsBody ? 'not connected' : `not used by ${node.method}`}
				/>
			) : (
				<NodeRow>
					<PortDot shapeId={shape.id} portId="body" />
					<input
						className="NodeField-input"
						placeholder='Body, e.g. {"q": "hello"}'
						value={node.body}
						onPointerDown={stopEvent}
						onKeyDown={stopEvent}
						onChange={(e) => set({ body: e.target.value })}
					/>
				</NodeRow>
			)}
			<NodeRow>
				<span className="NodeInputRow-label">Method</span>
				<select
					className="NodeField-select"
					value={node.method}
					onPointerDown={stopEvent}
					onChange={(e) => set({ method: e.target.value })}
				>
					{['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => (
						<option key={m}>{m}</option>
					))}
				</select>
			</NodeRow>
			<div className="NodeField-block" style={{ height: HTTP_HEADERS_HEIGHT_PX }}>
				<textarea
					className="NodeField-textarea"
					placeholder={'Headers (optional), one per line:\nAuthorization: Bearer …'}
					value={node.headers}
					onPointerDown={stopEvent}
					onKeyDown={stopEvent}
					onChange={(e) => set({ headers: e.target.value })}
				/>
			</div>
			<NodeRow>
				<label className="NodeField-check" onPointerDown={stopEvent}>
					<input
						type="checkbox"
						checked={node.extractText}
						onChange={(e) => set({ extractText: e.target.checked })}
					/>
					Web page → readable text
				</label>
			</NodeRow>
			<NodeRow>
				<span className={'NodeStatus' + (node.error ? ' is-error' : '')} title={node.lastStatus ?? ''}>
					{node.error ?? node.lastStatus ?? 'Not run yet'}
				</span>
			</NodeRow>
			<ResultView
				imageUrl={node.lastImageUrl}
				text={node.lastText}
				error={null}
				empty="Press ▶ Play to send"
				height={HTTP_RESULT_HEIGHT_PX}
			/>
		</>
	)
}

// ---------------------------------------------------------------------------
// Download URL: save a file into data/downloads; images also come out as images
// ---------------------------------------------------------------------------

export type DownloadNode = T.TypeOf<typeof DownloadNode>
export const DownloadNode = T.object({
	type: T.literal('download'),
	url: T.string,
	fileName: T.string,
	lastPath: T.string.nullable(),
	lastInfo: T.string.nullable(),
	lastText: T.string.nullable(),
	lastImageUrl: T.string.nullable(),
	error: T.string.nullable(),
})

const DOWNLOAD_RESULT_HEIGHT_PX = 140

export class DownloadNodeDefinition extends NodeDefinition<DownloadNode> {
	static type = 'download'
	static validator = DownloadNode
	title = 'Download URL'
	heading = 'Download'
	icon = <LoadImageIcon />
	category = 'web'
	resultKeys = ['lastPath', 'lastInfo', 'lastText', 'lastImageUrl', 'error'] as const
	getDefault(): DownloadNode {
		return {
			type: 'download',
			url: '',
			fileName: '',
			lastPath: null,
			lastInfo: null,
			lastText: null,
			lastImageUrl: null,
			error: null,
		}
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 3 + DOWNLOAD_RESULT_HEIGHT_PX
	}
	getPorts(): Record<string, ShapePort> {
		return {
			url: { id: 'url', x: 0, y: portY(0), terminal: 'end', dataType: 'text' },
			output: { id: 'output', x: NODE_WIDTH_PX, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'any' },
		}
	}
	async execute(shape: NodeShape, node: DownloadNode, inputs: InputValues): Promise<ExecutionResult> {
		const url = (coerceToText(getInput(inputs, 'url')) || node.url).trim()
		try {
			const r = await apiDownload({ url, fileName: node.fileName || undefined })
			updateNode<DownloadNode>(this.editor, shape, (n) => ({
				...n,
				lastPath: r.path,
				lastInfo: `${r.fileName} · ${r.contentType} · ${formatBytes(r.bytes)}`,
				lastText: r.text ?? null,
				lastImageUrl: r.imageUrl ?? null,
				error: null,
			}))
			return { output: r.imageUrl ?? r.text ?? r.path }
		} catch (e) {
			updateNode<DownloadNode>(this.editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
			return { output: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: DownloadNode, inputs: InfoValues): InfoValues {
		return {
			output: {
				value: node.lastImageUrl ?? node.lastText ?? node.lastPath,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: node.lastImageUrl ? 'image' : 'text',
			},
		}
	}
	Component = DownloadNodeComponent
}

function DownloadNodeComponent({ shape, node }: NodeComponentProps<DownloadNode>) {
	const editor = useEditor()
	const urlConnected = useInputConnected(shape.id, 'url')
	const set = (patch: Partial<DownloadNode>) =>
		updateNode<DownloadNode>(editor, shape, (n) => ({ ...n, ...patch }))
	return (
		<>
			{urlConnected ? (
				<PortRow shapeId={shape.id} portId="url" label="URL" dataType="text" />
			) : (
				<NodeRow>
					<PortDot shapeId={shape.id} portId="url" />
					<input
						className="NodeField-input"
						placeholder="https://… file, image or page"
						value={node.url}
						onPointerDown={stopEvent}
						onKeyDown={stopEvent}
						onChange={(e) => set({ url: e.target.value })}
					/>
				</NodeRow>
			)}
			<NodeRow>
				<span className="NodeInputRow-label">Save as</span>
				<input
					className="NodeField-input"
					placeholder="file name (optional)"
					value={node.fileName}
					onPointerDown={stopEvent}
					onKeyDown={stopEvent}
					onChange={(e) => set({ fileName: e.target.value })}
				/>
			</NodeRow>
			<NodeRow>
				<span
					className={'NodeStatus' + (node.error ? ' is-error' : '')}
					title={node.lastPath ?? ''}
				>
					{node.error ?? (node.lastInfo ? `Saved: ${node.lastInfo}` : 'Saves to data/downloads')}
				</span>
			</NodeRow>
			<ResultView
				imageUrl={node.lastImageUrl}
				text={node.lastText ?? node.lastPath}
				error={null}
				empty="Press ▶ Play to download"
				height={DOWNLOAD_RESULT_HEIGHT_PX}
			/>
		</>
	)
}

// ---------------------------------------------------------------------------
// Save to file: write text or an image into data/exports
// ---------------------------------------------------------------------------

export type SaveNode = T.TypeOf<typeof SaveNode>
export const SaveNode = T.object({
	type: T.literal('save'),
	fileName: T.string,
	lastPath: T.string.nullable(),
	lastPreview: T.string.nullable(),
	error: T.string.nullable(),
})

export class SaveNodeDefinition extends NodeDefinition<SaveNode> {
	static type = 'save'
	static validator = SaveNode
	title = 'Save to file'
	heading = 'Save'
	icon = <PromptIcon />
	category = 'output'
	resultKeys = ['lastPath', 'lastPreview', 'error'] as const
	getDefault(): SaveNode {
		return { type: 'save', fileName: 'canvas-{{date}}', lastPath: null, lastPreview: null, error: null }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 3 + 120
	}
	getPorts(): Record<string, ShapePort> {
		return {
			input: { id: 'input', x: 0, y: portY(0), terminal: 'end', dataType: 'any' },
			output: { id: 'output', x: NODE_WIDTH_PX, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: SaveNode, inputs: InputValues): Promise<ExecutionResult> {
		const content = coerceToText(getInput(inputs, 'input'))
		try {
			const r = await apiSave({ content, fileName: node.fileName || undefined })
			updateNode<SaveNode>(this.editor, shape, (n) => ({
				...n,
				lastPath: r.path,
				lastPreview: content.slice(0, 2000),
				error: null,
			}))
			return { output: r.path }
		} catch (e) {
			updateNode<SaveNode>(this.editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
			return { output: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: SaveNode, inputs: InfoValues): InfoValues {
		return {
			output: {
				value: node.lastPath,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: 'text',
			},
		}
	}
	Component = SaveNodeComponent
}

function SaveNodeComponent({ shape, node }: NodeComponentProps<SaveNode>) {
	const editor = useEditor()
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="Content" dataType="any" hint="text or image" />
			<NodeRow>
				<span className="NodeInputRow-label">File</span>
				<input
					className="NodeField-input"
					placeholder="name ({{date}} = timestamp)"
					value={node.fileName}
					onPointerDown={stopEvent}
					onKeyDown={stopEvent}
					onChange={(e) => updateNode<SaveNode>(editor, shape, (n) => ({ ...n, fileName: e.target.value }))}
				/>
			</NodeRow>
			<NodeRow>
				<span className={'NodeStatus' + (node.error ? ' is-error' : '')} title={node.lastPath ?? ''}>
					{node.error ?? (node.lastPath ? `Saved: ${node.lastPath}` : 'Saves to data/exports')}
				</span>
			</NodeRow>
			<ResultView
				imageUrl={isImageValue(node.lastPreview) ? node.lastPreview : null}
				text={node.lastPreview}
				error={null}
				empty="Press ▶ Play to save"
				height={120}
			/>
		</>
	)
}
