import { describe, expect, it } from 'vitest'
import { computeGroupPorts, type InnerPort, type InnerWire } from '../shared/groupPorts'

function port(nodeId: string, nodeLabel: string, portId: string, terminal: 'start' | 'end', dataType = 'text'): InnerPort {
	return { nodeId, nodeLabel, portId, terminal, dataType }
}

describe('computeGroupPorts', () => {
	it('chain A -> B -> C: inputs are A, outputs are only C', () => {
		const members = ['shape:a', 'shape:b', 'shape:c']
		const ports: InnerPort[] = [
			port('shape:a', 'A', 'text', 'end'),
			port('shape:a', 'A', 'output', 'start'),
			port('shape:b', 'B', 'input', 'end'),
			port('shape:b', 'B', 'output', 'start'),
			port('shape:c', 'C', 'input', 'end'),
			port('shape:c', 'C', 'output', 'start'),
		]
		const wires: InnerWire[] = [
			{ fromNode: 'shape:a', fromPort: 'output', toNode: 'shape:b', toPort: 'input' },
			{ fromNode: 'shape:b', fromPort: 'output', toNode: 'shape:c', toPort: 'input' },
		]
		const { inputs, outputs } = computeGroupPorts(members, ports, wires)
		expect(inputs.map((p) => p.nodeId)).toEqual(['shape:a'])
		expect(inputs[0].portId).toBe('text')
		expect(outputs.map((p) => p.nodeId)).toEqual(['shape:c'])
		expect(outputs[0].portId).toBe('output')
	})

	it('a branch with an extra outside wire from B exposes B\'s output too', () => {
		const members = ['shape:a', 'shape:b', 'shape:c']
		const ports: InnerPort[] = [
			port('shape:a', 'A', 'text', 'end'),
			port('shape:a', 'A', 'output', 'start'),
			port('shape:b', 'B', 'input', 'end'),
			port('shape:b', 'B', 'output', 'start'),
			port('shape:c', 'C', 'input', 'end'),
			port('shape:c', 'C', 'output', 'start'),
		]
		const wires: InnerWire[] = [
			{ fromNode: 'shape:a', fromPort: 'output', toNode: 'shape:b', toPort: 'input' },
			{ fromNode: 'shape:b', fromPort: 'output', toNode: 'shape:c', toPort: 'input' },
			// B's output also feeds something outside the group.
			{ fromNode: 'shape:b', fromPort: 'output', toNode: 'shape:outside', toPort: 'input' },
		]
		const { outputs } = computeGroupPorts(members, ports, wires)
		expect(outputs.map((p) => p.nodeId).sort()).toEqual(['shape:b', 'shape:c'].sort())
	})

	it('13 unwired inputs all appear (no cap)', () => {
		const members = Array.from({ length: 13 }, (_, i) => `shape:n${i}`)
		const ports: InnerPort[] = members.map((id, i) => port(id, `Node ${i}`, 'input', 'end'))
		const { inputs } = computeGroupPorts(members, ports, [])
		expect(inputs).toHaveLength(13)
	})

	it('a wired-from-outside input still counts as an input (both wired and unwired stay usable)', () => {
		const members = ['shape:a']
		const ports: InnerPort[] = [port('shape:a', 'A', 'input', 'end')]
		const wires: InnerWire[] = [{ fromNode: 'shape:outside', fromPort: 'output', toNode: 'shape:a', toPort: 'input' }]
		const { inputs } = computeGroupPorts(members, ports, wires)
		expect(inputs).toHaveLength(1)
	})

	it('ids are stable across calls for the same members', () => {
		const members = ['shape:a', 'shape:b']
		const ports: InnerPort[] = [
			port('shape:a', 'A', 'input', 'end'),
			port('shape:a', 'A', 'output', 'start'),
			port('shape:b', 'B', 'input', 'end'),
		]
		const wires: InnerWire[] = [{ fromNode: 'shape:a', fromPort: 'output', toNode: 'shape:b', toPort: 'input' }]
		const first = computeGroupPorts(members, ports, wires)
		const second = computeGroupPorts(members, ports, wires)
		expect(first).toEqual(second)
		expect(first.inputs[0].id).toBe('i:a:input')
		expect(first.outputs).toHaveLength(0)
	})

	it('labels: a single input/output just uses the node label; multiple add the port id', () => {
		const members = ['shape:a']
		const ports: InnerPort[] = [
			port('shape:a', 'Summarise PDF', 'text', 'end'),
			port('shape:a', 'Summarise PDF', 'style', 'end'),
			port('shape:a', 'Summarise PDF', 'output', 'start'),
		]
		const { inputs, outputs } = computeGroupPorts(members, ports, [])
		expect(inputs.map((p) => p.label)).toEqual(['Summarise PDF · text', 'Summarise PDF · style'])
		expect(outputs.map((p) => p.label)).toEqual(['Summarise PDF'])
	})

	describe('FLOW-05: field ports only join the box when wired from outside', () => {
		it('an unwired field port (a settings control) is dropped, unlike a dedicated port', () => {
			const members = ['shape:a']
			const ports: InnerPort[] = [
				port('shape:a', 'Text tools', 'input', 'end'),
				port('shape:a', 'Text tools', 'input2', 'end'),
				port('shape:a', 'Text tools', 'field:op', 'end'),
				port('shape:a', 'Text tools', 'field:a', 'end'),
				port('shape:a', 'Text tools', 'field:b', 'end'),
				port('shape:a', 'Text tools', 'output', 'start'),
			]
			const { inputs } = computeGroupPorts(members, ports, [])
			// Dedicated ports ("input"/"input2") stay, even unwired; the three settings fields
			// don't — matching the review's "wall of Text to… rows" repro (FLOW-05).
			expect(inputs.map((p) => p.portId).sort()).toEqual(['input', 'input2'])
		})

		it('a field port wired from outside the group still joins the box', () => {
			const members = ['shape:a']
			const ports: InnerPort[] = [port('shape:a', 'Text tools', 'field:op', 'end')]
			const wires: InnerWire[] = [{ fromNode: 'shape:outside', fromPort: 'output', toNode: 'shape:a', toPort: 'field:op' }]
			const { inputs } = computeGroupPorts(members, ports, wires)
			expect(inputs.map((p) => p.portId)).toEqual(['field:op'])
		})

		it('a field port fed by another member stays hidden (rule 1, unchanged)', () => {
			const members = ['shape:a', 'shape:b']
			const ports: InnerPort[] = [
				port('shape:a', 'A', 'output', 'start'),
				port('shape:b', 'B', 'field:op', 'end'),
			]
			const wires: InnerWire[] = [{ fromNode: 'shape:a', fromPort: 'output', toNode: 'shape:b', toPort: 'field:op' }]
			const { inputs } = computeGroupPorts(members, ports, wires)
			expect(inputs).toHaveLength(0)
		})

		it('the exact review repro: Prompt → trim → count packs down from 9 inputs to 3', () => {
			const members = ['shape:trim', 'shape:count']
			const mk = (id: string, label: string) => [
				port(id, label, 'input', 'end'),
				port(id, label, 'input2', 'end'),
				port(id, label, 'field:op', 'end'),
				port(id, label, 'field:a', 'end'),
				port(id, label, 'field:b', 'end'),
				port(id, label, 'output', 'start'),
			]
			const ports: InnerPort[] = [...mk('shape:trim', 'Text tools'), ...mk('shape:count', 'Text tools')]
			const wires: InnerWire[] = [
				{ fromNode: 'shape:prompt', fromPort: 'output', toNode: 'shape:trim', toPort: 'input' },
				{ fromNode: 'shape:trim', fromPort: 'output', toNode: 'shape:count', toPort: 'input' },
			]
			const { inputs, outputs } = computeGroupPorts(members, ports, wires)
			// Before FLOW-05's fix this was 9 (every unwired field on both cards too); now just
			// the dedicated ports that matter: trim's wired "input" + both cards' unwired
			// "input2" (dedicated ports stay regardless of wiring — only fields are filtered).
			expect(inputs.map((p) => p.portId).sort()).toEqual(['input', 'input2', 'input2'].sort())
			expect(outputs).toHaveLength(1)
		})
	})
})
