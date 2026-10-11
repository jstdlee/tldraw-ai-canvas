/**
 * WP17 (every card parameter can be wired): applies the node-prop overrides implied by wired
 * `field:<key>` ports before a node runs or reports its output info. Pure merge logic lives in
 * `shared/fieldOverrides.ts`; this file only adapts tldraw's `InputValues`/`InfoValues` shapes
 * to the plain `Record<string, unknown>` that helper expects.
 */
import { computeFieldOverrides, FIELD_PORT_PREFIX } from '../../../shared/fieldOverrides'
import type { NodeShape } from './NodeShapeUtil'
import type { NodeType } from './nodeTypes'
import { InfoValues, InputValues, isMultiInfoValue, PipelineValue, STOP_EXECUTION } from './types/shared'

function fieldInputsFromValues(inputs: InputValues): Record<string, unknown> {
	const raw: Record<string, unknown> = {}
	for (const [portId, value] of Object.entries(inputs)) {
		if (!portId.startsWith(FIELD_PORT_PREFIX)) continue
		raw[portId] = Array.isArray(value) ? value[0] ?? null : value
	}
	return raw
}

function fieldInputsFromInfo(inputs: InfoValues): Record<string, unknown> {
	const raw: Record<string, unknown> = {}
	for (const [portId, info] of Object.entries(inputs)) {
		if (!portId.startsWith(FIELD_PORT_PREFIX)) continue
		const value: PipelineValue | STOP_EXECUTION = isMultiInfoValue(info) ? info.value[0] : info.value
		if (value === STOP_EXECUTION) continue
		raw[portId] = value
	}
	return raw
}

/** The node with any wired field overrides merged in, for `execute`. */
export function applyFieldOverrides(shape: NodeShape, inputs: InputValues): NodeType {
	const node = shape.props.node
	const patch = computeFieldOverrides(
		node.type,
		node as unknown as Record<string, unknown>,
		fieldInputsFromValues(inputs)
	)
	return Object.keys(patch).length ? ({ ...node, ...patch } as NodeType) : node
}

/** Same, for `getOutputInfo` (reads InfoValues instead of plain InputValues). */
export function applyFieldOverridesInfo(shape: NodeShape, inputs: InfoValues): NodeType {
	const node = shape.props.node
	const patch = computeFieldOverrides(
		node.type,
		node as unknown as Record<string, unknown>,
		fieldInputsFromInfo(inputs)
	)
	return Object.keys(patch).length ? ({ ...node, ...patch } as NodeType) : node
}
