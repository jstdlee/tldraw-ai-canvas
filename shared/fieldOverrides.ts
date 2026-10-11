/**
 * WP17 (every card parameter can be wired): which fields of a node type may be wired, and
 * computing the node-prop overrides implied by wired `field:<key>` ports. Pure — no tldraw
 * import, testable in Node.
 */

import type { FieldSpec, NodeSpec } from './nodeSpecs'
import { NODE_SPECS } from './nodeSpecs'
import { opSpec } from './tableOps'
import { coerceFieldValue } from './fieldCoerce'

/** Same literals as `client/pipeline/constants.tsx`'s `PortDataType`, duplicated here so this
 * file stays tldraw/client-free. */
export type FieldPortDataType = 'image' | 'text' | 'model' | 'number' | 'latent' | 'any'

export const FIELD_PORT_PREFIX = 'field:'

export function fieldPortId(key: string): string {
	return `${FIELD_PORT_PREFIX}${key}`
}

/** `field:<key>` -> `<key>`, or null if `portId` isn't a field port. */
export function fieldKeyFromPortId(portId: string): string | null {
	return portId.startsWith(FIELD_PORT_PREFIX) ? portId.slice(FIELD_PORT_PREFIX.length) : null
}

export function fieldPortDataType(kind: FieldSpec['kind']): FieldPortDataType {
	if (kind === 'number') return 'number'
	if (kind === 'model') return 'model'
	return 'text'
}

/** The fields of a node type that may be wired: not `wire: false`, and not already backed by a
 * dedicated port with the same id (that port already overrides the field; no second one). */
export function wirableFields(spec: NodeSpec | undefined): FieldSpec[] {
	if (!spec) return []
	const dedicated = new Set(spec.inputs.map((port) => port.id))
	return spec.fields.filter((field) => field.wire !== false && !dedicated.has(field.key))
}

/** DataPipe (table): only the current op's own params are wirable (the rest aren't shown or
 * used). Returns undefined (no narrowing) for every other node type. */
export function allowedFieldKeysFor(
	type: string,
	node: Record<string, unknown>
): Set<string> | undefined {
	if (type !== 'table') return undefined
	const spec = opSpec(String(node.op ?? ''))
	return new Set((spec?.params ?? []).map((param) => param.field))
}

/** The wirable fields for this exact node (spec fields, narrowed by DataPipe's current op). */
export function wirableFieldsFor(node: { type: string } & Record<string, unknown>): FieldSpec[] {
	const all = wirableFields(NODE_SPECS[node.type])
	const allowed = allowedFieldKeysFor(node.type, node)
	return allowed ? all.filter((field) => allowed.has(field.key)) : all
}

/**
 * Compute the node-prop overrides implied by wired field ports. `inputs` is keyed by port id
 * (e.g. `field:op`) with the raw wired value (string | number | null); entries for other ports
 * are ignored. Throws `FieldCoerceError` (via `coerceFieldValue`) when a wired value doesn't
 * match its field's kind — callers should let that propagate as the node's run error.
 */
export function computeFieldOverrides(
	type: string,
	node: Record<string, unknown>,
	inputs: Record<string, unknown>
): Record<string, unknown> {
	const patch: Record<string, unknown> = {}
	for (const field of wirableFieldsFor({ type, ...node })) {
		const portId = fieldPortId(field.key)
		if (!(portId in inputs)) continue
		const raw = inputs[portId]
		if (raw == null) continue
		patch[field.key] = coerceFieldValue(field.kind, raw, field.label, field.options)
	}
	return patch
}
