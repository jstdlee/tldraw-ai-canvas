import { describe, expect, it } from 'vitest'
import { buildRewritePrompt, cleanPresets, joinInstructions, REWRITE_PRESETS, rewriteLabel, splitParagraphs } from '../shared/rewrite'
import { changeRanges, diffStats, guessLang, lineRows, lineTokens, markSegments, wordDiff } from '../shared/textDiff'

describe('splitParagraphs', () => {
	it('splits at blank lines and trims', () => {
		expect(splitParagraphs('One.\nStill one.\n\n\n  Two.  \n')).toEqual(['One.\nStill one.', 'Two.'])
	})
	it('keeps a fenced code block with blank lines in one piece', () => {
		const text = 'Intro\n\n```js\na()\n\nb()\n```\n\nEnd'
		expect(splitParagraphs(text)).toEqual(['Intro', '```js\na()\n\nb()\n```', 'End'])
	})
	it('handles a one-line fence and CRLF', () => {
		expect(splitParagraphs('```x```\r\n\r\nNext')).toEqual(['```x```', 'Next'])
	})
	it('returns nothing for blank text', () => {
		expect(splitParagraphs(' \n\n ')).toEqual([])
	})
})

describe('wordDiff', () => {
	it('marks added and removed words', () => {
		const parts = wordDiff('the quick fox', 'the slow fox jumps')
		expect(parts.filter((p) => p.kind === 'del').map((p) => p.text.trim())).toEqual(['quick'])
		expect(parts.filter((p) => p.kind === 'add').map((p) => p.text.trim()).join(' ')).toContain('slow')
		expect(parts.map((p) => (p.kind === 'del' ? '' : p.text)).join('')).toBe('the slow fox jumps')
	})
	it('returns one same part for equal text', () => {
		expect(wordDiff('a b', 'a b')).toEqual([{ kind: 'same', text: 'a b' }])
	})
})

describe('prompt', () => {
	it('joins presets and the note', () => {
		const ins = joinInstructions(REWRITE_PRESETS, ['fix', 'zh', 'nope'], '  keep names  ')
		expect(ins.split('\n')).toHaveLength(3)
		expect(ins).toContain('keep names')
		expect(buildRewritePrompt(ins)).toContain('Return only the revised text')
	})
	it('labels the action for the arrow', () => {
		expect(rewriteLabel(REWRITE_PRESETS, ['shorter', 'en'], '')).toBe('Shorter + → English')
		expect(rewriteLabel(REWRITE_PRESETS, [], 'make it rhyme')).toBe('make it rhyme')
		expect(rewriteLabel(REWRITE_PRESETS, ['fix'], 'keep all product names')).toBe('Fix grammar + “keep all produc…”')
		expect(rewriteLabel(REWRITE_PRESETS, [], '')).toBe('Rewrite')
	})
	it('cleans stored presets', () => {
		expect(cleanPresets('junk')).toBe(REWRITE_PRESETS)
		expect(cleanPresets([])).toBe(REWRITE_PRESETS)
		const mine = [{ id: 'a', label: 'Pirate', prompt: 'Talk like a pirate.' }, { id: 'a', label: 'Dup', prompt: 'x' }, { id: 'b', label: '', prompt: 'no label' }]
		expect(cleanPresets(mine)).toEqual([mine[0]])
	})
})

describe('lineRows', () => {
	it('pairs changed lines and keeps line numbers', () => {
		const rows = lineRows('a\nb\nc', 'a\nB\nc\nd')
		expect(rows.map((r) => r.kind)).toEqual(['same', 'change', 'same', 'add'])
		const change = rows[1] as any
		expect([change.left.n, change.right.n, change.right.text]).toEqual([2, 2, 'B'])
		expect(diffStats(rows)).toEqual({ added: 2, removed: 1 })
	})
	it('folds long unchanged runs into a gap with 3 lines of context', () => {
		const a = Array.from({ length: 20 }, (_, i) => `line ${i}`)
		const b = [...a]
		b[10] = 'changed'
		const rows = lineRows(a.join('\n'), b.join('\n'))
		expect(rows[0].kind).toBe('gap')
		expect(rows.filter((r) => r.kind === 'same')).toHaveLength(6)
		expect(lineRows(a.join('\n'), b.join('\n'), true)).toHaveLength(20)
	})
	it('shows identical text without gaps', () => {
		expect(lineRows('x\ny', 'x\ny').every((r) => r.kind === 'same')).toBe(true)
	})
})

describe('marks and tokens', () => {
	it('marks only the changed words', () => {
		const { left, right } = changeRanges('const total = 1', 'const total = 2')
		expect(left).toEqual([[14, 15]])
		expect(right).toEqual([[14, 15]])
		expect(changeRanges('abc', 'xyz')).toEqual({ left: [], right: [] })
		expect(changeRanges('It have many feature.', 'It has many features.').left).toHaveLength(2)
		expect(changeRanges("console.log('words:', words.length)", "if (!words.length) return b ?? ''")).toEqual({ left: [], right: [] })
		const code = changeRanges("(a ?? '').split(/x/)", "(a ?? '').trim().split(/x/)")
		expect(code.left).toEqual([])
		const marked = code.right.map(([s, e]) => "(a ?? '').trim().split(/x/)".slice(s, e)).join('')
		expect(marked).toHaveLength(7)
		expect(marked).toContain('trim()')
	})
	it('guesses the language', () => {
		expect(guessLang('{"a": 1}')).toBe('json')
		expect(guessLang('def f(x):\n  return x')).toBe('py')
		expect(guessLang('SELECT * FROM t')).toBe('sql')
		expect(guessLang('const a = 1')).toBe('ts')
		expect(guessLang('Hello there.')).toBe('text')
		expect(guessLang('anything', 'py')).toBe('py')
	})
	it('splits tokens per line, keeps multi-line comments coloured, and cuts at marks', () => {
		const lines = lineTokens('/* a\nb */ x = "s"', 'js')
		expect(lines).toHaveLength(2)
		expect(lines[1][0]).toEqual({ kind: 'com', text: 'b */' })
		const segs = markSegments([{ kind: 'name', text: 'total' }], [[1, 3]])
		expect(segs.map((s) => s.text + (s.mark ? '*' : ''))).toEqual(['t', 'ot*', 'al'])
	})
})
