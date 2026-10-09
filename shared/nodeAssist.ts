/** Parse the JSON an agent returns when it fills or wires nodes. */

export interface FillPlan {
	props: Record<string, unknown>
}

export interface ComposeUpdate {
	id: string
	props: Record<string, unknown>
}

export interface ComposeAdd {
	tempId: string
	type: string
	props: Record<string, unknown>
	x: number
	y: number
}

export interface ComposeWire {
	from: string
	fromPort: string
	to: string
	toPort: string
}

export interface ComposePlan {
	updates: ComposeUpdate[]
	add: ComposeAdd[]
	connect: ComposeWire[]
}

/** One reply can advise, fill fields, add nodes, and add wires. */
export interface AssistPlan {
	direction: string
	props: Record<string, unknown>
	updates: ComposeUpdate[]
	add: ComposeAdd[]
	connect: ComposeWire[]
}

export function extractJsonObject(text: string): unknown {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
	const raw = (fenced ? fenced[1] : text).trim()
	const start = raw.indexOf('{')
	const end = raw.lastIndexOf('}')
	if (start < 0 || end <= start) throw new Error('The reply has no JSON object')
	return JSON.parse(raw.slice(start, end + 1))
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanProps(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) return {}
	const props = { ...value }
	delete props.type
	return props
}

function readUpdates(value: unknown): ComposeUpdate[] {
	return (Array.isArray(value) ? value : []).flatMap((item) => {
		if (!isRecord(item) || typeof item.id !== 'string' || !isRecord(item.props)) return []
		return [{ id: item.id, props: cleanProps(item.props) }]
	})
}

function readAdd(value: unknown): ComposeAdd[] {
	return (Array.isArray(value) ? value : []).flatMap((item) => {
		if (!isRecord(item) || typeof item.tempId !== 'string' || typeof item.type !== 'string') return []
		return [
			{
				tempId: item.tempId,
				type: item.type,
				props: cleanProps(item.props),
				x: typeof item.x === 'number' ? item.x : 0,
				y: typeof item.y === 'number' ? item.y : 0,
			},
		]
	})
}

function readConnect(value: unknown): ComposeWire[] {
	return (Array.isArray(value) ? value : []).flatMap((item) => {
		if (!isRecord(item)) return []
		if (typeof item.from !== 'string' || typeof item.to !== 'string') return []
		if (typeof item.fromPort !== 'string' || typeof item.toPort !== 'string') return []
		return [{ from: item.from, fromPort: item.fromPort, to: item.to, toPort: item.toPort }]
	})
}

export function parseFillPlan(text: string): FillPlan {
	const data = extractJsonObject(text)
	const record = isRecord(data) ? data : {}
	const props = isRecord(record.props) ? record.props : record
	if (!isRecord(props)) throw new Error('The reply needs a props object')
	return { props: cleanProps(props) }
}

export function parseComposePlan(text: string): ComposePlan {
	const data = extractJsonObject(text)
	if (!isRecord(data)) throw new Error('The reply needs a JSON object')
	const updates = readUpdates(data.updates)
	const add = readAdd(data.add)
	const connect = readConnect(data.connect)
	if (!updates.length && !add.length && !connect.length) throw new Error('The reply has no changes')
	return { updates, add, connect }
}

const ASSIST_KEYS = new Set(['direction', 'props', 'updates', 'add', 'connect', 'type'])

/** Accept a full plan, or a bare field object from an older reply. */
export function parseAssistPlan(text: string): AssistPlan {
	const data = extractJsonObject(text)
	const record = isRecord(data) ? data : {}
	const direction = typeof record.direction === 'string' ? record.direction.trim() : ''
	let props = cleanProps(record.props)
	if (!Object.keys(props).length && !record.updates && !record.add && !record.connect) {
		props = {}
		for (const [key, value] of Object.entries(record)) {
			if (ASSIST_KEYS.has(key)) continue
			props[key] = value
		}
	}
	return {
		direction,
		props,
		updates: readUpdates(record.updates),
		add: readAdd(record.add),
		connect: readConnect(record.connect),
	}
}

/** Keep only fields the node already has, plus type is never changed. */
export function allowedProps(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
	const next: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(patch)) {
		if (key === 'type') continue
		if (!(key in current)) continue
		next[key] = value
	}
	return next
}
