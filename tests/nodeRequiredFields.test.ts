import { describe, expect, it } from 'vitest'
import { NodeDefinitions } from '../client/pipeline/nodes/registry'
import { withNodeDefaults } from '../client/pipeline/nodes/definitionStore'
import FROZEN from './nodeRequiredFields.json'

/**
 * Saved canvases store node values as they were. The node shape migration in
 * NodeShapeUtil.tsx (FillRequiredNodeFields) fills required fields that an old save misses,
 * but each migration step runs once per saved canvas. So a required field added later must
 * come with a new migration step, or old canvases fail on start-up with
 * "props.node(type = …).<field>: Expected …, got undefined".
 *
 * nodeRequiredFields.json is the set of required fields as of the last migration step.
 */
type Config = Record<string, { validate(value: unknown): unknown }>

function requiredKeys(validator: unknown): string[] {
	const config = (validator as { config?: Config }).config
	if (!config) return []
	return Object.keys(config)
		.filter((key) => {
			try {
				config[key].validate(undefined)
				return false
			} catch {
				return true
			}
		})
		.sort()
}

const definitions = Object.values(NodeDefinitions) as unknown as { type: string; validator: { validate(v: unknown): unknown } }[]

describe('node required fields vs the node shape migration', () => {
	it('no node type has a required field that the last migration step does not know', () => {
		const frozen = FROZEN as Record<string, string[]>
		const added: string[] = []
		for (const def of definitions) {
			const known = new Set(frozen[def.type] ?? [])
			for (const key of requiredKeys(def.validator)) if (!known.has(key)) added.push(`${def.type}.${key}`)
		}
		expect(
			added,
			'New required node fields. Make them .optional(), or add a migration step in NodeShapeUtil.tsx ' +
				'and then add them to tests/nodeRequiredFields.json.'
		).toEqual([])
	})

	it('a node saved with only its type is valid after withNodeDefaults', () => {
		const failed: string[] = []
		for (const def of definitions) {
			try {
				def.validator.validate(withNodeDefaults({ type: def.type }))
			} catch (e) {
				failed.push(`${def.type}: ${(e as Error).message}`)
			}
		}
		expect(failed).toEqual([])
	})

	it('withNodeDefaults keeps saved values and leaves optional fields absent', () => {
		const chart = withNodeDefaults({ type: 'chart', kind: 'line', xCol: 'a' } as Record<string, unknown> & { type: string })
		expect(chart.kind).toBe('line')
		expect(chart.xCol).toBe('a')
		expect(chart.dualScale).toBe(false)
		expect('series' in chart).toBe(false)
	})
})
