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

export function parseFillPlan(text: string): FillPlan {
	const data = extractJsonObject(text)
	const record = isRecord(data) ? data : {}
	const props = isRecord(record.props) ? record.props : record
	if (!isRecord(props)) throw new Error('The reply needs a props object')
	const clean = { ...props }
	delete clean.type
	return { props: clean }
}

export function parseComposePlan(text: string): ComposePlan {
	const data = extractJsonObject(text)
	if (!isRecord(data)) throw new Error('The reply needs a JSON object')
	const updates = (Array.isArray(data.updates) ? data.updates : []).flatMap((item) => {
		if (!isRecord(item) || typeof item.id !== 'string' || !isRecord(item.props)) return []
		const props = { ...item.props }
		delete props.type
		return [{ id: item.id, props }]
	})
	const add = (Array.isArray(data.add) ? data.add : []).flatMap((item) => {
		if (!isRecord(item) || typeof item.tempId !== 'string' || typeof item.type !== 'string') return []
		return [
			{
				tempId: item.tempId,
				type: item.type,
				props: isRecord(item.props) ? item.props : {},
				x: typeof item.x === 'number' ? item.x : 0,
				y: typeof item.y === 'number' ? item.y : 0,
			},
		]
	})
	const connect = (Array.isArray(data.connect) ? data.connect : []).flatMap((item) => {
		if (!isRecord(item)) return []
		if (typeof item.from !== 'string' || typeof item.to !== 'string') return []
		if (typeof item.fromPort !== 'string' || typeof item.toPort !== 'string') return []
		return [{ from: item.from, fromPort: item.fromPort, to: item.to, toPort: item.toPort }]
	})
	if (!updates.length && !add.length && !connect.length) throw new Error('The reply has no changes')
	return { updates, add, connect }
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
