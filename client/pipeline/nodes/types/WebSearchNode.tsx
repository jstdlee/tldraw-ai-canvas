import { categoryOf } from '../../../../shared/nodeGroups'
import { formatRunMs } from '../../../../shared/llmUsage'
import { isAbortError } from '../../../../shared/abort'
import {
	formatSearchMarkdown,
	SEARCH_PROVIDER_IDS,
	SEARCH_PROVIDER_LABELS,
	SearchOptions,
	SearchProviderId,
	SearchResultItem,
} from '../../../../shared/search'
import { useState } from 'react'
import { T, useEditor } from 'tldraw'
import { apiSearch } from '../../api/pipelineApi'
import { currentRunSignal, startExecution } from '../../execution/executionState'
import { FieldMax, LargeEditor } from '../../editors/LargeEditor'
import { WebSearchIcon } from '../../components/icons/WebSearchIcon'
import {
	getNodeRowHeightPx,
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
} from '../../constants'
import { Port as PortDot, ShapePort } from '../../ports/Port'
import { useFieldPortAnchor } from '../../ports/useFieldPortAnchor'
import { NodeShape } from '../NodeShapeUtil'
import { UiCheckbox, UiNumberInput, UiSecretInput, UiTextArea } from '../../../ui'
import {
	fillLlmTemplate,
	llmTemplateVars,
	llmVarPorts,
	llmVarsHeight,
	LlmVarRows,
} from './llmSettings'
import { OutputPortRow, stopEvent, useInputConnected, NodeSelect, WireField } from './fields'
import {
	areAnyInputsOutOfDate,
	coerceToText,
	ExecutionResult,
	getInput,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	STOP_EXECUTION,
	updateNode,
} from './shared'

export type WebSearchNode = T.TypeOf<typeof WebSearchNode>
export const WebSearchNode = T.object({
	type: T.literal('web_search'),
	provider: T.string,
	query: T.string,
	count: T.number,
	tavilyDepth: T.string.optional(),
	tavilyIncludeAnswer: T.boolean.optional(),
	exaIncludeText: T.boolean.optional(),
	/** The card's own saved key; empty falls back to the provider default (AI providers → Search providers). */
	keyRef: T.string.optional(),
	/** Last run: the raw results, as JSON (parsed only for display/outputs). */
	lastResultsJson: T.string.nullable(),
	lastAnswer: T.string.nullable().optional(),
	/** Time taken, and a template-var warning, joined for the status line. */
	lastInfo: T.string.optional(),
	error: T.string.nullable(),
})

const W = 400
const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
const QUERY_PX = 72
const RESULT_PX = 180

function parseResults(json: string | null): SearchResultItem[] {
	if (!json) return []
	try {
		const parsed = JSON.parse(json)
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return []
	}
}

function domainOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '')
	} catch {
		return url
	}
}

export class WebSearchNodeDefinition extends NodeDefinition<WebSearchNode> {
	static type = 'web_search'
	static validator = WebSearchNode
	title = 'Web search'
	heading = 'Web search'
	icon = <WebSearchIcon />
	category = categoryOf('web_search')
	override defaultWidthPx = W
	override showsOutput = true
	resultKeys = ['lastResultsJson', 'lastAnswer', 'error'] as const
	getDefault(): WebSearchNode {
		return {
			type: 'web_search',
			provider: 'exa',
			query: '',
			count: 5,
			tavilyDepth: 'basic',
			tavilyIncludeAnswer: false,
			exaIncludeText: false,
			keyRef: '',
			lastResultsJson: null,
			lastAnswer: null,
			lastInfo: '',
			error: null,
		}
	}
	private vars(node: WebSearchNode) {
		return llmTemplateVars([node.query])
	}
	/** Row indices after the always-reserved query box (rows 0-1 are provider/query, see getPorts). */
	private rows(node: WebSearchNode) {
		let row = 2
		const countRow = row++
		let tavilyDepthRow: number | undefined
		let tavilyAnswerRow: number | undefined
		let exaTextRow: number | undefined
		if (node.provider === 'tavily') {
			tavilyDepthRow = row++
			tavilyAnswerRow = row++
		}
		if (node.provider === 'exa') {
			exaTextRow = row++
		}
		const statusRow = row++
		const resultsRow = row++
		const urlsRow = row++
		const answerRow = row++
		return { countRow, tavilyDepthRow, tavilyAnswerRow, exaTextRow, statusRow, resultsRow, urlsRow, answerRow, totalRows: row }
	}
	getBodyHeightPx(shape: NodeShape, node: WebSearchNode) {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const { totalRows } = this.rows(node)
		return rowPx * totalRows + QUERY_PX + llmVarsHeight(this.vars(node), rowPx) + RESULT_PX
	}
	getPorts(shape: NodeShape, node: WebSearchNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		// `field:<key>` ports (provider, count, tavilyDepth, …) measure their own row from the
		// DOM (see useFieldPortAnchor) and need no entry here — only the dedicated ports do.
		const { resultsRow, urlsRow, answerRow, totalRows } = this.rows(node)
		// Rows 0-1 sit before the (always-reserved) query box; everything else sits after it.
		const y = (row: number) => BASE_Y + rowPx * (row + 0.5) + (row >= 2 ? QUERY_PX : 0)
		const vars = this.vars(node)
		return {
			query: { id: 'query', x: 0, y: y(1), terminal: 'end', dataType: 'text' },
			output: { id: 'output', x: this.getWidthPx(shape, node), y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
			results: { id: 'results', x: this.getWidthPx(shape, node), y: y(resultsRow), terminal: 'start', dataType: 'text' },
			urls: { id: 'urls', x: this.getWidthPx(shape, node), y: y(urlsRow), terminal: 'start', dataType: 'text' },
			answer: { id: 'answer', x: this.getWidthPx(shape, node), y: y(answerRow), terminal: 'start', dataType: 'text' },
			...llmVarPorts(vars, BASE_Y + rowPx * totalRows + QUERY_PX, rowPx),
		}
	}
	async execute(shape: NodeShape, node: WebSearchNode, inputs: InputValues): Promise<ExecutionResult> {
		const queryInput = coerceToText(getInput(inputs, 'query'))
		const querySource = queryInput || node.query?.trim() || ''
		const vars = this.vars(node)
		const { text: query, warning } = fillLlmTemplate(querySource, vars, inputs)
		if (!query.trim()) throw new Error('Type a search query, or wire one in.')

		const provider = node.provider as SearchProviderId
		const options: SearchOptions = {}
		if (provider === 'tavily') {
			options.tavilyDepth = (node.tavilyDepth as SearchOptions['tavilyDepth']) || 'basic'
			options.tavilyIncludeAnswer = !!node.tavilyIncludeAnswer
		}
		if (provider === 'exa') options.exaIncludeText = !!node.exaIncludeText

		try {
			const result = await apiSearch(
				{ provider, query, keyRef: node.keyRef || undefined, count: node.count, options },
				currentRunSignal(this.editor)
			)
			const info = [formatRunMs(result.ms), warning].filter(Boolean).join(' · ')
			updateNode<WebSearchNode>(this.editor, shape, (n) => ({
				...n,
				lastResultsJson: JSON.stringify(result.results),
				lastAnswer: result.answer ?? null,
				lastInfo: info,
				error: null,
			}))
			const markdown = formatSearchMarkdown(result.results)
			const urls = result.results.map((r) => r.url).join('\n')
			return {
				output: markdown || STOP_EXECUTION,
				results: JSON.stringify(result.results),
				urls: urls || STOP_EXECUTION,
				answer: result.answer || STOP_EXECUTION,
			}
		} catch (e) {
			updateNode<WebSearchNode>(this.editor, shape, (n) => ({ ...n, error: isAbortError(e) ? null : (e as Error).message }), false)
			return { output: STOP_EXECUTION, results: STOP_EXECUTION, urls: STOP_EXECUTION, answer: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: WebSearchNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		const results = parseResults(node.lastResultsJson)
		return {
			output: { value: results.length ? formatSearchMarkdown(results) : null, isOutOfDate, dataType: 'text' },
			results: { value: node.lastResultsJson, isOutOfDate, dataType: 'text' },
			urls: { value: results.length ? results.map((r) => r.url).join('\n') : null, isOutOfDate, dataType: 'text' },
			answer: { value: node.lastAnswer ?? null, isOutOfDate, dataType: 'text' },
		}
	}
	Component = WebSearchNodeComponent
}

function SearchResultList({ resultsJson, height }: { resultsJson: string | null; height: number }) {
	const [open, setOpen] = useState(false)
	const results = parseResults(resultsJson)
	return (
		<div className="GenerateTextNode-result NodeScroll" style={{ height: height - 8 }} onPointerDown={stopEvent}>
			{results.length > 0 && <FieldMax title="Open full results" onClick={() => setOpen(true)} />}
			{results.length === 0 ? (
				<div className="GenerateTextNode-result-empty">
					<span>Press ▶ Play to search</span>
				</div>
			) : (
				<div className="WebSearchNode-results">
					{results.map((r, i) => (
						<div className="WebSearchNode-result" key={r.url + i}>
							<a
								className="WebSearchNode-result-title"
								href={r.url}
								target="_blank"
								rel="noreferrer"
								title={r.title}
								onPointerDown={stopEvent}
							>
								{r.title}
							</a>
							<span className="WebSearchNode-result-domain">{domainOf(r.url)}</span>
							{r.snippet && <span className="WebSearchNode-result-snippet">{r.snippet}</span>}
						</div>
					))}
				</div>
			)}
			{open && (
				<LargeEditor
					title="Search results (JSON)"
					value={resultsJson ?? '[]'}
					lang="json"
					readOnly
					onChange={() => {}}
					onClose={() => setOpen(false)}
				/>
			)}
		</div>
	)
}

function WebSearchNodeComponent({ shape, node }: NodeComponentProps<WebSearchNode>) {
	const editor = useEditor()
	const queryConnected = useInputConnected(shape.id, 'query')
	const set = (patch: Partial<WebSearchNode>, outOfDate = true) => updateNode<WebSearchNode>(editor, shape, (n) => ({ ...n, ...patch }), outOfDate)
	const run = () => void startExecution(editor, new Set([shape.id]))
	const vars = llmTemplateVars([node.query])
	const queryRowRef = useFieldPortAnchor<HTMLDivElement>(shape.id, 'query')

	return (
		<>
			<WireField shapeId={shape.id} fieldKey="provider" label="Provider">
				<NodeSelect
					className="NodeField-select"
					value={node.provider}
					onPointerDown={stopEvent}
					onChange={(e) => set({ provider: e.target.value })}
				>
					{SEARCH_PROVIDER_IDS.map((id) => (
						<option key={id} value={id}>
							{SEARCH_PROVIDER_LABELS[id]}
						</option>
					))}
				</NodeSelect>
			</WireField>
			<NodeRow ref={queryRowRef}>
				<PortDot shapeId={shape.id} portId="query" />
				<span className="NodeInputRow-label">Query</span>
				{queryConnected && <span className="NodeRow-disconnected">from the Query input</span>}
			</NodeRow>
			<div className="NodeField-block" style={{ height: QUERY_PX }}>
				<UiTextArea
					className="NodeField-textarea"
					grow
					disabled={queryConnected}
					placeholder={queryConnected ? '(from the Query input)' : 'Search the web for…'}
					value={queryConnected ? '' : node.query}
					onChange={(query) => set({ query }, false)}
					onSubmit={run}
					submitOn="enter"
				/>
				<div className="LlmSubmitHint">Enter to run · Shift+Enter new line</div>
			</div>
			<WireField shapeId={shape.id} fieldKey="count" label="Results" dataType="number">
				<UiNumberInput min={1} max={20} value={node.count} onChange={(count) => set({ count: count == null ? 5 : Math.min(20, Math.max(1, count)) })} />
			</WireField>
			{node.provider === 'tavily' && (
				<>
					<WireField shapeId={shape.id} fieldKey="tavilyDepth" label="Depth">
						<NodeSelect
							className="NodeField-select"
							value={node.tavilyDepth ?? 'basic'}
							onPointerDown={stopEvent}
							onChange={(e) => set({ tavilyDepth: e.target.value })}
						>
							<option value="basic">Basic (fast)</option>
							<option value="advanced">Advanced</option>
						</NodeSelect>
					</WireField>
					<WireField shapeId={shape.id} fieldKey="tavilyIncludeAnswer" label="Answer">
						<UiCheckbox
							checked={!!node.tavilyIncludeAnswer}
							label="Include a short generated answer"
							onChange={(tavilyIncludeAnswer) => set({ tavilyIncludeAnswer })}
						/>
					</WireField>
				</>
			)}
			{node.provider === 'exa' && (
				<WireField shapeId={shape.id} fieldKey="exaIncludeText" label="Text">
					<UiCheckbox
						checked={!!node.exaIncludeText}
						label="Include each page's extracted text"
						onChange={(exaIncludeText) => set({ exaIncludeText })}
					/>
				</WireField>
			)}
			<NodeRow>
				<UiSecretInput
					value={node.keyRef}
					onChange={(keyRef) => set({ keyRef })}
					placeholder={`${SEARCH_PROVIDER_LABELS[node.provider as SearchProviderId] ?? 'Provider'} key (optional, else the saved default)`}
				/>
			</NodeRow>
			<NodeRow>
				<span className={'NodeStatus' + (node.error ? ' is-error' : '')}>{node.error ?? node.lastInfo ?? 'Not run yet'}</span>
			</NodeRow>
			<OutputPortRow shapeId={shape.id} portId="results" label="Results (JSON)" dataType="text" />
			<OutputPortRow shapeId={shape.id} portId="urls" label="URLs" dataType="text" />
			<OutputPortRow shapeId={shape.id} portId="answer" label="Answer" dataType="text" />
			<LlmVarRows shapeId={shape.id} vars={vars} />
			<SearchResultList resultsJson={node.lastResultsJson} height={RESULT_PX} />
		</>
	)
}
