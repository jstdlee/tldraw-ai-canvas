import { describe, expect, it } from 'vitest'
import {
	allowedFieldKeysFor,
	computeFieldOverrides,
	fieldKeyFromPortId,
	fieldPortDataType,
	fieldPortId,
	wirableFields,
	wirableFieldsFor,
} from '../shared/fieldOverrides'
import { NODE_SPECS } from '../shared/nodeSpecs'
import { FieldCoerceError } from '../shared/fieldCoerce'

describe('fieldPortId / fieldKeyFromPortId', () => {
	it('round-trips a key through its port id', () => {
		expect(fieldPortId('text')).toBe('field:text')
		expect(fieldKeyFromPortId('field:text')).toBe('text')
	})

	it('returns null for a non-field port id', () => {
		expect(fieldKeyFromPortId('output')).toBeNull()
		expect(fieldKeyFromPortId('model')).toBeNull()
	})
})

describe('fieldPortDataType', () => {
	it('maps number and model kinds, and treats everything else as text', () => {
		expect(fieldPortDataType('number')).toBe('number')
		expect(fieldPortDataType('model')).toBe('model')
		for (const kind of ['text', 'longtext', 'code', 'sql', 'json', 'url', 'boolean', 'enum'] as const) {
			expect(fieldPortDataType(kind)).toBe('text')
		}
	})
})

describe('wirableFields', () => {
	it('excludes fields marked wire: false (secrets)', () => {
		const http = wirableFields(NODE_SPECS.http)
		expect(http.some((f) => f.key === 'authValue')).toBe(false)
		// "url" already has a dedicated port of the same id, so it's excluded too (no 2nd port).
		expect(http.some((f) => f.key === 'url')).toBe(false)
		expect(http.some((f) => f.key === 'method')).toBe(true)

		const modelSource = wirableFields(NODE_SPECS.model_source)
		expect(modelSource.some((f) => f.key === 'keyRef')).toBe(false)

		const rawModel = wirableFields(NODE_SPECS.raw_model)
		expect(rawModel.some((f) => f.key === 'keyRef')).toBe(false)
	})

	it('excludes a field whose key already has a dedicated input port', () => {
		// image_gen has dedicated ports named "prompt" and "model"; the matching fields
		// must not get a second `field:*` port.
		const imageGen = wirableFields(NODE_SPECS.image_gen)
		expect(imageGen.some((f) => f.key === 'prompt')).toBe(false)
		expect(imageGen.some((f) => f.key === 'model')).toBe(false)
		// "n", "size", "negative", "seed" have no dedicated port, so they stay wirable.
		expect(imageGen.map((f) => f.key).sort()).toEqual(['n', 'negative', 'seed', 'size'])
	})

	it('returns [] for an unknown type', () => {
		expect(wirableFields(undefined)).toEqual([])
	})
})

describe('allowedFieldKeysFor (DataPipe)', () => {
	it('narrows to the current op\'s own params', () => {
		const filter = allowedFieldKeysFor('table', { op: 'filter' })
		expect(filter).toEqual(new Set(['column', 'as', 'with']))
	})

	it('returns undefined (no narrowing) for a non-table type', () => {
		expect(allowedFieldKeysFor('prompt', { op: 'filter' })).toBeUndefined()
	})
})

describe('wirableFieldsFor', () => {
	it('only exposes the active op\'s params for DataPipe', () => {
		const keys = wirableFieldsFor({ type: 'table', op: 'filter' }).map((f) => f.key).sort()
		expect(keys).toEqual(['as', 'column', 'with'])
	})

	it('exposes every wirable field for an ordinary node type', () => {
		const keys = wirableFieldsFor({ type: 'prompt' }).map((f) => f.key)
		expect(keys).toEqual(['text'])
	})
})

describe('computeFieldOverrides', () => {
	it('returns a patch only for wired field ports present in inputs', () => {
		const patch = computeFieldOverrides('prompt', { type: 'prompt', text: 'old' }, { 'field:text': 'new text' })
		expect(patch).toEqual({ text: 'new text' })
	})

	it('ignores unrelated port ids and null values', () => {
		const patch = computeFieldOverrides(
			'prompt',
			{ type: 'prompt', text: 'old' },
			{ output: 'x', 'field:text': null }
		)
		expect(patch).toEqual({})
	})

	it('only overrides the current op\'s params for DataPipe, ignoring other op fields', () => {
		const node = { type: 'table', op: 'filter', column: 'a', as: '>', with: '0', name: 'unused' }
		const patch = computeFieldOverrides('table', node, {
			'field:with': '5',
			'field:name': 'ignored, not a filter param',
		})
		expect(patch).toEqual({ with: '5' })
	})

	it('coerces a wired number field and throws a FieldCoerceError on bad input', () => {
		// image_resize "value" is a number field with no dedicated port.
		expect(() =>
			computeFieldOverrides('image_resize', { type: 'image_resize', value: 100 }, { 'field:value': 'not a number' })
		).toThrow(FieldCoerceError)
		expect(computeFieldOverrides('image_resize', { type: 'image_resize', value: 100 }, { 'field:value': '50' })).toEqual({
			value: 50,
		})
	})

	it('never overrides a secret field even if a matching port id is passed', () => {
		const patch = computeFieldOverrides(
			'http',
			{ type: 'http', authValue: '' },
			{ 'field:authValue': 'sneaky' }
		)
		expect(patch).toEqual({})
	})
})
