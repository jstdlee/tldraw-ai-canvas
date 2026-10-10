/**
 * Gather context about a canvas node for the AI: shared shape + the full
 * context used by the node specialist (Part D) and "Build with AI" (Part E).
 */

import { Editor } from 'tldraw'
import { opSpec, parseTable } from '../../shared/tableOps'
import { CanvasNodeInfo } from '../../shared/aiPlan'
import { nodeRunState } from './execution/nodeRunState'
import { NodeShape } from './nodes/NodeShapeUtil'
import { getNodeInputPortValues, getNodeOutputPortInfo, getNodePortConnections, getNodePorts } from './nodes/nodePorts'
import { isMultiInfoValue } from './nodes/types/shared'

/** Secret-shaped keys never leave this machine, let alone reach a model prompt. */
const SECRET_KEY = /key|token|secret|password|authValue|keyRef/i

function clip(text: string, max = 2000): string {
	return text.length > max ? text.slice(0, max) + '…' : text
}

function propsOf(shape: NodeShape): Record<string, unknown> {
	const node = shape.props.node as unknown as Record<string, unknown>
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(node)) {
		if (key === 'type' || SECRET_KEY.test(key) || value == null || value === '') continue
		if (typeof value === 'string') out[key] = clip(value)
		else if (typeof value === 'object') {
			try {
				out[key] = clip(JSON.stringify(value))
			} catch {
				// Not serialisable: skip it rather than crash.
			}
		} else out[key] = value
	}
	return out
}

export interface CanvasNodeContext extends CanvasNodeInfo {
	props: Record<string, unknown>
	error?: string
	inputSamples: Record<string, string>
	outputSample?: string
}

/** The node's own shape, wires and current values — the context sent with any AI request about it. */
export function describeCanvasNode(editor: Editor, shape: NodeShape): CanvasNodeContext {
	const node = shape.props.node as unknown as { type: string; error?: string | null }
	const ports = Object.values(getNodePorts(editor, shape))
	const inputs = ports.filter((p) => p.terminal === 'end').map((p) => p.id)
	const outputs = ports.filter((p) => p.terminal === 'start').map((p) => p.id)
	const connections = getNodePortConnections(editor, shape)
	const wiredInputs = [...new Set(connections.filter((c) => c.terminal === 'end').map((c) => c.ownPortId))]
	const label = shape.props.label || node.type

	const run = nodeRunState.get(editor)[shape.id]
	const ownError = typeof node.error === 'string' ? node.error : undefined
	const error = ownError ?? (run?.status === 'error' ? run.message : undefined)

	const inputValues = getNodeInputPortValues(editor, shape)
	const inputSamples: Record<string, string> = {}
	for (const portId of inputs) {
		const info = inputValues[portId]
		if (!info) continue
		const value = isMultiInfoValue(info) ? info.value[0] : info.value
		if (value == null || typeof value === 'symbol') continue
		inputSamples[portId] = info.dataType === 'image' ? '<image>' : clip(String(value), 1500)
	}

	let outputSample: string | undefined
	const outputValues = getNodeOutputPortInfo(editor, shape)
	const firstOutputId = outputs[0]
	if (firstOutputId && outputValues[firstOutputId]) {
		const info = outputValues[firstOutputId]
		const value = isMultiInfoValue(info) ? info.value[0] : info.value
		if (value != null && typeof value !== 'symbol') {
			outputSample = info.dataType === 'image' ? '<image>' : clip(String(value), 1500)
		}
	}

	return {
		id: shape.id,
		type: node.type,
		label,
		inputs,
		outputs,
		wiredInputs,
		props: propsOf(shape),
		error,
		inputSamples,
		outputSample,
	}
}

function dataInputText(ctx: CanvasNodeContext, literal: string): string {
	return ctx.inputSamples.data || ctx.inputSamples.input || literal || ''
}

/** Type-specific extra context no generic description would surface. */
export function nodeAssistContext(editor: Editor, shape: NodeShape): string {
	const node = shape.props.node as unknown as Record<string, unknown>
	const ctx = describeCanvasNode(editor, shape)
	const lines: string[] = []

	if (ctx.type === 'table') {
		const text = dataInputText(ctx, String(node.text ?? ''))
		if (text.trim()) {
			try {
				const table = parseTable(text, String(node.format ?? 'auto'))
				lines.push(`Input headers: ${table.headers.join(', ')}`)
				lines.push('First rows:')
				for (const row of table.rows.slice(0, 5)) lines.push('  ' + row.join(', '))
			} catch (error) {
				lines.push(`Input table could not be parsed: ${(error as Error).message}`)
			}
		}
		const op = opSpec(String(node.op ?? ''))
		if (op) lines.push(`Current operation "${op.id}": ${op.description} Parameters: ${op.params.map((p) => p.field).join(', ') || 'none'}.`)
	} else if (ctx.type === 'chart') {
		const text = dataInputText(ctx, String(node.text ?? ''))
		if (text.trim()) {
			try {
				const table = parseTable(text, String(node.format ?? 'auto'))
				lines.push(`Input headers: ${table.headers.join(', ')}`)
				for (const row of table.rows.slice(0, 3)) lines.push('  ' + row.join(', '))
			} catch (error) {
				lines.push(`Input table could not be parsed: ${(error as Error).message}`)
			}
		}
	} else if (ctx.type === 'database') {
		const tables = String(node.tables ?? '')
		if (tables.trim()) {
			try {
				const list = JSON.parse(tables) as { name: string; columns: { name: string }[]; rows?: number }[]
				for (const table of list) {
					lines.push(`Table "${table.name}": columns ${table.columns.map((c) => c.name).join(', ')}${table.rows != null ? `, ${table.rows} rows` : ''}`)
				}
			} catch {
				// Ignore: nothing useful to add.
			}
		}
	} else if (ctx.type === 'code') {
		lines.push(`Language: ${String(node.lang ?? 'ts')}`)
		if (ctx.error) lines.push(`Last error: ${ctx.error}`)
		if (ctx.inputSamples.a) lines.push(`Input a sample: ${ctx.inputSamples.a}`)
	} else if (ctx.type === 'http') {
		if (node.lastStatus != null) lines.push(`Last status: ${node.lastStatus}`)
		const lastText = typeof node.lastText === 'string' ? node.lastText : ''
		if (lastText) lines.push(`Last response (first 500 chars): ${lastText.slice(0, 500)}`)
	} else if (ctx.type === 'jev') {
		lines.push(`Kind: ${String(node.kind ?? 'noul')}`)
		if (node.options) lines.push(`Options: ${String(node.options)}`)
		if (ctx.inputSamples.context) lines.push(`Context sample: ${ctx.inputSamples.context}`)
	}

	return lines.join('\n')
}
