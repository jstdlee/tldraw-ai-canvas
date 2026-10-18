import { describe, expect, it } from 'vitest'
import { arePortDataTypesCompatible, findFirstCompatiblePort } from '../client/pipeline/ports/portCompatibility'
import type { ShapePort } from '../client/pipeline/ports/Port'

describe('arePortDataTypesCompatible', () => {
	it('allows the same type', () => {
		expect(arePortDataTypesCompatible('text', 'text')).toBe(true)
		expect(arePortDataTypesCompatible('image', 'image')).toBe(true)
	})

	it('allows either side to be "any"', () => {
		expect(arePortDataTypesCompatible('any', 'image')).toBe(true)
		expect(arePortDataTypesCompatible('text', 'any')).toBe(true)
	})

	it('allows a text output into an image input, one way only', () => {
		expect(arePortDataTypesCompatible('text', 'image')).toBe(true)
		expect(arePortDataTypesCompatible('image', 'text')).toBe(false)
	})

	it('allows a text output into a model input, one way only', () => {
		expect(arePortDataTypesCompatible('text', 'model')).toBe(true)
		expect(arePortDataTypesCompatible('model', 'text')).toBe(false)
	})

	it('allows a text output into a number input, one way only (GAPS-11)', () => {
		expect(arePortDataTypesCompatible('text', 'number')).toBe(true)
		expect(arePortDataTypesCompatible('number', 'text')).toBe(false)
	})

	it('rejects other mismatches', () => {
		expect(arePortDataTypesCompatible('number', 'text')).toBe(false)
		expect(arePortDataTypesCompatible('number', 'image')).toBe(false)
	})
})

function port(id: string, terminal: ShapePort['terminal'], dataType: ShapePort['dataType']): ShapePort {
	return { id, x: 0, y: 0, terminal, dataType }
}

describe('findFirstCompatiblePort', () => {
	it('finds an image input for a text source, skipping an incompatible one (dragging from an output)', () => {
		const ports = [port('a', 'end', 'latent'), port('b', 'end', 'image')]
		expect(findFirstCompatiblePort(ports, 'end', 'text')?.id).toBe('b')
	})

	it('finds a number input for a text source (GAPS-11)', () => {
		const ports = [port('a', 'end', 'latent'), port('b', 'end', 'number')]
		expect(findFirstCompatiblePort(ports, 'end', 'text')?.id).toBe('b')
	})

	it('does not find a text input for an image source', () => {
		const ports = [port('a', 'end', 'text')]
		expect(findFirstCompatiblePort(ports, 'end', 'image')).toBeUndefined()
	})

	it('finds an output that can feed a target image input (dataType is the target)', () => {
		// terminal 'start': looking for an output port on the new node that can feed `dataType`.
		const ports = [port('out', 'start', 'text')]
		expect(findFirstCompatiblePort(ports, 'start', 'image')?.id).toBe('out')
	})

	it('does not let an image output feed a text target', () => {
		const ports = [port('out', 'start', 'image')]
		expect(findFirstCompatiblePort(ports, 'start', 'text')).toBeUndefined()
	})
})
