import { describe, expect, it } from 'vitest'
import { filterLibrary, type LibraryEntry } from '../shared/libraryFilter'

const defs: LibraryEntry[] = [
	{ type: 'chart', title: 'Chart', category: 'data' },
	{ type: 'prompt', title: 'Prompt', category: 'input' },
	{ type: 'text_tool', title: 'Text tools', category: 'text' },
	{ type: 'file_in', title: 'File in', category: 'input' },
	{ type: 'if', title: 'If / else', category: 'logic' },
]

describe('filterLibrary', () => {
	it('returns every node when the query is empty', () => {
		expect(filterLibrary(defs, '')).toEqual(defs)
		expect(filterLibrary(defs, '   ')).toEqual(defs)
	})

	it('matches the title, ignoring case', () => {
		expect(filterLibrary(defs, 'chArT').map((def) => def.type)).toEqual(['chart'])
	})

	it('matches the type id', () => {
		expect(filterLibrary(defs, 'file_in').map((def) => def.type)).toEqual(['file_in'])
		expect(filterLibrary(defs, 'prompt').map((def) => def.type)).toEqual(['prompt'])
	})

	it('matches the category label', () => {
		expect(filterLibrary(defs, 'logic').map((def) => def.type)).toEqual(['if'])
		expect(filterLibrary(defs, 'DATA').map((def) => def.type)).toEqual(['chart'])
	})

	it('finds pdf, json, and chart', () => {
		expect(filterLibrary(defs, 'pdf').map((def) => def.type)).toEqual(['file_in'])
		expect(filterLibrary(defs, 'json').map((def) => def.type)).toEqual(['text_tool'])
		expect(filterLibrary(defs, 'chart').map((def) => def.type)).toEqual(['chart'])
	})
})
