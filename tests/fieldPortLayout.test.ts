import { describe, expect, it } from 'vitest'
import { layoutPorts, PortCandidate } from '../shared/fieldPortLayout'

const OUTPUT: PortCandidate = { id: 'output', x: 320, y: 20, terminal: 'start', dataType: 'text' }

describe('layoutPorts', () => {
	it('uses the anchor when registered, by id', () => {
		const candidates: PortCandidate[] = [OUTPUT, { id: 'url', x: 0, y: 66, terminal: 'end', dataType: 'text' }]
		const result = layoutPorts(candidates, { url: 88 }, 20)
		expect(result.url.y).toBe(88)
		expect(result.output).toEqual(OUTPUT)
	})

	it('falls back to the hand-coded y when no anchor is registered (before first render)', () => {
		const candidates: PortCandidate[] = [{ id: 'url', x: 0, y: 66, terminal: 'end', dataType: 'text' }]
		const result = layoutPorts(candidates, undefined, 20)
		expect(result.url.y).toBe(66)
	})

	it('uses anchorKey (field ports are anchored by their bare key, not the prefixed port id)', () => {
		const candidates: PortCandidate[] = [
			{ id: 'field:method', anchorKey: 'method', x: 0, y: 20, terminal: 'end', dataType: 'text' },
		]
		const result = layoutPorts(candidates, { method: 66 }, 20)
		expect(result['field:method'].y).toBe(66)
	})

	it('drops a hidden, unwired port entirely', () => {
		const candidates: PortCandidate[] = [
			{ id: 'field:x', anchorKey: 'x', x: 0, y: 20, terminal: 'end', dataType: 'number', hidden: true, wired: false },
		]
		const result = layoutPorts(candidates, undefined, 20)
		expect(result['field:x']).toBeUndefined()
	})

	it('keeps a hidden but wired port, placed at the fallback y', () => {
		const candidates: PortCandidate[] = [
			{ id: 'field:x', anchorKey: 'x', x: 0, y: 20, terminal: 'end', dataType: 'number', hidden: true, wired: true },
		]
		const result = layoutPorts(candidates, undefined, 20)
		expect(result['field:x']).toEqual({ id: 'field:x', x: 0, y: 20, terminal: 'end', dataType: 'number' })
	})

	it('stacks several hidden-but-wired ports 8px apart, never sharing a point', () => {
		const candidates: PortCandidate[] = [
			{ id: 'field:x', x: 0, y: 20, terminal: 'end', dataType: 'number', hidden: true, wired: true },
			{ id: 'field:y', x: 0, y: 20, terminal: 'end', dataType: 'number', hidden: true, wired: true },
			{ id: 'field:w', x: 0, y: 20, terminal: 'end', dataType: 'number', hidden: true, wired: true },
		]
		const result = layoutPorts(candidates, undefined, 20)
		expect(result['field:x'].y).toBe(20)
		expect(result['field:y'].y).toBe(28)
		expect(result['field:w'].y).toBe(36)
	})

	it('ignores `hidden` for a start (output) port', () => {
		// Output ports never set `hidden`, but if one did, treating it like an input would be
		// wrong — this just documents that `hidden` is an input-only concept in practice.
		const candidates: PortCandidate[] = [{ ...OUTPUT, hidden: false }]
		const result = layoutPorts(candidates, undefined, 20)
		expect(result.output.y).toBe(20)
	})
})
