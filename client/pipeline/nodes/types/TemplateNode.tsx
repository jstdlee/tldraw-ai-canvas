import { fieldPortId } from '../../../../shared/fieldOverrides'
import { categoryOf } from '../../../../shared/nodeGroups'
import { fillTemplate, findTemplateVars, TemplateEscape } from '../../../../shared/templateCard'
import { T, useEditor } from 'tldraw'
import { getNodeRowHeightPx, GROW_FIELD_EXTRA_PX, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { isInputWired } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import { UiTextArea } from '../../../ui'
import { IconTemplate } from '../../../ui/icons'
import { llmVarPorts, llmVarsHeight, LlmVarRows } from './llmSettings'
import { NodeSelect, stopEvent, useInputConnected, WireField, WireFieldHeader } from './fields'
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
	updateNode,
} from './shared'

/**
 * WP35 Part F: "Template" — one input port per `{{name}}` in `template` (reusing Generate
 * text's own `{{vars}}` convention: `llmVarPorts`/`LlmVarRows`/`findTemplateVars`), plus
 * `{{name|table}}` to render a table value as an HTML/Markdown table. `escape` controls how a
 * plain substitution is encoded — e.g. `json` keeps a hand-built JSON body valid even when the
 * value has quotes or newlines (GAPS-18). See `shared/templateCard.ts` for the pure logic.
 */
export type TemplateNode = T.TypeOf<typeof TemplateNode>
export const TemplateNode = T.object({
	type: T.literal('template'),
	template: T.string,
	escape: T.string,
	lastOutput: T.string.nullable(),
	warning: T.string.nullable(),
	error: T.string.nullable(),
})

const TEMPLATE_PX = 96

const SAMPLE_TEMPLATE = ['{', '  "customer": "{{name}}",', '  "summary": "{{summary}}"', '}'].join('\n')

export class TemplateNodeDefinition extends NodeDefinition<TemplateNode> {
	static type = 'template'
	static validator = TemplateNode
	title = 'Template'
	heading = 'Template'
	icon = <IconTemplate />
	category = categoryOf('template')
	override defaultWidthPx = 360
	override showsOutput = true
	resultKeys = ['lastOutput', 'warning', 'error'] as const
	getDefault(): TemplateNode {
		return { type: 'template', template: SAMPLE_TEMPLATE, escape: 'json', lastOutput: null, warning: null, error: null }
	}
	getBodyHeightPx(shape: NodeShape, node: TemplateNode) {
		const templateWired = isInputWired(this.editor, shape.id, fieldPortId('template'))
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const vars = findTemplateVars(node.template)
		const statusRow = node.error || node.warning ? 1 : 0
		// template header (+its box unwired), escape, one row per {{var}}, the status row.
		return rowPx * (2 + statusRow) + (templateWired ? 0 : TEMPLATE_PX + GROW_FIELD_EXTRA_PX) + llmVarsHeight(vars, rowPx)
	}
	getPorts(shape: NodeShape, node: TemplateNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const width = this.getWidthPx(shape, node)
		const vars = findTemplateVars(node.template)
		const varsStartY = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX + rowPx * 2
		return {
			...llmVarPorts(vars, varsStartY, rowPx),
			output: { id: 'output', x: width, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: TemplateNode, inputs: InputValues): Promise<ExecutionResult> {
		const vars = findTemplateVars(node.template)
		const values: Record<string, string> = {}
		const missing: string[] = []
		for (const name of vars) {
			const raw = getInput(inputs, `var:${name}`)
			if (raw == null || raw === '') missing.push(name)
			values[name] = coerceToText(raw)
		}
		try {
			const output = fillTemplate(node.template, { escape: node.escape as TemplateEscape, values })
			updateNode<TemplateNode>(
				this.editor,
				shape,
				(n) => ({
					...n,
					lastOutput: output,
					warning: missing.length ? `${missing.map((name) => `{{${name}}}`).join(', ')} not wired` : null,
					error: null,
				}),
				false
			)
			return { output }
		} catch (error) {
			updateNode<TemplateNode>(this.editor, shape, (n) => ({ ...n, error: (error as Error).message }), false)
			throw error
		}
	}
	getOutputInfo(shape: NodeShape, node: TemplateNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return { output: { value: node.lastOutput ?? null, isOutOfDate, dataType: 'text' } }
	}
	Component = TemplateNodeComponent
}

const ESCAPE_OPTIONS: { value: TemplateEscape; label: string }[] = [
	{ value: 'none', label: 'None' },
	{ value: 'json', label: 'JSON string' },
	{ value: 'html', label: 'HTML' },
	{ value: 'url', label: 'URL' },
	{ value: 'csv', label: 'CSV' },
]

function TemplateNodeComponent({ shape, node }: NodeComponentProps<TemplateNode>) {
	const editor = useEditor()
	const templateWired = useInputConnected(shape.id, 'field:template')
	const set = (patch: Partial<TemplateNode>) => updateNode<TemplateNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const vars = findTemplateVars(node.template)
	return (
		<>
			<WireFieldHeader shapeId={shape.id} fieldKey="template" label="Template" />
			{!templateWired && (
				<div className="NodeField-block" style={{ height: TEMPLATE_PX + GROW_FIELD_EXTRA_PX }}>
					<UiTextArea
						className="NodeField-textarea"
						mono
						grow
						rows={5}
						placeholder={'Hi {{name}},\n\n{{rows|table}}'}
						value={node.template}
						onChange={(template) => set({ template })}
					/>
				</div>
			)}
			<WireField shapeId={shape.id} fieldKey="escape" label="Escape">
				<NodeSelect className="NodeField-select" value={node.escape} onPointerDown={stopEvent} onChange={(e) => set({ escape: e.target.value })}>
					{ESCAPE_OPTIONS.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</NodeSelect>
			</WireField>
			<LlmVarRows shapeId={shape.id} vars={vars} />
			{node.error ? (
				<NodeRow>
					<span className="NodeStatus is-error">{node.error}</span>
				</NodeRow>
			) : (
				node.warning && (
					<NodeRow>
						<span className="NodeHint NodeHint-warning">{node.warning}</span>
					</NodeRow>
				)
			)}
		</>
	)
}
