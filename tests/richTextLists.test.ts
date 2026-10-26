import { describe, expect, it } from 'vitest'
import { toRichText } from '@tldraw/tlschema'
import {
	countTasks,
	richTextToPlain,
	setListKind,
	textToRichText,
	toggleTaskAt,
	type RTNode,
} from '../shared/richTextLists'

describe('textToRichText', () => {
	it('matches toRichText when there are no list lines', () => {
		for (const t of ['Hello', 'a\nb', 'Line 1\n\nLine 3', '', '-not a bullet', '2024 was good']) {
			expect(textToRichText(t)).toEqual(toRichText(t))
		}
	})

	it('makes bullets, numbers and checklists', () => {
		const doc = textToRichText('Title\n- a\n- b\n1. one\n2. two\n- [ ] todo\n- [x] done')
		expect(doc.content.map((b) => b.type)).toEqual(['paragraph', 'bulletList', 'orderedList', 'taskList'])
		const tasks = doc.content[3].content!
		expect(tasks.map((t: RTNode) => t.attrs?.checked)).toEqual([false, true])
		expect(tasks[0].type).toBe('taskItem')
	})

	it('keeps the start number of an ordered list', () => {
		const doc = textToRichText('3. c\n4. d')
		expect(doc.content[0].attrs?.start).toBe(3)
	})

	it('nests deeper lines under the item above', () => {
		const doc = textToRichText('- a\n  - a1\n  - a2\n- b')
		const list = doc.content[0]
		expect(list.content).toHaveLength(2)
		expect(list.content![0].content!.map((c: RTNode) => c.type)).toEqual(['paragraph', 'bulletList'])
		expect(list.content![0].content![1].content).toHaveLength(2)
	})

	it('accepts a bare [ ] box and • bullets', () => {
		const doc = textToRichText('[ ] x\n[X] y\n• z')
		expect(doc.content.map((b) => b.type)).toEqual(['taskList', 'bulletList'])
		expect(doc.content[0].content![1].attrs?.checked).toBe(true)
	})
})

describe('richTextToPlain', () => {
	it('round-trips list text', () => {
		const text = 'Plan\n- a\n  - a1\n- b\n\n1. one\n2. two\n- [ ] todo\n- [x] done'
		expect(richTextToPlain(textToRichText(text))).toBe(text)
	})

	it('reads plain paragraphs like tldraw does', () => {
		expect(richTextToPlain(toRichText('a\n\nb'))).toBe('a\n\nb')
		expect(richTextToPlain({ type: 'doc', content: [] })).toBe('')
	})
})

describe('setListKind', () => {
	it('turns paragraphs into a checklist and back', () => {
		const doc = toRichText('a\nb\n\nc')
		const tasks = setListKind(doc, 'task')
		expect(richTextToPlain(tasks)).toBe('- [ ] a\n- [ ] b\n\n- [ ] c')
		expect(richTextToPlain(setListKind(tasks, null))).toBe('a\nb\n\nc')
	})

	it('switches list kinds and keeps nesting', () => {
		const doc = textToRichText('- a\n  - a1\n- b')
		expect(richTextToPlain(setListKind(doc, 'ordered'))).toBe('1. a\n  1. a1\n2. b')
	})

	it('keeps checked state when a checklist goes through bullets', () => {
		const doc = textToRichText('- [x] a')
		expect(richTextToPlain(setListKind(setListKind(doc, 'task'), 'task'))).toBe('- [x] a')
	})
})

describe('toggleTaskAt', () => {
	it('flips one checkbox in document order, nested included', () => {
		const doc = textToRichText('- [ ] a\n  - [ ] a1\n- [ ] b')
		const next = toggleTaskAt(doc, 1)
		expect(richTextToPlain(next)).toBe('- [ ] a\n  - [x] a1\n- [ ] b')
		expect(richTextToPlain(doc)).toBe('- [ ] a\n  - [ ] a1\n- [ ] b')
		expect(countTasks(next)).toEqual({ done: 1, total: 3 })
	})
})
