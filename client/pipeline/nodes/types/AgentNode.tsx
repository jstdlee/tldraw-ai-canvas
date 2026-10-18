/**
 * WP31 Part D: the `agent` card. Takes a task (+ optional context), a model, a choice of
 * search providers / MCP servers / skills, and runs `@mariozechner/pi-agent-core` on the
 * server (`POST /api/agent/run`, streamed as SSE). Shows a compact, expandable step list
 * while it runs and the final answer when done.
 */

import { useEffect, useState } from 'react'
import { categoryOf } from '../../../../shared/nodeGroups'
import { isAbortError } from '../../../../shared/abort'
import { SEARCH_PROVIDER_IDS, SEARCH_PROVIDER_LABELS } from '../../../../shared/search'
import { T, useEditor, useValue } from 'tldraw'
import {
	$mcpServers,
	$skills,
	loadMcpServersAndSkills,
	ModelSelect,
} from '../../../ai/aiConfig'
import { AgentRunEvent, apiAgentRun } from '../../api/pipelineApi'
import { agentStatusText } from '../../../../shared/agentStatus'
import { currentRunSignal, startExecution } from '../../execution/executionState'
import { AgentCardIcon } from '../../components/icons/AgentCardIcon'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX } from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { useFieldPortAnchor } from '../../ports/useFieldPortAnchor'
import { getNodeInputPortValues } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import { UiMultiSelect, UiNumberInput, UiTextArea } from '../../../ui'
import { NodeTextResult, NodeSelect, OutputPortRow, PortRow, stopEvent, useInputConnected, WireField, WireFieldHeader } from './fields'
import { fillLlmTemplate, llmTemplateVars, llmVarPorts, llmVarsHeight, LlmVarRows } from './llmSettings'
import {
	AGENT_ANSWER_FORMATS,
	AGENT_ANSWER_FORMAT_LABELS,
	AgentAnswerFormat,
	answerFormatInstruction,
	buildReaskTask,
	checkAgentAnswer,
	normalizeAnswerFormat,
} from '../../../../shared/agentAnswerFormat'
import {
	areAnyInputsOutOfDate,
	coerceToText,
	ExecutionResult,
	getInput,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodePortLabel,
	NodeRow,
	STOP_EXECUTION,
	updateNode,
} from './shared'

export type AgentNode = T.TypeOf<typeof AgentNode>
export const AgentNode = T.object({
	type: T.literal('agent'),
	model: T.string,
	task: T.string,
	/** JSON string arrays: ids of chosen search providers / MCP servers / skills. */
	search: T.string,
	mcpServers: T.string,
	skills: T.string,
	systemPrompt: T.string.optional(),
	maxSteps: T.number,
	/** WP33 item E: 'text' (default/old cards) | 'table' | 'json'. Optional so a canvas saved
	 * before this field existed keeps loading (falls back to 'text' — see normalizeAnswerFormat). */
	answerFormat: T.string.optional(),
	/** Last run: the final answer, and the step transcript as JSON (for the `steps` output). */
	lastOutput: T.string.nullable(),
	lastStepsJson: T.string.nullable(),
	error: T.string.nullable(),
})

const W = 420
const TASK_PX = 80
const STEPS_PX = 160

interface StepRow {
	step: number
	kind: 'tool_call' | 'text'
	name?: string
	argsPreview?: string
	resultPreview?: string
	isError?: boolean
	text?: string
}

function parseIds(json: string): string[] {
	try {
		const parsed = JSON.parse(json || '[]')
		return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
	} catch {
		return []
	}
}

export class AgentNodeDefinition extends NodeDefinition<AgentNode> {
	static type = 'agent'
	static validator = AgentNode
	title = 'Agent'
	heading = 'Agent'
	icon = <AgentCardIcon />
	category = categoryOf('agent')
	override defaultWidthPx = W
	override showsOutput = true
	resultKeys = ['lastOutput', 'lastStepsJson', 'error'] as const
	getDefault(): AgentNode {
		return {
			type: 'agent',
			model: '',
			task: '',
			search: '[]',
			mcpServers: '[]',
			skills: '[]',
			systemPrompt: '',
			maxSteps: 12,
			answerFormat: 'text',
			lastOutput: null,
			lastStepsJson: null,
			error: null,
		}
	}
	private vars(node: AgentNode) {
		return llmTemplateVars([node.task])
	}
	getBodyHeightPx(shape: NodeShape, node: AgentNode) {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		// context row, task port row, model row, search/mcp/skills rows, system prompt row,
		// max steps row, answer format row, steps-output row, status row (11 rows), + the task
		// textarea, {{vars}} rows (WP33 item E), step list and result boxes.
		return rowPx * 11 + TASK_PX + llmVarsHeight(this.vars(node), rowPx) + STEPS_PX + 120
	}
	getPorts(shape: NodeShape, node: AgentNode): Record<string, ShapePort> {
		const width = this.getWidthPx(shape, node)
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const baseY = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
		const totalRows = 11
		const y = (row: number) => baseY + rowPx * (row + 0.5) + (row >= 2 ? TASK_PX : 0)
		const vars = this.vars(node)
		return {
			context: { id: 'context', x: 0, y: y(0), terminal: 'end', dataType: 'any' },
			task: { id: 'task', x: 0, y: y(1), terminal: 'end', dataType: 'text' },
			model: { id: 'model', x: 0, y: y(2), terminal: 'end', dataType: 'model' },
			output: { id: 'output', x: width, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
			steps: { id: 'steps', x: width, y: y(9), terminal: 'start', dataType: 'text' },
			...llmVarPorts(vars, baseY + rowPx * totalRows + TASK_PX, rowPx),
		}
	}
	async execute(shape: NodeShape, node: AgentNode, inputs: InputValues): Promise<ExecutionResult> {
		const taskInput = coerceToText(getInput(inputs, 'task'))
		const taskSource = (taskInput || node.task || '').trim()
		if (!taskSource) throw new Error('Type a task, or wire one in.')
		// WP33 item E: {{vars}} in the task, same mechanism as Web search / Generate text.
		const vars = this.vars(node)
		const { text: filledTask } = fillLlmTemplate(taskSource, vars, inputs)
		const context = coerceToText(getInput(inputs, 'context')) || undefined
		// AI-02/GAPS-02: the `model` port was drawn as wirable but never actually read — same
		// pattern as TextAI/Generate text/Chat (`llmEffectiveSettings`'s wiredModel).
		const wiredModel = coerceToText(getInput(inputs, 'model')).trim()
		const answerFormat = normalizeAnswerFormat(node.answerFormat)
		const instruction = answerFormatInstruction(answerFormat)

		const stepRows: StepRow[] = []
		updateNode<AgentNode>(this.editor, shape, (n) => ({ ...n, lastStepsJson: JSON.stringify(stepRows), error: null }))

		/** Runs one agent task to its final answer, appending to the shared step list as it
		 * goes. Throws on a server-reported error or on no answer at all. */
		const runOnce = async (task: string): Promise<string> => {
			for await (const event of apiAgentRun(
				{
					task,
					context,
					model: wiredModel || node.model || undefined,
					search: parseIds(node.search),
					mcpServers: parseIds(node.mcpServers),
					skills: parseIds(node.skills),
					systemPrompt: node.systemPrompt || undefined,
					maxSteps: node.maxSteps,
				},
				currentRunSignal(this.editor)
			)) {
				if (event.type === 'tool_call') {
					stepRows.push({ step: event.step, kind: 'tool_call', name: event.name, argsPreview: event.argsPreview })
					updateNode<AgentNode>(this.editor, shape, (n) => ({ ...n, lastStepsJson: JSON.stringify(stepRows) }), false)
				} else if (event.type === 'tool_result') {
					const row = [...stepRows].reverse().find((r) => r.kind === 'tool_call' && r.name === event.name && r.resultPreview === undefined)
					if (row) {
						row.resultPreview = event.resultPreview
						row.isError = event.isError
					}
					updateNode<AgentNode>(this.editor, shape, (n) => ({ ...n, lastStepsJson: JSON.stringify(stepRows) }), false)
				} else if (event.type === 'final') {
					return event.output
				} else if (event.type === 'error') {
					updateNode<AgentNode>(
						this.editor,
						shape,
						(n) => ({ ...n, error: event.message, lastStepsJson: JSON.stringify(stepRows) }),
						false
					)
					throw new Error(event.message)
				}
			}
			throw new Error('The agent stopped without an answer.')
		}

		try {
			let answer = await runOnce(instruction ? `${filledTask}\n\n${instruction}` : filledTask)
			let check = checkAgentAnswer(answer, answerFormat)
			if (!check.ok) {
				// WP33 item E: invalid for the requested format — re-ask once, quoting the problem.
				answer = await runOnce(buildReaskTask(filledTask, answerFormat, answer, check.error ?? 'invalid'))
				check = checkAgentAnswer(answer, answerFormat)
			}
			if (!check.ok) throw new Error(`Agent's answer is not valid ${AGENT_ANSWER_FORMAT_LABELS[answerFormat]}: ${check.error}`)
			updateNode<AgentNode>(this.editor, shape, (n) => ({
				...n,
				lastOutput: check.clean,
				lastStepsJson: JSON.stringify(stepRows),
				error: null,
			}))
			return { output: check.clean, steps: JSON.stringify(stepRows) }
		} catch (e) {
			if (!isAbortError(e)) {
				updateNode<AgentNode>(this.editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
			}
			return { output: STOP_EXECUTION, steps: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: AgentNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return {
			output: { value: node.lastOutput, isOutOfDate, dataType: 'text' },
			steps: { value: node.lastStepsJson, isOutOfDate, dataType: 'text' },
		}
	}
	Component = AgentNodeComponent
}

function StepList({ json, height }: { json: string | null; height: number }) {
	let rows: StepRow[] = []
	try {
		rows = json ? JSON.parse(json) : []
	} catch {
		rows = []
	}
	const [expanded, setExpanded] = useState<number | null>(null)
	return (
		<div className="NodeScroll" style={{ height: height - 8 }} onPointerDown={stopEvent}>
			{rows.length === 0 ? (
				<div className="GenerateTextNode-result-empty">
					<span>Press ▶ Play to run the agent</span>
				</div>
			) : (
				rows.map((row, i) => (
					<div key={i} className={'WebSearchNode-result' + (row.isError ? ' is-error' : '')}>
						{row.kind === 'tool_call' ? (
							<>
								<a className="WebSearchNode-result-title" onClick={() => setExpanded(expanded === i ? null : i)}>
									🔧 {row.name}
								</a>
								{expanded === i && (
									<span className="WebSearchNode-result-snippet">
										{row.argsPreview}
										{row.resultPreview ? ` → ${row.resultPreview}` : ' …'}
									</span>
								)}
							</>
						) : (
							<span className="WebSearchNode-result-snippet">{row.text}</span>
						)}
					</div>
				))
			)}
		</div>
	)
}

function AgentNodeComponent({ shape, node }: NodeComponentProps<AgentNode>) {
	const editor = useEditor()
	useEffect(() => loadMcpServersAndSkills(), [])
	const mcpServers = useValue('mcp servers', () => $mcpServers.get(), [])
	const skills = useValue('skills', () => $skills.get(), [])
	const contextWired = useInputConnected(shape.id, 'context')
	const taskWired = useInputConnected(shape.id, 'task')
	const modelWired = useInputConnected(shape.id, 'model')
	const vars = llmTemplateVars([node.task])
	const set = (patch: Partial<AgentNode>, outOfDate = true) =>
		updateNode<AgentNode>(editor, shape, (n) => ({ ...n, ...patch }), outOfDate)
	const run = () => void startExecution(editor, new Set([shape.id]))
	const contextRowRef = useFieldPortAnchor<HTMLDivElement>(shape.id, 'context')
	const modelRowRef = useFieldPortAnchor<HTMLDivElement>(shape.id, 'model')
	const contextPort = useValue('context port', () => getNodeInputPortValues(editor, shape.id).context, [editor, shape.id])

	return (
		<>
			<NodeRow ref={contextRowRef}>
				<Port shapeId={shape.id} portId="context" />
				<NodePortLabel dataType="any">Context</NodePortLabel>
				{!contextPort && <span className="NodeRow-disconnected">not connected (optional)</span>}
			</NodeRow>
			<PortRow shapeId={shape.id} portId="task" label="Task" dataType="text" hint="or type below" />
			{!taskWired && (
				<div className="NodeField-block" style={{ height: TASK_PX }}>
					<UiTextArea
						className="NodeField-textarea"
						grow
						placeholder="What should the agent do?"
						value={node.task}
						onChange={(task) => set({ task }, false)}
						onSubmit={run}
						submitOn="enter"
					/>
				</div>
			)}
			{modelWired ? (
				<PortRow shapeId={shape.id} portId="model" label="Model" dataType="model" />
			) : (
				<NodeRow ref={modelRowRef}>
					<Port shapeId={shape.id} portId="model" />
					<span className="NodeInputRow-label">Model</span>
					<ModelSelect className="node-model-select" capability="agent" value={node.model} onChange={(model) => set({ model })} />
				</NodeRow>
			)}
			<WireField shapeId={shape.id} fieldKey="search" label="Search">
				<UiMultiSelect
					values={parseIds(node.search) as (typeof SEARCH_PROVIDER_IDS)[number][]}
					options={SEARCH_PROVIDER_IDS.map((id) => ({ value: id, label: SEARCH_PROVIDER_LABELS[id] }))}
					onChange={(values) => set({ search: JSON.stringify(values) })}
					placeholder="None"
				/>
			</WireField>
			<WireField shapeId={shape.id} fieldKey="mcpServers" label="MCP servers">
				<UiMultiSelect
					values={parseIds(node.mcpServers)}
					options={(mcpServers ?? []).map((s) => ({ value: s.id, label: s.name }))}
					onChange={(values) => set({ mcpServers: JSON.stringify(values) })}
					placeholder={mcpServers === null ? 'Loading…' : 'None configured'}
				/>
			</WireField>
			<WireField shapeId={shape.id} fieldKey="skills" label="Skills">
				<UiMultiSelect
					values={parseIds(node.skills)}
					options={(skills ?? []).map((s) => ({ value: s.id, label: s.name }))}
					onChange={(values) => set({ skills: JSON.stringify(values) })}
					placeholder={skills === null ? 'Loading…' : 'None found'}
				/>
			</WireField>
			<WireFieldHeader shapeId={shape.id} fieldKey="systemPrompt" label="System prompt" />
			<WireField shapeId={shape.id} fieldKey="maxSteps" label="Max steps" dataType="number">
				<UiNumberInput min={1} max={40} value={node.maxSteps} onChange={(v) => set({ maxSteps: v == null ? 12 : Math.min(40, Math.max(1, v)) })} />
			</WireField>
			<WireField shapeId={shape.id} fieldKey="answerFormat" label="Answer format">
				<NodeSelect
					className="NodeField-select"
					value={normalizeAnswerFormat(node.answerFormat)}
					onPointerDown={stopEvent}
					onChange={(e) => set({ answerFormat: e.target.value as AgentAnswerFormat }, false)}
				>
					{AGENT_ANSWER_FORMATS.map((f) => (
						<option key={f} value={f}>
							{AGENT_ANSWER_FORMAT_LABELS[f]}
						</option>
					))}
				</NodeSelect>
			</WireField>
			<OutputPortRow shapeId={shape.id} portId="steps" label="Steps (JSON)" dataType="text" />
			<NodeRow>
				<span className={'NodeStatus' + (node.error ? ' is-error' : '')}>{agentStatusText(node)}</span>
			</NodeRow>
			<LlmVarRows shapeId={shape.id} vars={vars} />
			<StepList json={node.lastStepsJson} height={STEPS_PX} />
			<NodeTextResult text={node.lastOutput} empty="Final answer appears here" height={120} />
		</>
	)
}
