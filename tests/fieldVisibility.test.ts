import { describe, expect, it } from 'vitest'
import { hiddenDedicatedPortIds, hiddenFieldKeys } from '../client/pipeline/nodes/fieldVisibility'

describe('hiddenFieldKeys', () => {
	it('hides crop x/y/w/h unless aspect is Custom', () => {
		expect([...hiddenFieldKeys({ type: 'crop', aspect: '1:1' } as any)].sort()).toEqual(['h', 'w', 'x', 'y'])
		expect(hiddenFieldKeys({ type: 'crop', aspect: 'Custom' } as any)).toEqual(new Set())
	})

	it('hides image_resize value2 unless mode needs two numbers', () => {
		expect(hiddenFieldKeys({ type: 'image_resize', mode: 'scale' } as any)).toEqual(new Set(['value2']))
		expect(hiddenFieldKeys({ type: 'image_resize', mode: 'fit' } as any)).toEqual(new Set())
		expect(hiddenFieldKeys({ type: 'image_resize', mode: 'exact' } as any)).toEqual(new Set())
	})

	it('hides image_tool "b" for tools without one, and for "look"', () => {
		expect(hiddenFieldKeys({ type: 'image_tool', tool: 'border' } as any)).toEqual(new Set())
		expect(hiddenFieldKeys({ type: 'image_tool', tool: 'pixelate' } as any)).toEqual(new Set(['b']))
		expect(hiddenFieldKeys({ type: 'image_tool', tool: 'look' } as any)).toEqual(new Set(['b']))
	})

	it('hides jev "options" for the yes/no kind', () => {
		expect(hiddenFieldKeys({ type: 'jev', kind: 'noul' } as any)).toEqual(new Set(['options']))
		expect(hiddenFieldKeys({ type: 'jev', kind: 'choice' } as any)).toEqual(new Set())
	})

	it('hides text_ai "promptOverride" when settings are closed, and "option" for custom/no-option ops', () => {
		expect(hiddenFieldKeys({ type: 'text_ai', showSettings: false, operation: 'summarize' } as any)).toEqual(
			new Set(['promptOverride'])
		)
		expect(hiddenFieldKeys({ type: 'text_ai', showSettings: true, operation: 'summarize' } as any)).toEqual(new Set())
		expect(hiddenFieldKeys({ type: 'text_ai', showSettings: true, operation: 'custom' } as any)).toEqual(new Set(['option']))
		expect(hiddenFieldKeys({ type: 'text_ai', showSettings: true, operation: 'fix' } as any)).toEqual(new Set(['option']))
	})

	it('hides file_in action/asText by source, and everything in legacy "path" mode', () => {
		expect(hiddenFieldKeys({ type: 'file_in', mode: 'upload', source: 'upload' } as any)).toEqual(new Set(['asText']))
		expect(hiddenFieldKeys({ type: 'file_in', mode: 'upload', source: 'url' } as any)).toEqual(new Set(['action']))
		expect(hiddenFieldKeys({ type: 'file_in', mode: 'path', source: 'upload' } as any)).toEqual(
			new Set(['source', 'action', 'asText'])
		)
	})

	it('hides nothing for a type with no conditional fields', () => {
		expect(hiddenFieldKeys({ type: 'prompt', text: 'hi' } as any)).toEqual(new Set())
	})
})

describe('hiddenDedicatedPortIds', () => {
	it('hides DataPipe "extra" for an op with no second table', () => {
		expect(hiddenDedicatedPortIds({ type: 'table', op: 'select' } as any)).toEqual(new Set(['extra']))
	})

	it('keeps DataPipe "extra" for an op that uses a second table (e.g. append)', () => {
		expect(hiddenDedicatedPortIds({ type: 'table', op: 'append' } as any)).toEqual(new Set())
	})

	it('hides nothing for a non-table type', () => {
		expect(hiddenDedicatedPortIds({ type: 'prompt' } as any)).toEqual(new Set())
	})
})
