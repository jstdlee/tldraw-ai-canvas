import { categoryOf } from '../../../../shared/nodeGroups'
import { buildHttpRequest } from '../../../../shared/httpBuild'
import { formatRunMs } from '../../../../shared/llmUsage'
import { T, useEditor } from 'tldraw'
import { apiDownload, apiHttp, apiSave } from '../../api/pipelineApi'
import { TextAreaField } from '../../editors/CodeArea'
import { LoadImageIcon } from '../../components/icons/LoadImageIcon'
import { PromptIcon } from '../../components/icons/PromptIcon'
import { UpscaleIcon } from '../../components/icons/UpscaleIcon'
import {
	getNodeRowHeightPx,
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_WIDTH_PX,
} from '../../constants'
import { Port as PortDot, ShapePort } from '../../ports/Port'
import { useFieldPortAnchor } from '../../ports/useFieldPortAnchor'
import { NodeShape } from '../NodeShapeUtil'
import { UiCheckbox, UiTextInput } from '../../../ui'
import { isImageValue, PortRow, stopEvent, useInputConnected, NodeSelect, NodeTextResult, WireField, WireFieldHeader } from './fields'
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
const portY = (row: number, rowPx: number) => BASE_Y + rowPx * (row + 0.5)

function formatBytes(n: number) {
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
	return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Pretty-print a JSON body; any other text (or invalid JSON) passes through unchanged. */
function prettyMaybeJson(text: string | null): string | null {
	if (!text) return text
	const trimmed = text.trim()
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text
	try {
		return JSON.stringify(JSON.parse(trimmed), null, 2)
	} catch {
		return text
	}
}

/** Shows the result: an image preview, or the `NodeTextResult` text area (JSON pretty-printed). */
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
	return <NodeTextResult text={prettyMaybeJson(text)} empty={empty} height={height} />
}

// ---------------------------------------------------------------------------
// HTTP request: GET / POST / PUT / PATCH / DELETE through the local server
// ---------------------------------------------------------------------------

export type HttpNode = T.TypeOf<typeof HttpNode>
export const HttpNode = T.object({
	type: T.literal('http'),
	method: T.string,
	url: T.string,
	query: T.string.optional(),
	headers: T.string,
	body: T.string,
	auth: T.string.optional(),
	authValue: T.string.optional(),
	extractText: T.boolean,
	lastStatus: T.string.nullable(),
	lastText: T.string.nullable(),
	lastImageUrl: T.string.nullable(),
	lastHeaders: T.string.nullable().optional(),
	lastMs: T.number.nullable().optional(),
	error: T.string.nullable(),
})

const HTTP_WIDTH_PX = 400
const HTTP_QUERY_HEIGHT_PX = 64
const HTTP_HEADERS_HEIGHT_PX = 80
const HTTP_BODY_HEIGHT_PX = 110
const HTTP_RESULT_HEIGHT_PX = 150

export class HttpNodeDefinition extends NodeDefinition<HttpNode> {
	static type = 'http'
	static validator = HttpNode
	title = 'HTTP request'
	heading = 'HTTP'
	icon = <UpscaleIcon />
	category = categoryOf('http')
	override showsOutput = true
	resultKeys = ['lastStatus', 'lastText', 'lastImageUrl', 'error'] as const
	getDefault(): HttpNode {
		return {
			type: 'http',
			method: 'GET',
			url: 'https://example.com',
			query: '',
			headers: '',
			body: '',
			auth: '',
			authValue: '',
			extractText: true,
			lastStatus: null,
			lastText: null,
			lastImageUrl: null,
			lastHeaders: null,
			lastMs: null,
			error: null,
		}
	}
	override getWidthPx() {
		return HTTP_WIDTH_PX
	}
	getBodyHeightPx(shape: NodeShape, _node: HttpNode) {
		// Rows: method, URL, query label, auth, auth value, headers label, body port,
		// "web page -> text" checkbox, status = 9 (WP17: query/headers/auth each got their
		// own wirable row instead of sharing one).
		return (
			getNodeRowHeightPx(shape.props.fontSize) * 9 +
			HTTP_QUERY_HEIGHT_PX +
			HTTP_HEADERS_HEIGHT_PX +
			HTTP_BODY_HEIGHT_PX +
			HTTP_RESULT_HEIGHT_PX
		)
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return {
			url: { id: 'url', x: 0, y: portY(0, rowPx), terminal: 'end', dataType: 'text' },
			body: { id: 'body', x: 0, y: portY(1, rowPx), terminal: 'end', dataType: 'any' },
			output: { id: 'output', x: HTTP_WIDTH_PX, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'any' },
		}
	}
	async execute(shape: NodeShape, node: HttpNode, inputs: InputValues): Promise<ExecutionResult> {
		const url = (coerceToText(getInput(inputs, 'url')) || node.url).trim()
		const bodyInput = getInput(inputs, 'body')
		const body = bodyInput != null ? coerceToText(bodyInput) : node.body
		try {
			const built = buildHttpRequest({
				method: node.method,
				url,
				query: node.query ?? '',
				headers: node.headers,
				body,
				auth: node.auth ?? '',
				authValue: node.authValue ?? '',
			})
			const result = await apiHttp({
				...built,
				extractText: node.extractText,
			})
			const status = [
				String(result.status),
				result.contentType || 'no type',
				formatBytes(result.bytes),
				result.ms != null ? formatRunMs(result.ms) : '',
			]
				.filter(Boolean)
				.join(' · ')
			updateNode<HttpNode>(this.editor, shape, (n) => ({
				...n,
				lastStatus: status,
				lastText: result.text,
				lastImageUrl: result.imageUrl ?? null,
				lastHeaders: result.headers || null,
				lastMs: result.ms ?? null,
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
	const needsBody = !['GET', 'HEAD'].includes(node.method)
	const queryWired = useInputConnected(shape.id, 'field:query')
	const authWired = useInputConnected(shape.id, 'field:auth')
	const headersWired = useInputConnected(shape.id, 'field:headers')
	const urlRowRef = useFieldPortAnchor<HTMLDivElement>(shape.id, 'url')
	return (
		<>
			<WireField shapeId={shape.id} fieldKey="method" label="Method">
				<NodeSelect
					className="NodeField-select"
					value={node.method}
					onPointerDown={stopEvent}
					onChange={(e) => set({ method: e.target.value })}
				>
					{['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => (
						<option key={m}>{m}</option>
					))}
				</NodeSelect>
			</WireField>
			{urlConnected ? (
				<PortRow shapeId={shape.id} portId="url" label="URL" dataType="text" />
			) : (
				<NodeRow ref={urlRowRef}>
					<PortDot shapeId={shape.id} portId="url" />
					<UiTextInput placeholder="https://…" value={node.url} onChange={(url) => set({ url })} />
				</NodeRow>
			)}
			<WireFieldHeader shapeId={shape.id} fieldKey="query" label="Query" />
			{!queryWired && (
				<TextAreaField
					mono
					height={HTTP_QUERY_HEIGHT_PX}
					title="Query"
					placeholder={'Query, one per line:\nq=cat\nlimit=10'}
					value={node.query ?? ''}
					onChange={(query) => set({ query })}
				/>
			)}
			<WireField shapeId={shape.id} fieldKey="auth" label="Auth">
				<NodeSelect
					className="NodeField-select"
					value={node.auth ?? ''}
					onPointerDown={stopEvent}
					onChange={(e) => set({ auth: e.target.value })}
				>
					<option value="">None</option>
					<option value="bearer">Bearer</option>
					<option value="basic">Basic</option>
				</NodeSelect>
			</WireField>
			{!authWired && (
				<NodeRow>
					<UiTextInput
						placeholder={node.auth === 'basic' ? 'user:password' : 'token'}
						value={node.authValue ?? ''}
						disabled={!node.auth}
						onChange={(authValue) => set({ authValue })}
					/>
				</NodeRow>
			)}
			<WireFieldHeader shapeId={shape.id} fieldKey="headers" label="Headers" />
			{!headersWired && (
				<TextAreaField
					mono
					lang="text"
					height={HTTP_HEADERS_HEIGHT_PX}
					title="Headers"
					placeholder={'Headers, one per line:\nAccept: application/json'}
					value={node.headers}
					onChange={(headers) => set({ headers })}
				/>
			)}
			<PortRow
				shapeId={shape.id}
				portId="body"
				label="Body"
				dataType="any"
				hint={bodyConnected ? '' : needsBody ? 'or type it below' : `not used by ${node.method}`}
			/>
			<TextAreaField
				mono
				lang="json"
				height={HTTP_BODY_HEIGHT_PX}
				title="Body"
				placeholder={needsBody ? '{\n  "q": "hello"\n}' : `${node.method} sends no body`}
				value={bodyConnected ? '(from the Body input)' : node.body}
				onChange={(next) => {
					if (!needsBody || bodyConnected) return
					set({ body: next })
				}}
			/>
			<WireField shapeId={shape.id} fieldKey="extractText" label="Extract">
				<UiCheckbox checked={node.extractText} label="Web page → readable text" onChange={(extractText) => set({ extractText })} />
			</WireField>
			<NodeRow>
				<span className={'NodeStatus' + (node.error ? ' is-error' : '')} title={node.lastHeaders ?? node.lastStatus ?? ''}>
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
	category = categoryOf('download')
	override defaultWidthPx = 380
	override showsOutput = true
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
	getBodyHeightPx(shape: NodeShape, _node: DownloadNode) {
		return getNodeRowHeightPx(shape.props.fontSize) * 3 + DOWNLOAD_RESULT_HEIGHT_PX
	}
	getPorts(shape: NodeShape, node: DownloadNode): Record<string, ShapePort> {
		return {
			url: { id: 'url', x: 0, y: portY(0, getNodeRowHeightPx(shape.props.fontSize)), terminal: 'end', dataType: 'text' },
			output: { id: 'output', x: this.getWidthPx(shape, node), y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'any' },
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
	const urlRowRef = useFieldPortAnchor<HTMLDivElement>(shape.id, 'url')
	return (
		<>
			{urlConnected ? (
				<PortRow shapeId={shape.id} portId="url" label="URL" dataType="text" />
			) : (
				<NodeRow ref={urlRowRef}>
					<PortDot shapeId={shape.id} portId="url" />
					<UiTextInput placeholder="https://… file, image or page" value={node.url} onChange={(url) => set({ url })} />
				</NodeRow>
			)}
			<WireField shapeId={shape.id} fieldKey="fileName" label="Save as">
				<UiTextInput placeholder="file name (optional)" value={node.fileName} onChange={(fileName) => set({ fileName })} />
			</WireField>
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
	category = categoryOf('save')
	override showsOutput = true
	resultKeys = ['lastPath', 'lastPreview', 'error'] as const
	getDefault(): SaveNode {
		return { type: 'save', fileName: 'canvas-{{date}}', lastPath: null, lastPreview: null, error: null }
	}
	getBodyHeightPx(shape: NodeShape, _node: SaveNode) {
		return getNodeRowHeightPx(shape.props.fontSize) * 3 + 120
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		return {
			input: { id: 'input', x: 0, y: portY(0, getNodeRowHeightPx(shape.props.fontSize)), terminal: 'end', dataType: 'any' },
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
			<WireField shapeId={shape.id} fieldKey="fileName" label="File">
				<UiTextInput
					placeholder="name ({{date}} = timestamp)"
					value={node.fileName}
					onChange={(fileName) => updateNode<SaveNode>(editor, shape, (n) => ({ ...n, fileName }))}
				/>
			</WireField>
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
