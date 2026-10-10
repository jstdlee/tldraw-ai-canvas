import { describe, expect, it } from 'vitest'
import { CanvasNodeInfo, parseAiPlan, validatePlan } from '../shared/aiPlan'
import { NODE_SPECS } from '../shared/nodeSpecs'

function node(id: string, type: string, inputs: string[], outputs: string[], wiredInputs: string[] = []): CanvasNodeInfo {
	return { id, type, label: type, inputs, outputs, wiredInputs }
}

describe('parseAiPlan', () => {
	it('fills in missing arrays', () => {
		const plan = parseAiPlan('{"summary":"hi"}')
		expect(plan).toEqual({ summary: 'hi', add: [], update: [], wires: [], notes: [] })
	})

	it('reads a fenced JSON reply', () => {
		const plan = parseAiPlan('```json\n{"summary":"ok","add":[{"ref":"n1","type":"prompt","props":{"text":"hi"}}]}\n```')
		expect(plan.add).toEqual([{ ref: 'n1', type: 'prompt', props: { text: 'hi' } }])
	})

	it('reads wires and notes', () => {
		const plan = parseAiPlan(
			'{"wires":[{"from":"a","fromPort":"output","to":"b","toPort":"input"}],"notes":["upload a file"]}'
		)
		expect(plan.wires).toHaveLength(1)
		expect(plan.notes).toEqual(['upload a file'])
	})
})

describe('validatePlan', () => {
	it('passes a valid 3-node plan unchanged', () => {
		const plan = parseAiPlan(
			JSON.stringify({
				summary: 'Load, filter, chart',
				add: [
					{ ref: 'load', type: 'prompt', props: { text: 'a,b\n1,2' } },
					{ ref: 'pipe', type: 'table', props: { op: 'filter', column: 'a', as: '>', with: '0' } },
					{ ref: 'chart', type: 'chart', props: { kind: 'bar', xCol: 'a', yCol: 'b' } },
				],
				update: [],
				wires: [
					{ from: 'load', fromPort: 'output', to: 'pipe', toPort: 'data' },
					{ from: 'pipe', fromPort: 'output', to: 'chart', toPort: 'data' },
				],
				notes: [],
			})
		)
		const { plan: cleaned, errors } = validatePlan(plan, [], NODE_SPECS)
		expect(errors).toEqual([])
		expect(cleaned.add).toHaveLength(3)
		expect(cleaned.wires).toHaveLength(2)
	})

	it('rejects an unknown or hidden node type', () => {
		const plan = parseAiPlan(JSON.stringify({ add: [{ ref: 'n1', type: 'not_a_type', props: {} }] }))
		const { plan: cleaned, errors } = validatePlan(plan, [], NODE_SPECS)
		expect(cleaned.add).toEqual([])
		expect(errors[0]).toMatch(/not_a_type/)

		const hidden = parseAiPlan(JSON.stringify({ add: [{ ref: 'n1', type: 'subgraph', props: {} }] }))
		const result = validatePlan(hidden, [], NODE_SPECS)
		expect(result.plan.add).toEqual([])
		expect(result.errors.length).toBeGreaterThan(0)
	})

	it('rejects a ref that collides with an existing id or another add ref', () => {
		const existing = [node('n1', 'prompt', [], ['output'])]
		const plan = parseAiPlan(
			JSON.stringify({ add: [{ ref: 'n1', type: 'prompt', props: {} }, { ref: 'dup', type: 'prompt', props: {} }, { ref: 'dup', type: 'number', props: {} }] })
		)
		const { plan: cleaned, errors } = validatePlan(plan, existing, NODE_SPECS)
		expect(cleaned.add).toHaveLength(1)
		expect(errors.length).toBeGreaterThanOrEqual(2)
	})

	it('drops unknown prop keys and bad enum/number/boolean values, with an error each', () => {
		const plan = parseAiPlan(
			JSON.stringify({
				add: [
					{
						ref: 'n1',
						type: 'table',
						props: { op: 'not-an-op', columns: 'a', mystery: 'x', text: 123 },
					},
				],
			})
		)
		const { plan: cleaned, errors } = validatePlan(plan, [], NODE_SPECS)
		expect(cleaned.add[0].props).toEqual({ columns: 'a' })
		expect(errors.some((e) => e.includes('op'))).toBe(true)
		expect(errors.some((e) => e.includes('mystery'))).toBe(true)
		expect(errors.some((e) => e.includes('text'))).toBe(true)
	})

	it('rejects an update to a non-existing node', () => {
		const plan = parseAiPlan(JSON.stringify({ update: [{ id: 'ghost', props: { text: 'hi' } }] }))
		const { plan: cleaned, errors } = validatePlan(plan, [], NODE_SPECS)
		expect(cleaned.update).toEqual([])
		expect(errors[0]).toMatch(/ghost/)
	})

	it('validates update props against the existing node\'s own type', () => {
		const existing = [node('n1', 'prompt', [], ['output'])]
		const plan = parseAiPlan(JSON.stringify({ update: [{ id: 'n1', props: { text: 'hello' } }] }))
		const { plan: cleaned, errors } = validatePlan(plan, existing, NODE_SPECS)
		expect(errors).toEqual([])
		expect(cleaned.update[0].props).toEqual({ text: 'hello' })
	})

	it('drops a wire whose endpoints do not exist', () => {
		const plan = parseAiPlan(JSON.stringify({ wires: [{ from: 'ghost1', fromPort: 'output', to: 'ghost2', toPort: 'input' }] }))
		const { plan: cleaned, errors } = validatePlan(plan, [], NODE_SPECS)
		expect(cleaned.wires).toEqual([])
		expect(errors.length).toBe(2)
	})

	it('drops a wire using a port that does not exist on that node', () => {
		const existing = [node('n1', 'prompt', [], ['output']), node('n2', 'output', ['input'], ['output'])]
		const plan = parseAiPlan(JSON.stringify({ wires: [{ from: 'n1', fromPort: 'nope', to: 'n2', toPort: 'input' }] }))
		const { errors } = validatePlan(plan, existing, NODE_SPECS)
		expect(errors.length).toBe(1)
	})

	it('rejects a self-wire', () => {
		const existing = [node('n1', 'if', ['input', 'test'], ['then', 'else'])]
		const plan = parseAiPlan(JSON.stringify({ wires: [{ from: 'n1', fromPort: 'then', to: 'n1', toPort: 'input' }] }))
		const { errors } = validatePlan(plan, existing, NODE_SPECS)
		expect(errors.length).toBe(1)
	})

	it('allows at most one wire into an input, counting existing wires', () => {
		const existing = [
			node('a', 'prompt', [], ['output']),
			node('b', 'prompt', [], ['output']),
			node('c', 'output', ['input'], ['output'], ['input']),
		]
		const plan = parseAiPlan(JSON.stringify({ wires: [{ from: 'b', fromPort: 'output', to: 'c', toPort: 'input' }] }))
		const { plan: cleaned, errors } = validatePlan(plan, existing, NODE_SPECS)
		expect(cleaned.wires).toEqual([])
		expect(errors[0]).toMatch(/already has a wire/)
	})

	it('accepts a var:<name> input port even though it is not in the spec', () => {
		const existing = [node('a', 'prompt', [], ['output']), node('b', 'generate_text', ['input', 'prompt', 'model', 'system', 'params', 'var:city'], ['output'])]
		const plan = parseAiPlan(JSON.stringify({ wires: [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'var:city' }] }))
		const { plan: cleaned, errors } = validatePlan(plan, existing, NODE_SPECS)
		expect(errors).toEqual([])
		expect(cleaned.wires).toHaveLength(1)
	})

	it('rejects an incompatible data type (image output into a plain text-only input is fine; model into image is not)', () => {
		const existing = [node('img', 'load_image', [], ['output']), node('crop', 'crop', ['image'], ['output'])]
		const ok = parseAiPlan(JSON.stringify({ wires: [{ from: 'img', fromPort: 'output', to: 'crop', toPort: 'image' }] }))
		expect(validatePlan(ok, existing, NODE_SPECS).errors).toEqual([])

		const existing2 = [node('model', 'model_source', [], ['model']), node('crop2', 'crop', ['image'], ['output'])]
		const bad = parseAiPlan(JSON.stringify({ wires: [{ from: 'model', fromPort: 'model', to: 'crop2', toPort: 'image' }] }))
		expect(validatePlan(bad, existing2, NODE_SPECS).errors.length).toBe(1)
	})

	it('rejects a wire that would create a cycle when no loop-capable node is involved', () => {
		const existing = [node('a', 'if', ['input', 'test'], ['then', 'else']), node('b', 'output', ['input'], ['output'])]
		const plan = parseAiPlan(
			JSON.stringify({
				wires: [
					{ from: 'a', fromPort: 'then', to: 'b', toPort: 'input' },
					{ from: 'b', fromPort: 'output', to: 'a', toPort: 'input' },
				],
			})
		)
		const { plan: cleaned, errors } = validatePlan(plan, existing, NODE_SPECS)
		expect(cleaned.wires).toHaveLength(1)
		expect(errors.some((e) => e.includes('cycle'))).toBe(true)
	})

	it('allows a cycle through a for_each node', () => {
		const existing = [
			node('loop', 'for_each', ['list', 'result'], ['item', 'output']),
			node('b', 'output', ['input'], ['output']),
		]
		const plan = parseAiPlan(
			JSON.stringify({
				wires: [
					{ from: 'loop', fromPort: 'item', to: 'b', toPort: 'input' },
					{ from: 'b', fromPort: 'output', to: 'loop', toPort: 'result' },
				],
			})
		)
		const { plan: cleaned, errors } = validatePlan(plan, existing, NODE_SPECS)
		expect(errors).toEqual([])
		expect(cleaned.wires).toHaveLength(2)
	})

	it('respects an allowedTypes restriction', () => {
		const plan = parseAiPlan(JSON.stringify({ add: [{ ref: 'n1', type: 'http', props: {} }] }))
		const { plan: cleaned, errors } = validatePlan(plan, [], NODE_SPECS, ['prompt', 'output'])
		expect(cleaned.add).toEqual([])
		expect(errors.length).toBe(1)
	})

	it('never lets a secret-shaped prop through, even if asked for', () => {
		const plan = parseAiPlan(JSON.stringify({ add: [{ ref: 'n1', type: 'http', props: { authValue: 'Bearer xyz', url: 'https://x' } }] }))
		const { plan: cleaned } = validatePlan(plan, [], NODE_SPECS)
		expect(cleaned.add[0].props).toEqual({ url: 'https://x' })
	})
})
