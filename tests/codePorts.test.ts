import { describe, expect, it } from 'vitest'
import {
	clampCodeCount,
	codeInputId,
	codeInputNames,
	codeOutputId,
	codeOutputNames,
	cleanCodeName,
	defaultInputName,
	defaultOutputName,
	MAX_CODE_PORTS,
} from '../shared/codePorts'

describe('code node ports', () => {
	it('clamps counts to 1–20', () => {
		expect(clampCodeCount(0)).toBe(1)
		expect(clampCodeCount(1)).toBe(1)
		expect(clampCodeCount(7)).toBe(7)
		expect(clampCodeCount(99)).toBe(MAX_CODE_PORTS)
		expect(clampCodeCount(Number('x'))).toBe(1)
	})

	it('uses stable, rename-safe port ids', () => {
		expect(codeInputId(0)).toBe('in1')
		expect(codeInputId(19)).toBe('in20')
		// First output keeps the legacy id so old canvases keep their wires.
		expect(codeOutputId(0)).toBe('output')
		expect(codeOutputId(1)).toBe('out2')
		expect(codeOutputId(19)).toBe('out20')
	})

	it('defaults input names to a, b, c… and outputs to their ids', () => {
		expect(codeInputNames(3, undefined)).toEqual(['a', 'b', 'c'])
		expect(defaultInputName(0)).toBe('a')
		expect(codeOutputNames(2, undefined)).toEqual(['output', 'out2'])
		expect(defaultOutputName(0)).toBe('output')
	})

	it('accepts valid custom variable names and rejects bad ones', () => {
		expect(cleanCodeName('total')).toBe('total')
		expect(cleanCodeName('_x1')).toBe('_x1')
		expect(cleanCodeName('$sum')).toBe('$sum')
		expect(cleanCodeName('1abc')).toBeNull()
		expect(cleanCodeName('has space')).toBeNull()
		expect(cleanCodeName('a-b')).toBeNull()
		expect(cleanCodeName('')).toBeNull()
		expect(cleanCodeName(undefined)).toBeNull()
	})

	it('falls back to the default name for invalid or missing custom names', () => {
		expect(codeInputNames(3, ['total', '1bad', undefined])).toEqual(['total', 'b', 'c'])
		expect(codeOutputNames(3, ['sum', '', 'result'])).toEqual(['sum', 'out2', 'result'])
	})

	it('only makes as many names as the clamped count', () => {
		expect(codeInputNames(2, ['x', 'y', 'z', 'w'])).toEqual(['x', 'y'])
		expect(codeInputNames(25, undefined)).toHaveLength(MAX_CODE_PORTS)
	})
})
