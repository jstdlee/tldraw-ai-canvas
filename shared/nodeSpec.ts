/**
 * A node described as data. A model returns this JSON; the app turns it into a
 * Code node with the named inputs and outputs.
 */

import { isIdentifier, MAX_CODE_PORTS } from './codePorts'

export interface NodeSpec {
	title: string
	inputs: string[]
	outputs: string[]
	code: string
	lang: 'ts' | 'py'
}

export const NODE_SPEC_PROMPT =
	'Design one workflow node from the request. Reply with only JSON: ' +
	'{"title": string, "inputs": string[], "outputs": string[], "lang": "ts" | "py", "code": string}. ' +
	`inputs and outputs are variable names (letters, digits, underscore; at most ${MAX_CODE_PORTS} each). ` +
	'For ts, code is: export default async function run({ <inputs> }) { ... } and it returns one value, ' +
	'or an object keyed by the output names when there are several outputs. ' +
	'For py, code defines run(inputs) the same way. Inputs arrive as strings. No imports, no network.'

function names(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return fallback
	const seen = new Set<string>()
	const result: string[] = []
	for (const item of value) {
		const name = String(item ?? '').trim().replace(/[^\w$]/g, '_')
		if (!name || !isIdentifier(name) || seen.has(name)) continue
		seen.add(name)
		result.push(name)
		if (result.length >= MAX_CODE_PORTS) break
	}
	return result.length ? result : fallback
}

export function parseNodeSpec(reply: string): NodeSpec {
	const start = reply.indexOf('{')
	const end = reply.lastIndexOf('}')
	if (start < 0 || end <= start) throw new Error('The model did not return a node description')
	let raw: Record<string, unknown>
	try {
		raw = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>
	} catch {
		throw new Error('The model returned JSON that could not be read')
	}
	const code = typeof raw.code === 'string' ? raw.code.trim() : ''
	if (!code) throw new Error('The node description has no code')
	return {
		title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 60) : 'Built node',
		inputs: names(raw.inputs, ['input']),
		outputs: names(raw.outputs, ['output']),
		code: code + '\n',
		lang: raw.lang === 'py' || raw.lang === 'python' ? 'py' : 'ts',
	}
}
