import { describe, expect, it } from 'vitest'
import { getAgentScope } from '../shared/agentScope'

describe('getAgentScope (WP44)', () => {
	it('nothing selected is the canvas', () => {
		expect(getAgentScope([])).toEqual({ kind: 'canvas', ids: [], label: 'Canvas' })
	})

	it('one card names the card', () => {
		expect(getAgentScope([{ id: 'a', kind: 'card', title: 'DataPipe' }])).toEqual({ kind: 'card', ids: ['a'], label: 'Card: DataPipe' })
	})

	it('several cards are counted', () => {
		const scope = getAgentScope([
			{ id: 'a', kind: 'card', title: 'A' },
			{ id: 'b', kind: 'card', title: 'B' },
			{ id: 'c', kind: 'card', title: 'C' },
		])
		expect(scope).toEqual({ kind: 'cards', ids: ['a', 'b', 'c'], label: '3 cards' })
	})

	it('cards plus notes are still cards (Build reads the notes)', () => {
		const scope = getAgentScope([
			{ id: 'a', kind: 'card', title: 'A' },
			{ id: 't', kind: 'text' },
		])
		expect(scope.kind).toBe('cards')
		expect(scope.label).toBe('1 card + 1 text')
	})

	it('text shapes are counted', () => {
		expect(getAgentScope([{ id: 'a', kind: 'text' }]).label).toBe('1 text')
		expect(getAgentScope([{ id: 'a', kind: 'text' }, { id: 'b', kind: 'text' }])).toEqual({ kind: 'text', ids: ['a', 'b'], label: '2 texts' })
	})

	it('an image is an image', () => {
		expect(getAgentScope([{ id: 'i', kind: 'image' }])).toEqual({ kind: 'image', ids: ['i'], label: 'Image' })
		expect(getAgentScope([{ id: 'i', kind: 'image' }, { id: 'j', kind: 'image' }]).label).toBe('2 images')
	})

	it('anything else is mixed', () => {
		const scope = getAgentScope([
			{ id: 'a', kind: 'text' },
			{ id: 'b', kind: 'image' },
			{ id: 'c', kind: 'other' },
			{ id: 'd', kind: 'card', title: 'X' },
		])
		expect(scope).toEqual({ kind: 'mixed', ids: ['a', 'b', 'c', 'd'], label: '4 items' })
		expect(getAgentScope([{ id: 'a', kind: 'other' }]).kind).toBe('mixed')
	})
})
