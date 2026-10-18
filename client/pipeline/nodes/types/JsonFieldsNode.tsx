import { useMemo } from 'react'
import { categoryOf } from '../../../../shared/nodeGroups'
import { parsePaths, runJsonFields } from '../../../../shared/jsonFields'
import { T, useEditor } from 'tldraw'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX } from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { useFieldPortAnchor } from '../../ports/useFieldPortAnchor'
import { isInputWired } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import { UiTextArea } from '../../../ui'
import { IconJsonFields } from '../../../ui/icons'
import { OutputPortRow, PortRow, stopEvent, useInputConnected, WireFieldHeader } from './fields'
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
 * WP35 Part A: "JSON fields" — one output port per line of the `paths` field, pulled straight
 * out of `json` (also JSON inside a ```json fence, e.g. an LLM/Agent answer). A path that
 * doesn't resolve is an empty value plus a warning, never a hard failure — the other paths
 * still come through. `rest` carries whatever wasn't explicitly pulled out, for chaining. See
 * `shared/jsonFields.ts` for the pure logic this card is a thin UI over.
 */
export type JsonFieldsNode = T.TypeOf<typeof JsonFieldsNode>
export const JsonFieldsNode = T.object({
	type: T.literal('json_fields'),
	json: T.string,
	paths: T.string,
	lastValues: T.string.nullable(),
	lastRest: T.string.nullable(),
	warnings: T.string.nullable(),
	error: T.string.nullable(),
})

const JSON_TEXT_PX = 72
const PATHS_PX = 72
const WARN_PX = 44

function parseWarnings(warnings: string | null): string[] {
	return warnings ? warnings.split('\n').filter(Boolean) : []
}

export class JsonFieldsNodeDefinition extends NodeDefinition<JsonFieldsNode> {
	static type = 'json_fields'
	static validator = JsonFieldsNode
	title = 'JSON fields'
	heading = 'JSON fields'
	icon = <IconJsonFields />
	category = categoryOf('json_fields')
	override defaultWidthPx = 360
	override showsOutput = true
	resultKeys = ['lastValues', 'lastRest', 'warnings', 'error'] as const
	getDefault(): JsonFieldsNode {
		return {
			type: 'json_fields',
			json: '{"value":"hi","topic":"demo","data":[{"name":"Ada"}],"customer":{"country":"NO"}}',
			paths: 'value\ntopic\ndata[0].name\ncustomer.country',
			lastValues: null,
			lastRest: null,
			warnings: null,
			error: null,
		}
	}
	getBodyHeightPx(shape: NodeShape, node: JsonFieldsNode) {
		const jsonWired = isInputWired(this.editor, shape.id, 'json')
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const paths = parsePaths(node.paths)
		const errorRow = node.error ? 1 : 0
		const warnPx = parseWarnings(node.warnings).length ? WARN_PX : 0
		// json port row (+ its literal box when unwired), paths header + box, one row per
		// path output, the "rest" output row, an error row when present, and a fixed
		// warnings box when the last run flagged any missing path.
		return rowPx * (2 + paths.length + errorRow) + (jsonWired ? 0 : JSON_TEXT_PX) + PATHS_PX + warnPx
	}
	getPorts(shape: NodeShape, node: JsonFieldsNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const width = this.getWidthPx(shape, node)
		const paths = parsePaths(node.paths)
		const ports: Record<string, ShapePort> = {
			json: { id: 'json', x: 0, y: NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX + rowPx * 0.5, terminal: 'end', dataType: 'text' },
			rest: { id: 'rest', x: width, y: NODE_HEADER_HEIGHT_PX / 2 + rowPx * (2 + paths.length), terminal: 'start', dataType: 'text' },
		}
		paths.forEach((p, i) => {
			ports[p.portId] = { id: p.portId, x: width, y: NODE_HEADER_HEIGHT_PX / 2 + rowPx * (2 + i), terminal: 'start', dataType: 'text' }
		})
		return ports
	}
	async execute(shape: NodeShape, node: JsonFieldsNode, inputs: InputValues): Promise<ExecutionResult> {
		const input = getInputText(inputs, 'json') || node.json
		try {
			const result = runJsonFields(input, node.paths)
			updateNode<JsonFieldsNode>(
				this.editor,
				shape,
				(n) => ({
					...n,
					lastValues: JSON.stringify(result.values),
					lastRest: result.rest,
					warnings: result.warnings.length ? result.warnings.join('\n') : null,
					error: null,
				}),
				false
			)
			return { ...result.values, rest: result.rest }
		} catch (error) {
			updateNode<JsonFieldsNode>(this.editor, shape, (n) => ({ ...n, error: (error as Error).message }), false)
			throw error
		}
	}
	getOutputInfo(shape: NodeShape, node: JsonFieldsNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		const values = node.lastValues ? (JSON.parse(node.lastValues) as Record<string, string>) : {}
		const info: InfoValues = { rest: { value: node.lastRest ?? null, isOutOfDate, dataType: 'text' } }
		for (const p of parsePaths(node.paths)) {
			info[p.portId] = {
				value: Object.prototype.hasOwnProperty.call(values, p.portId) ? values[p.portId] : null,
				isOutOfDate,
				dataType: 'text',
			}
		}
		return info
	}
	Component = JsonFieldsNodeComponent
}

/** One read-only output row per `paths` line — like Decision switch's per-option rows, since
 * these ports are derived from a text field, not fixed by the schema. */
function JsonFieldOutputRow({ shapeId, portId, label }: { shapeId: NodeShape['id']; portId: string; label: string }) {
	const ref = useFieldPortAnchor<HTMLDivElement>(shapeId, portId)
	return (
		<NodeRow ref={ref} className="NodeRow-right">
			<span className="NodeBranch" title={label}>
				{label} →
			</span>
			<Port shapeId={shapeId} portId={portId} />
		</NodeRow>
	)
}

function JsonFieldsNodeComponent({ shape, node }: NodeComponentProps<JsonFieldsNode>) {
	const editor = useEditor()
	const jsonWired = useInputConnected(shape.id, 'json')
	const set = (patch: Partial<JsonFieldsNode>) => updateNode<JsonFieldsNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const paths = useMemo(() => parsePaths(node.paths), [node.paths])
	const warnings = parseWarnings(node.warnings)
	return (
		<>
			<PortRow shapeId={shape.id} portId="json" label="JSON" dataType="text" />
			{!jsonWired && (
				<div className="NodeField-block" style={{ height: JSON_TEXT_PX }}>
					<UiTextArea className="NodeField-textarea" mono grow rows={3} value={node.json} onChange={(json) => set({ json })} />
				</div>
			)}
			<WireFieldHeader shapeId={shape.id} fieldKey="paths" label="Paths" />
			<div className="NodeField-block" style={{ height: PATHS_PX }}>
				<UiTextArea
					className="NodeField-textarea"
					mono
					grow
					rows={3}
					placeholder={'value\ntopic\ndata[0].name\ncustomer.country'}
					value={node.paths}
					onChange={(paths) => set({ paths })}
				/>
			</div>
			{paths.map((p) => (
				<JsonFieldOutputRow key={p.portId} shapeId={shape.id} portId={p.portId} label={p.path} />
			))}
			<OutputPortRow shapeId={shape.id} portId="rest" label="Rest" dataType="text" />
			{node.error && (
				<NodeRow>
					<span className="NodeStatus is-error">{node.error}</span>
				</NodeRow>
			)}
			{warnings.length > 0 && (
				<div className="NodeScroll" style={{ height: WARN_PX }} onPointerDown={stopEvent}>
					{warnings.map((w, i) => (
						<div key={i} className="NodeHint NodeHint-warning">
							{w}
						</div>
					))}
				</div>
			)}
		</>
	)
}
