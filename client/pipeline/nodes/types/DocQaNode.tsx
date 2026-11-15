import { T, useEditor, useValue } from 'tldraw'
import { getDefaultModelKey } from '../../../../shared/aiConfig'
import { isAbortError } from '../../../../shared/abort'
import { categoryOf } from '../../../../shared/nodeGroups'
import {
	bm25Rank,
	buildDocQaPrompt,
	chunkText,
	cosineTopK,
	DEFAULT_CHUNK_OVERLAP,
	DEFAULT_CHUNK_SIZE,
	DEFAULT_TOP_K,
	hashText,
	NOT_IN_DOCUMENTS,
	parseDocumentsInput,
	type Chunk,
} from '../../../../shared/retrieval'
import { toCsv } from '../../../../shared/tableText'
import { $aiConfig, getModelLabel, useModels } from '../../../ai/aiConfig'
import { apiEmbed, readDocumentRef } from '../../api/aiCardsApi'
import { apiGenerateText, stripThinking } from '../../api/pipelineApi'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX } from '../../constants'
import { currentRunSignal } from '../../execution/executionState'
import { ShapePort } from '../../ports/Port'
import { isInputWired } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import { IconDocQa, UiNumberInput, UiTextArea } from '../../../ui'
import { AiStatusRow, ModelPickRow, modelPort } from './aiCardParts'
import { NodeSelect, NodeTextResult, OutputPortRow, PortRow, stopEvent, useInputConnected, WireField } from './fields'
import {
	areAnyInputsOutOfDate,
	ExecutionResult,
	getInputText,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	updateNode,
} from './shared'

/**
 * WP50 Document Q&A: answer a question from documents (text, a table of texts, or file paths /
 * URLs from Read from / HTTP). Retrieval: with an embed model, cosine similarity of chunk and
 * question embeddings; without one, BM25 keyword ranking (`shared/retrieval.ts`). Chunk
 * embeddings are cached per document hash (in this module, for the session), so asking a
 * second question only embeds the question.
 */
export type DocQaNode = T.TypeOf<typeof DocQaNode>
export const DocQaNode = T.object({
	type: T.literal('doc_qa'),
	documents: T.string,
	question: T.string,
	chunkSize: T.number,
	overlap: T.number,
	topK: T.number,
	model: T.string,
	/** '' = the default embed model if one is set up, else keywords; 'bm25' = always keywords; else a model key. */
	embedModel: T.string.optional(),
	lastAnswer: T.string.nullable(),
	lastSources: T.string.nullable(),
	lastInfo: T.string.optional(),
	error: T.string.nullable(),
})

export const KEYWORD_SEARCH = 'bm25'

const DOCS_PX = 88
const QUESTION_PX = 60
const RESULT_PX = 140

/** Chunk embeddings per (embed model, chunk size, overlap, document hash). */
const embedCache = new Map<string, number[][]>()
const EMBED_CACHE_MAX = 200

function cacheSet(key: string, vectors: number[][]) {
	embedCache.delete(key)
	embedCache.set(key, vectors)
	while (embedCache.size > EMBED_CACHE_MAX) embedCache.delete(embedCache.keys().next().value as string)
}

/** For tests: how many documents' chunk embeddings are cached. */
export function docQaEmbedCacheSize() {
	return embedCache.size
}

/** The embed model key this card would use, or null for keyword (BM25) search. */
export function docQaEmbedKey(node: Pick<DocQaNode, 'embedModel'>): string | null {
	const choice = node.embedModel ?? ''
	if (choice === KEYWORD_SEARCH) return null
	if (choice) return choice
	const config = $aiConfig.get()
	return (config && getDefaultModelKey(config, 'embed')) || null
}

export class DocQaNodeDefinition extends NodeDefinition<DocQaNode> {
	static type = 'doc_qa'
	static validator = DocQaNode
	title = 'Document Q&A'
	heading = 'Document Q&A'
	icon = <IconDocQa />
	category = categoryOf('doc_qa')
	override defaultWidthPx = 400
	override showsOutput = true
	resultKeys = ['lastAnswer', 'lastSources', 'lastInfo', 'error'] as const
	getDefault(): DocQaNode {
		return {
			type: 'doc_qa',
			documents: '',
			question: '',
			chunkSize: DEFAULT_CHUNK_SIZE,
			overlap: DEFAULT_CHUNK_OVERLAP,
			topK: DEFAULT_TOP_K,
			model: '',
			embedModel: '',
			lastAnswer: null,
			lastSources: null,
			lastInfo: '',
			error: null,
		}
	}
	private blocks(shape: NodeShape) {
		return {
			docs: isInputWired(this.editor, shape.id, 'documents') ? 0 : DOCS_PX,
			question: isInputWired(this.editor, shape.id, 'question') ? 0 : QUESTION_PX,
		}
	}
	getBodyHeightPx(shape: NodeShape, _node: DocQaNode) {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const { docs, question } = this.blocks(shape)
		// documents, question, chunk size, overlap, top K, model, search, status, answer, sources.
		return rowPx * 10 + docs + question + RESULT_PX
	}
	getPorts(shape: NodeShape, node: DocQaNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const base = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
		const { docs, question } = this.blocks(shape)
		const width = this.getWidthPx(shape, node)
		const questionY = base + rowPx + docs
		const modelY = questionY + rowPx + question + rowPx * 3
		const outY = modelY + rowPx * 3 + RESULT_PX
		return {
			documents: { id: 'documents', x: 0, y: base + rowPx * 0.5, terminal: 'end', dataType: 'text' },
			question: { id: 'question', x: 0, y: questionY + rowPx * 0.5, terminal: 'end', dataType: 'text' },
			model: modelPort(modelY + rowPx * 0.5),
			answer: { id: 'answer', x: width, y: outY + rowPx * 0.5, terminal: 'start', dataType: 'text' },
			sources: { id: 'sources', x: width, y: outY + rowPx * 1.5, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: DocQaNode, inputs: InputValues): Promise<ExecutionResult> {
		const signal = currentRunSignal(this.editor)
		try {
			const question = (isInputWired(this.editor, shape.id, 'question') ? getInputText(inputs, 'question') : node.question).trim()
			if (!question) throw new Error('Type a question, or wire one into Question.')
			const docsText = isInputWired(this.editor, shape.id, 'documents') ? getInputText(inputs, 'documents') : node.documents
			const inputsList = parseDocumentsInput(docsText)
			if (!inputsList.length) throw new Error('No documents. Type text, or wire text, a table of texts or file paths into Documents.')
			const docs: { name: string; text: string }[] = []
			for (const doc of inputsList) {
				const text = doc.ref ? await readDocumentRef(doc.ref, signal) : (doc.text ?? '')
				docs.push({ name: doc.name, text })
			}
			const size = clampInt(node.chunkSize, 100, 8000, DEFAULT_CHUNK_SIZE)
			const overlap = clampInt(node.overlap, 0, Math.floor(size / 2), DEFAULT_CHUNK_OVERLAP)
			const topK = clampInt(node.topK, 1, 50, DEFAULT_TOP_K)
			const perDoc = docs.map((d) => chunkText(d.text, size, overlap))
			const chunks: Chunk[] = perDoc.flatMap((list, doc) => list.map((text, index) => ({ doc, index, text })))
			if (!chunks.length) throw new Error('The documents are empty.')

			const embedKey = docQaEmbedKey(node)
			let ranked: (Chunk & { score: number })[]
			let info: string
			if (embedKey) {
				const vectors: number[][] = []
				let cached = 0
				for (let d = 0; d < docs.length; d++) {
					if (!perDoc[d].length) continue
					const key = `${embedKey}|${size}|${overlap}|${hashText(docs[d].text)}`
					let docVectors = embedCache.get(key)
					if (docVectors) cached++
					else {
						docVectors = (await apiEmbed(perDoc[d], embedKey, signal)).vectors
						cacheSet(key, docVectors)
					}
					vectors.push(...docVectors)
				}
				const [queryVector] = (await apiEmbed([question], embedKey, signal)).vectors
				ranked = cosineTopK(chunks, vectors, queryVector, topK)
				info = `${chunks.length} chunks · embeddings (${getModelLabel(embedKey, 'embed')})` + (cached ? ` · ${cached} of ${docs.length} cached` : '')
			} else {
				ranked = bm25Rank(chunks, question, topK)
				info = `${chunks.length} chunks · keyword search (BM25)`
			}

			const sources = ranked.map((c, i) => [i + 1, Math.round(c.score * 10000) / 10000, c.text, docs[c.doc].name])
			const sourcesCsv = toCsv(['rank', 'score', 'chunk', 'document'], sources)
			let answer: string
			if (!ranked.length) {
				// Keyword search found no shared word: no need to ask the model.
				answer = NOT_IN_DOCUMENTS
			} else {
				const prompt = buildDocQaPrompt(
					question,
					ranked.map((c) => ({ text: c.text, document: docs[c.doc].name }))
				)
				const wiredModel = getInputText(inputs, 'model').trim()
				const result = await apiGenerateText(
					{
						prompt,
						model: wiredModel || node.model || undefined,
						system: 'You answer questions from the given sources only, and cite them.',
						temperature: 0,
					},
					signal
				)
				answer = stripThinking(result.text).trim() || NOT_IN_DOCUMENTS
			}
			updateNode<DocQaNode>(
				this.editor,
				shape,
				(n) => ({ ...n, lastAnswer: answer, lastSources: sourcesCsv, lastInfo: info, error: null }),
				false
			)
			return { answer, sources: sourcesCsv }
		} catch (e) {
			if (!isAbortError(e)) updateNode<DocQaNode>(this.editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
			throw e
		}
	}
	getOutputInfo(shape: NodeShape, node: DocQaNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return {
			answer: { value: node.lastAnswer, isOutOfDate, dataType: 'text' },
			sources: { value: node.lastSources, isOutOfDate, dataType: 'text' },
		}
	}
	Component = DocQaNodeComponent
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = typeof value === 'number' ? value : Number(value)
	if (!Number.isFinite(n)) return fallback
	return Math.min(max, Math.max(min, Math.round(n)))
}

function DocQaNodeComponent({ shape, node }: NodeComponentProps<DocQaNode>) {
	const editor = useEditor()
	const docsWired = useInputConnected(shape.id, 'documents')
	const questionWired = useInputConnected(shape.id, 'question')
	const modelWired = useInputConnected(shape.id, 'model')
	const embedModels = useModels('embed')
	const defaultEmbed = useValue('default embed', () => docQaEmbedKey({ embedModel: '' }), [])
	const set = (patch: Partial<DocQaNode>, outOfDate = true) =>
		updateNode<DocQaNode>(editor, shape, (n) => ({ ...n, ...patch }), outOfDate)
	const embedChoice = node.embedModel ?? ''
	return (
		<>
			<PortRow shapeId={shape.id} portId="documents" label="Documents" dataType="text" hint="text, table or file paths" />
			{!docsWired && (
				<div className="NodeField-block" style={{ height: DOCS_PX }}>
					<UiTextArea
						className="NodeField-textarea"
						grow
						placeholder="Paste text, a table of texts, or one file path / URL per line"
						value={node.documents}
						onChange={(documents) => set({ documents })}
					/>
				</div>
			)}
			<PortRow shapeId={shape.id} portId="question" label="Question" dataType="text" />
			{!questionWired && (
				<div className="NodeField-block" style={{ height: QUESTION_PX }}>
					<UiTextArea
						className="NodeField-textarea"
						grow
						placeholder="What do you want to know?"
						value={node.question}
						onChange={(question) => set({ question })}
					/>
				</div>
			)}
			<WireField shapeId={shape.id} fieldKey="chunkSize" label="Chunk size" dataType="number" hint="chars">
				<UiNumberInput value={node.chunkSize} min={100} max={8000} step={100} onChange={(v) => set({ chunkSize: v ?? DEFAULT_CHUNK_SIZE })} />
			</WireField>
			<WireField shapeId={shape.id} fieldKey="overlap" label="Overlap" dataType="number" hint="chars">
				<UiNumberInput value={node.overlap} min={0} max={4000} step={10} onChange={(v) => set({ overlap: v ?? 0 })} />
			</WireField>
			<WireField shapeId={shape.id} fieldKey="topK" label="Top K" dataType="number" hint="chunks">
				<UiNumberInput value={node.topK} min={1} max={50} step={1} onChange={(v) => set({ topK: v ?? DEFAULT_TOP_K })} />
			</WireField>
			<ModelPickRow shapeId={shape.id} capability="chat" value={node.model} onChange={(model) => set({ model }, false)} />
			<NodeRow>
				<span className="NodeInputRow-label">Search</span>
				<NodeSelect
					className="node-model-select"
					value={embedChoice}
					onPointerDown={stopEvent}
					onChange={(e) => set({ embedModel: e.target.value })}
				>
					<option value="">
						{defaultEmbed ? `Auto: embeddings (${getModelLabel(defaultEmbed, 'embed')})` : 'Auto: keywords (no embed model)'}
					</option>
					{embedModels.map((m) => (
						<option key={m.key} value={m.key}>
							Embeddings: {m.label || m.key}
						</option>
					))}
					<option value={KEYWORD_SEARCH}>Keywords (BM25)</option>
					{embedChoice && embedChoice !== KEYWORD_SEARCH && !embedModels.some((m) => m.key === embedChoice) && (
						<option value={embedChoice}>{embedChoice}</option>
					)}
				</NodeSelect>
			</NodeRow>
			<AiStatusRow capability="chat" value={node.model} modelWired={modelWired}>
				<span className="NodeStatus AiCardStatus-text" title={node.lastInfo || undefined}>
					{node.lastInfo || 'Answers cite their sources as [1], [2] …'}
				</span>
			</AiStatusRow>
			<NodeTextResult text={node.lastAnswer} error={node.error} empty="The answer appears here" height={RESULT_PX} />
			<OutputPortRow shapeId={shape.id} portId="answer" label="Answer" dataType="text" />
			<OutputPortRow shapeId={shape.id} portId="sources" label="Sources (table)" dataType="text" />
		</>
	)
}
