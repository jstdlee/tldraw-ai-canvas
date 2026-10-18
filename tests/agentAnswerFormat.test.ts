import { describe, expect, it } from 'vitest'
import {
	answerFormatInstruction,
	buildReaskTask,
	checkAgentAnswer,
	normalizeAnswerFormat,
} from '../shared/agentAnswerFormat'

describe('normalizeAnswerFormat (old/blank cards = text)', () => {
	it('keeps table and json', () => {
		expect(normalizeAnswerFormat('table')).toBe('table')
		expect(normalizeAnswerFormat('json')).toBe('json')
	})
	it('falls back to text for undefined, empty, or an unknown value', () => {
		expect(normalizeAnswerFormat(undefined)).toBe('text')
		expect(normalizeAnswerFormat(null)).toBe('text')
		expect(normalizeAnswerFormat('')).toBe('text')
		expect(normalizeAnswerFormat('yaml')).toBe('text')
	})
})

describe('answerFormatInstruction', () => {
	it('adds nothing for text', () => {
		expect(answerFormatInstruction('text')).toBeUndefined()
	})
	it('asks for CSV only, for table', () => {
		expect(answerFormatInstruction('table')).toMatch(/CSV/)
	})
	it('asks for JSON only, for json', () => {
		expect(answerFormatInstruction('json')).toMatch(/JSON/)
	})
})

describe('checkAgentAnswer: text (always ok, unchanged)', () => {
	it('passes through anything, even garbage', () => {
		expect(checkAgentAnswer('whatever the model said', 'text')).toEqual({ ok: true, clean: 'whatever the model said' })
	})
})

describe('checkAgentAnswer: table (CSV via parseTableText)', () => {
	it('accepts clean CSV and normalizes it', () => {
		const result = checkAgentAnswer('name,score\nAda,3\nLin,5', 'table')
		expect(result.ok).toBe(true)
		expect(result.clean).toBe('name,score\nAda,3\nLin,5')
	})
	it('accepts a Markdown table (a model habit) and converts it to clean CSV', () => {
		const md = '| name | score |\n| --- | --- |\n| Ada | 3 |\n| Lin | 5 |'
		const result = checkAgentAnswer(md, 'table')
		expect(result.ok).toBe(true)
		expect(result.clean).toBe('name,score\nAda,3\nLin,5')
	})
	it('strips a ```csv fenced block some models still wrap the answer in', () => {
		const fenced = '```csv\nname,score\nAda,3\n```'
		const result = checkAgentAnswer(fenced, 'table')
		expect(result.ok).toBe(true)
		expect(result.clean).toBe('name,score\nAda,3')
	})
	it('rejects prose with no table in it', () => {
		const result = checkAgentAnswer('Sure! Here is my answer: it went well.', 'table')
		expect(result.ok).toBe(false)
		expect(result.error).toBeTruthy()
	})
})

describe('checkAgentAnswer: json (JSON.parse, re-serialized clean)', () => {
	it('accepts a JSON object and re-serializes it', () => {
		const result = checkAgentAnswer('{"a":1,"b":[2,3]}', 'json')
		expect(result.ok).toBe(true)
		expect(JSON.parse(result.clean)).toEqual({ a: 1, b: [2, 3] })
	})
	it('accepts a JSON array', () => {
		const result = checkAgentAnswer('[1,2,3]', 'json')
		expect(result.ok).toBe(true)
		expect(JSON.parse(result.clean)).toEqual([1, 2, 3])
	})
	it('strips a ```json fenced block', () => {
		const result = checkAgentAnswer('```json\n{"ok":true}\n```', 'json')
		expect(result.ok).toBe(true)
		expect(JSON.parse(result.clean)).toEqual({ ok: true })
	})
	it('rejects invalid JSON', () => {
		const result = checkAgentAnswer('{ok: true,}', 'json')
		expect(result.ok).toBe(false)
		expect(result.error).toBeTruthy()
	})
	it('rejects prose around otherwise-valid JSON (the instruction says JSON only)', () => {
		const result = checkAgentAnswer('Sure, here you go: {"ok":true}', 'json')
		expect(result.ok).toBe(false)
	})
})

describe('buildReaskTask', () => {
	it('quotes the previous answer and the problem, and repeats the format instruction', () => {
		const task = buildReaskTask('List two colors.', 'json', 'red and blue', 'Unexpected token r in JSON')
		expect(task).toContain('List two colors.')
		expect(task).toContain('red and blue')
		expect(task).toContain('Unexpected token r in JSON')
		expect(task).toMatch(/JSON/)
	})
})
