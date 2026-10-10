/**
 * The plan format "Build with AI" and the per-node specialist use, plus pure
 * validation against the node catalogue (shared/nodeSpecs.ts). No tldraw import.
 */

import type { FieldSpec, NodeSpec } from './nodeSpecs'
import { extractJsonObject } from './nodeAssist'

export interface PlanNode {
	ref: string
	type: string
	label?: string
	props: Record<string, unknown>
	after?: string
}

export interface PlanUpdate {
	id: string
	props: Record<string, unknown>
	label?: string
}

export interface PlanWire {
	from: string
	fromPort: string
	to: string
	toPort: string
}

export interface AiPlan {
	summary: string
	add: PlanNode[]
	update: PlanUpdate[]
	wires: PlanWire[]
	notes: string[]
}

/** A node already on the canvas, as context for validation and layout. */
export interface CanvasNodeInfo {
	id: string
	type: string
	label: string
	inputs: string[]
	outputs: string[]
	/** Input port ids that already have a wire into them. */
	wiredInputs: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {}
}

function readAdd(value: unknown): PlanNode[] {
	return (Array.isArray(value) ? value : []).flatMap((item) => {
		if (!isRecord(item) || typeof item.ref !== 'string' || typeof item.type !== 'string') return []
		const node: PlanNode = { ref: item.ref, type: item.type, props: asRecord(item.props) }
		if (typeof item.label === 'string') node.label = item.label
		if (typeof item.after === 'string') node.after = item.after
		return [node]
	})
}

function readUpdate(value: unknown): PlanUpdate[] {
	return (Array.isArray(value) ? value : []).flatMap((item) => {
		if (!isRecord(item) || typeof item.id !== 'string') return []
		const update: PlanUpdate = { id: item.id, props: asRecord(item.props) }
		if (typeof item.label === 'string') update.label = item.label
		return [update]
	})
}

function readWires(value: unknown): PlanWire[] {
	return (Array.isArray(value) ? value : []).flatMap((item) => {
		if (!isRecord(item)) return []
		if (typeof item.from !== 'string' || typeof item.to !== 'string') return []
		if (typeof item.fromPort !== 'string' || typeof item.toPort !== 'string') return []
		return [{ from: item.from, fromPort: item.fromPort, to: item.to, toPort: item.toPort }]
	})
}

function readNotes(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

/** Tolerant JSON extraction: missing arrays become []. */
export function parseAiPlan(text: string): AiPlan {
	const data = extractJsonObject(text)
	const record = asRecord(data)
	return {
		summary: asString(record.summary),
		add: readAdd(record.add),
		update: readUpdate(record.update),
		wires: readWires(record.wires),
		notes: readNotes(record.notes),
	}
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Output text → input image/model is allowed (one way); everything else needs an exact match, or 'any'. */
function dataTypesCompatible(outputType: string, inputType: string): boolean {
	if (outputType === 'any' || inputType === 'any') return true
	if (outputType === inputType) return true
	if (outputType !== 'text') return false
	return inputType === 'image' || inputType === 'model'
}

function validateField(field: FieldSpec, value: unknown, path: string, errors: string[]): boolean {
	if (field.kind === 'number') {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			errors.push(`${path}: "${field.key}" must be a number`)
			return false
		}
		return true
	}
	if (field.kind === 'boolean') {
		if (typeof value !== 'boolean') {
			errors.push(`${path}: "${field.key}" must be true or false`)
			return false
		}
		return true
	}
	if (field.kind === 'enum') {
		if (typeof value !== 'string' || (field.options && !field.options.includes(value))) {
			errors.push(`${path}: "${field.key}" must be one of ${(field.options ?? []).join(', ')}`)
			return false
		}
		return true
	}
	// text / longtext / code / sql / model / json / url: a string is enough.
	if (typeof value !== 'string') {
		errors.push(`${path}: "${field.key}" must be text`)
		return false
	}
	return true
}

/** Secret-shaped keys never reach a prop patch, regardless of what the spec declares. */
const SECRET_KEY = /key|token|secret|password|authValue|keyRef/i

/** Keep only prop keys the spec declares, with the right JS type; drop and report the rest. */
export function validateProps(
	type: string,
	props: Record<string, unknown>,
	specs: Record<string, NodeSpec>,
	errors: string[],
	itemLabel: string
): Record<string, unknown> {
	const spec = specs[type]
	const fieldsByKey = new Map((spec?.fields ?? []).map((field) => [field.key, field]))
	const clean: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(props)) {
		if (SECRET_KEY.test(key)) continue
		const field = fieldsByKey.get(key)
		if (!field) {
			errors.push(`${itemLabel}: unknown field "${key}" for ${type}`)
			continue
		}
		if (!validateField(field, value, itemLabel, errors)) continue
		clean[key] = value
	}
	return clean
}

interface ResolvedNode {
	type: string
	inputs: string[]
	outputs: string[]
}

export function validatePlan(
	plan: AiPlan,
	existing: CanvasNodeInfo[],
	specs: Record<string, NodeSpec>,
	allowedTypes?: string[]
): { plan: AiPlan; errors: string[] } {
	const errors: string[] = []
	const existingById = new Map(existing.map((node) => [node.id, node]))
	const allowed = allowedTypes && allowedTypes.length ? new Set(allowedTypes) : null

	// --- add --------------------------------------------------------------
	const seenRefs = new Set<string>()
	const addClean: PlanNode[] = []
	const resolved = new Map<string, ResolvedNode>()
	for (const node of existing) resolved.set(node.id, { type: node.type, inputs: node.inputs, outputs: node.outputs })

	for (const item of plan.add) {
		const spec = specs[item.type]
		if (!spec || spec.hidden || (allowed && !allowed.has(item.type))) {
			errors.push(`add "${item.ref}": "${item.type}" is not a type the AI may add`)
			continue
		}
		if (!item.ref || seenRefs.has(item.ref) || existingById.has(item.ref)) {
			errors.push(`add: ref "${item.ref || '(empty)'}" must be unique and not an existing node id`)
			continue
		}
		seenRefs.add(item.ref)
		const props = validateProps(item.type, item.props, specs, errors, `add "${item.ref}"`)
		const clean: PlanNode = { ref: item.ref, type: item.type, props }
		if (item.label) clean.label = item.label
		if (item.after) clean.after = item.after
		addClean.push(clean)
		resolved.set(item.ref, {
			type: item.type,
			inputs: spec.inputs.map((p) => p.id),
			outputs: spec.outputs.map((p) => p.id),
		})
	}

	// --- update -------------------------------------------------------------
	const updateClean: PlanUpdate[] = []
	for (const item of plan.update) {
		const node = existingById.get(item.id)
		if (!node) {
			errors.push(`update "${item.id}": not an existing node`)
			continue
		}
		const props = validateProps(node.type, item.props, specs, errors, `update "${item.id}"`)
		if (!Object.keys(props).length && !item.label) continue
		const clean: PlanUpdate = { id: item.id, props }
		if (item.label) clean.label = item.label
		updateClean.push(clean)
	}

	// --- wires ----------------------------------------------------------------
	const wiredInputs = new Set<string>()
	for (const node of existing) for (const portId of node.wiredInputs) wiredInputs.add(`${node.id}:${portId}`)

	// Cycle checking only matters when nothing in the graph can legitimately
	// loop (a for_each node provides its own loop semantics).
	const hasLoopNode = [...resolved.values()].some((n) => n.type === 'for_each')
	const graph = new Map<string, Set<string>>()
	const addEdge = (from: string, to: string) => {
		if (!graph.has(from)) graph.set(from, new Set())
		graph.get(from)!.add(to)
	}
	function reachable(from: string, to: string): boolean {
		const seen = new Set<string>()
		const stack = [from]
		while (stack.length) {
			const next = stack.pop()!
			if (next === to) return true
			if (seen.has(next)) continue
			seen.add(next)
			for (const n of graph.get(next) ?? []) stack.push(n)
		}
		return false
	}

	const dataType = (ref: string, portId: string, direction: 'in' | 'out'): string => {
		if (direction === 'in' && portId.startsWith('var:')) return 'text'
		const node = resolved.get(ref)
		const spec = node ? specs[node.type] : undefined
		const list = direction === 'in' ? spec?.inputs : spec?.outputs
		return list?.find((p) => p.id === portId)?.dataType ?? 'any'
	}

	const wiresClean: PlanWire[] = []
	for (const wire of plan.wires) {
		const from = resolved.get(wire.from)
		const to = resolved.get(wire.to)
		if (!from) errors.push(`wire: "${wire.from}" is not a known node`)
		if (!to) errors.push(`wire: "${wire.to}" is not a known node`)
		if (!from || !to) continue
		if (wire.from === wire.to) {
			errors.push(`wire: "${wire.from}" cannot wire to itself`)
			continue
		}
		if (!from.outputs.includes(wire.fromPort)) {
			errors.push(`wire: "${wire.fromPort}" is not an output of ${wire.from}`)
			continue
		}
		const isVar = wire.toPort.startsWith('var:')
		if (!isVar && !to.inputs.includes(wire.toPort)) {
			errors.push(`wire: "${wire.toPort}" is not an input of ${wire.to}`)
			continue
		}
		const inputKey = `${wire.to}:${wire.toPort}`
		if (wiredInputs.has(inputKey)) {
			errors.push(`wire: "${wire.toPort}" on ${wire.to} already has a wire`)
			continue
		}
		const outType = dataType(wire.from, wire.fromPort, 'out')
		const inType = dataType(wire.to, wire.toPort, 'in')
		if (!dataTypesCompatible(outType, inType)) {
			errors.push(`wire: ${wire.from}.${wire.fromPort} (${outType}) cannot feed ${wire.to}.${wire.toPort} (${inType})`)
			continue
		}
		if (!hasLoopNode && reachable(wire.to, wire.from)) {
			errors.push(`wire: ${wire.from} → ${wire.to} would create a cycle`)
			continue
		}
		wiredInputs.add(inputKey)
		addEdge(wire.from, wire.to)
		wiresClean.push(wire)
	}

	return {
		plan: { summary: plan.summary, add: addClean, update: updateClean, wires: wiresClean, notes: plan.notes },
		errors,
	}
}
