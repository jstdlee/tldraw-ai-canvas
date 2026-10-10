import { describe, expect, it } from 'vitest'
import { NODE_PORTS } from '../shared/nodeCatalog'
import { NODE_SPECS, specPrompt } from '../shared/nodeSpecs'

describe('NODE_SPECS coverage', () => {
	it('has an entry for every node type in NODE_PORTS', () => {
		const missing = Object.keys(NODE_PORTS).filter((type) => !NODE_SPECS[type])
		expect(missing).toEqual([])
	})

	it('matches NODE_PORTS input/output port ids for every type', () => {
		for (const [type, ports] of Object.entries(NODE_PORTS)) {
			const spec = NODE_SPECS[type]
			expect(spec, type).toBeTruthy()
			const inputIds = new Set(spec.inputs.map((p) => p.id))
			const outputIds = new Set(spec.outputs.map((p) => p.id))
			expect([...inputIds].sort(), `${type} inputs`).toEqual([...ports.in].sort())
			expect([...outputIds].sort(), `${type} outputs`).toEqual([...ports.out].sort())
		}
	})

	it('field keys are a superset of NODE_PORTS fields for every type', () => {
		for (const [type, ports] of Object.entries(NODE_PORTS)) {
			const spec = NODE_SPECS[type]
			const fieldKeys = new Set(spec.fields.map((f) => f.key))
			for (const key of ports.fields) {
				expect(fieldKeys.has(key), `${type}.${key}`).toBe(true)
			}
		}
	})

	it('gives every enum field at least two options', () => {
		for (const spec of Object.values(NODE_SPECS)) {
			for (const field of spec.fields) {
				if (field.kind !== 'enum') continue
				expect(field.options?.length ?? 0, `${spec.type}.${field.key}`).toBeGreaterThanOrEqual(2)
			}
		}
	})

	it('gives every type a non-empty title, purpose and useWhen', () => {
		for (const [type, spec] of Object.entries(NODE_SPECS)) {
			expect(spec.title.trim(), `${type}.title`).not.toBe('')
			expect(spec.purpose.trim(), `${type}.purpose`).not.toBe('')
			expect(spec.useWhen.trim(), `${type}.useWhen`).not.toBe('')
			expect(spec.assistant.role.trim(), `${type}.assistant.role`).not.toBe('')
		}
	})

	it('keeps the full prompt under the token budget', () => {
		expect(specPrompt().length).toBeLessThan(40_000)
	})

	it('can produce a prompt scoped to a subset of types', () => {
		const text = specPrompt(['table', 'chart'])
		expect(text).toContain('table')
		expect(text).toContain('chart')
		expect(text).not.toContain('### prompt —')
	})

	it('includes the DataPipe operation list, with its own parameters, in the table spec text', () => {
		const text = specPrompt(['table'])
		expect(text).toContain('groupby')
		expect(text).toContain('filter')
	})
})
