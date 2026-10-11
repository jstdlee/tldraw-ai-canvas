import { describe, expect, it } from 'vitest'
import { getCardDocs, searchCards, blendWithJev, type CardDoc } from '../shared/cardSearch'
import { NODE_CATEGORY, NODE_GROUP_ORDER } from '../shared/nodeGroups'
import { NODE_PORTS } from '../shared/nodeCatalog'

const docs = getCardDocs()

function top(query: string, n = 1) {
	return searchCards(query, docs)
		.slice(0, n)
		.map((r) => r.doc)
}

describe('cardSearch', () => {
	it('"pivot" finds DataPipe · Pivot first', () => {
		expect(top('pivot')[0].id).toBe('table:pivot')
	})

	it('a typo ("pivt") still finds the pivot deep entry', () => {
		const ids = searchCards('pivt', docs)
			.slice(0, 5)
			.map((r) => r.doc.id)
		expect(ids).toContain('table:pivot')
	})

	it('"sum by region" finds Group and summarise', () => {
		expect(top('sum by region')[0].id).toBe('table:groupby')
	})

	it('"plot" finds the Chart card', () => {
		expect(top('plot')[0].type).toBe('chart')
	})

	it('"duck" and "sqlite" both find the Database card (WP13: one card, four sources)', () => {
		expect(top('sqlite')[0].type).toBe('database')
		expect(top('duckdb')[0].type).toBe('database')
	})

	it('has a deep entry for every Database source (WP13)', () => {
		for (const source of ['sqlite', 'pglite', 'postgres', 'duckdb']) {
			expect(docs.some((d) => d.id === `database:${source}`), source).toBe(true)
		}
	})

	it('recency changes the order between otherwise-tied docs', () => {
		const a: CardDoc = { id: 'a', type: 'a', title: 'Widget', group: 'data', description: 'A widget', keywords: [] }
		const b: CardDoc = { id: 'b', type: 'b', title: 'Widget', group: 'data', description: 'A widget', keywords: [] }
		const now = Date.now()
		const ranked = searchCards('widget', [a, b], { recency: { b: { count: 5, last: now } }, now })
		expect(ranked[0].doc.id).toBe('b')
	})

	it('port compatibility hard-filters when requireCompatible is set', () => {
		const a: CardDoc = { id: 'a', type: 'a', title: 'Widget', group: 'data', description: 'A widget', keywords: [] }
		const b: CardDoc = { id: 'b', type: 'b', title: 'Widget', group: 'data', description: 'A widget', keywords: [] }
		const ranked = searchCards('widget', [a, b], {
			compatibleTypes: new Set(['a']),
			requireCompatible: true,
		})
		expect(ranked.map((r) => r.doc.type)).toEqual(['a'])
	})

	it('port compatibility boosts (not filters) without requireCompatible', () => {
		const a: CardDoc = { id: 'a', type: 'a', title: 'Widget', group: 'data', description: 'A widget', keywords: [] }
		const b: CardDoc = { id: 'b', type: 'b', title: 'Widget', group: 'data', description: 'A widget', keywords: [] }
		const ranked = searchCards('widget', [a, b], { compatibleTypes: new Set(['b']) })
		expect(ranked.map((r) => r.doc.type)).toEqual(['b', 'a'])
	})

	it('builds exactly one base doc per card type, plus deep entries from the registries', () => {
		const baseDocIds = new Set(docs.filter((d) => !d.deep).map((d) => d.id))
		for (const type of Object.keys(NODE_PORTS)) {
			if (['adjust', 'number', 'router', 'subgraph', 'url_in', 'postgres'].includes(type)) continue
			expect(baseDocIds.has(type)).toBe(true)
		}
		// Deep entries exist and preset a field.
		const pivotDoc = docs.find((d) => d.id === 'table:pivot')!
		expect(pivotDoc.deep).toEqual({ field: 'op', value: 'pivot' })
		expect(docs.some((d) => d.id === 'chart:bar')).toBe(true)
		expect(docs.some((d) => d.id === 'jev:noul')).toBe(true)
		expect(docs.some((d) => d.id.startsWith('text_tool:'))).toBe(true)
		expect(docs.some((d) => d.id.startsWith('text_ai:'))).toBe(true)
	})

	it('blendWithJev can move JEV\'s pick ahead of a weaker local lead (0.6 local / 0.4 JEV)', () => {
		const a: CardDoc = { id: 'a', type: 'a', title: 'A', group: 'data', description: '', keywords: [] }
		const b: CardDoc = { id: 'b', type: 'b', title: 'B', group: 'data', description: '', keywords: [] }
		// Close local scores: a confident JEV answer decides.
		const close = [
			{ doc: a, score: 10 },
			{ doc: b, score: 8 },
		]
		expect(blendWithJev(close, { a: 0.1, b: 0.9 })[0].doc.id).toBe('b')
		// A card JEV barely likes gets no real boost over a much better local hit.
		const far = [
			{ doc: a, score: 10 },
			{ doc: b, score: 2 },
		]
		expect(blendWithJev(far, { a: 0.95, b: 0.05 })[0].doc.id).toBe('a')
	})
})

describe('nodeGroups', () => {
	it('gives every node type exactly one group', () => {
		for (const type of Object.keys(NODE_PORTS)) {
			expect(NODE_CATEGORY[type]).toBeDefined()
			expect(NODE_GROUP_ORDER).toContain(NODE_CATEGORY[type])
		}
	})

	it('has no stray categories: every assigned group id is a real group', () => {
		for (const group of Object.values(NODE_CATEGORY)) {
			expect(NODE_GROUP_ORDER).toContain(group)
		}
	})
})
