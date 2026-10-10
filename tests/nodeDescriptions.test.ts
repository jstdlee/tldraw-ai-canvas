import { describe, expect, it } from 'vitest'
import { NODE_PORTS } from '../shared/nodeCatalog'
import { NODE_DESCRIPTIONS } from '../shared/nodeDescriptions'

describe('NODE_DESCRIPTIONS coverage', () => {
	it('has an entry for every node type in NODE_PORTS', () => {
		const missing = Object.keys(NODE_PORTS).filter((type) => !NODE_DESCRIPTIONS[type])
		expect(missing).toEqual([])
	})

	it('has no stray entries for a type NODE_PORTS does not know', () => {
		const extra = Object.keys(NODE_DESCRIPTIONS).filter((type) => !(type in NODE_PORTS))
		expect(extra).toEqual([])
	})

	it('gives every entry a non-empty title, description and keyword list', () => {
		for (const [type, entry] of Object.entries(NODE_DESCRIPTIONS)) {
			expect(entry.title.trim(), `${type}.title`).not.toBe('')
			expect(entry.description.trim(), `${type}.description`).not.toBe('')
			expect(entry.keywords.length, `${type}.keywords`).toBeGreaterThan(0)
		}
	})
})
