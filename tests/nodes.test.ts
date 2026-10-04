import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { detectContentKind } from '../shared/contentKind'
import { evaluateCondition, isTruthy, splitItems } from '../shared/logic'
import { compileCode, extractCode } from '../client/pipeline/codeRunner'

describe('logic', () => {
	it('treats common "no" values as false', () => {
		for (const v of ['', 'false', 'No', '0', 'off', null, undefined, 0]) expect(isTruthy(v as any)).toBe(false)
		for (const v of ['yes', 'true', 'anything', 1, '0.5']) expect(isTruthy(v as any)).toBe(true)
	})
	it('evaluates If conditions', () => {
		expect(evaluateCondition('Hello World', 'contains', 'world')).toBe(true)
		expect(evaluateCondition(' yes ', 'equals', 'YES')).toBe(true)
		expect(evaluateCondition('1,200', 'gt', '1000')).toBe(true)
		expect(evaluateCondition('abc123', 'regex', '\\d{3}')).toBe(true)
		expect(evaluateCondition('/api/images/x', 'is_image', '')).toBe(true)
		expect(evaluateCondition('{"a":1}', 'is_json', '')).toBe(true)
		expect(evaluateCondition('', 'empty', '')).toBe(true)
		expect(evaluateCondition('x', 'regex', '([')).toBe(false)
	})
	it('splits For each lists', () => {
		expect(splitItems('a\n\n b \nc', 'lines', '')).toEqual(['a', 'b', 'c'])
		expect(splitItems('a; b;;c', 'separator', ';')).toEqual(['a', 'b', 'c'])
		expect(splitItems('p1\nmore\n\np2', 'paragraphs', '')).toEqual(['p1\nmore', 'p2'])
		expect(splitItems('[1,"two",{"x":3}]', 'json', '')).toEqual(['1', 'two', '{"x":3}'])
		expect(splitItems('id=4 id=7', 'regex', 'id=(\\d)')).toEqual(['4', '7'])
		expect(() => splitItems('{"a":1}', 'json', '')).toThrow('not a JSON array')
	})
})

describe('content kinds (Output node)', () => {
	it('detects what to show', () => {
		expect(detectContentKind('/api/images/img_1')).toBe('image')
		expect(detectContentKind('https://example.com/cat.png?x=1')).toBe('image')
		expect(detectContentKind('https://example.com/page')).toBe('url')
		expect(detectContentKind('flowchart LR\n A-->B')).toBe('mermaid')
		expect(detectContentKind('{"a": [1, 2]}')).toBe('json')
		expect(detectContentKind('# Title\n- item')).toBe('markdown')
		expect(detectContentKind('just words')).toBe('text')
	})
})

describe('code node', () => {
	it('compiles TypeScript with export default to runnable code', () => {
		const js = compileCode(
			'export default async function run({ a }: Record<string, string>): Promise<string> { return a.toUpperCase() }',
			'ts'
		)
		const module: { exports: any } = { exports: {} }
		new Function('module', 'exports', js)(module, module.exports)
		return module.exports.default({ a: 'hi' }).then((v: string) => expect(v).toBe('HI'))
	})
	it('pulls code out of a model reply', () => {
		expect(extractCode('Here you go:\n```ts\nexport default () => 1\n```\nEnjoy')).toBe('export default () => 1\n')
		expect(extractCode('export default () => 2')).toBe('export default () => 2\n')
	})
})
