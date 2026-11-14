import { describe, expect, it } from 'vitest'
import { compileCode } from '../client/pipeline/codeRunner'
import {
	clampCodeTimeoutSec,
	CODE_DEFAULT_TIMEOUT_SEC,
	formatCodeError,
	jsErrorLine,
	pythonErrorInfo,
	syntaxErrorInfo,
} from '../shared/codeRun'
import { decisionProblem, detectMode, parseDecision, routeDecision, yesProbabilityFromText } from '../shared/decisionRoute'
import { clampMaxIterations, evaluateCondition, isTruthy, runWhileLoop, WHILE_DEFAULT_MAX, WHILE_HARD_MAX } from '../shared/logic'
import { pythonProgram, readPythonLogs } from '../shared/pythonSource'

/** WP45: control-flow and Code card fixes (pure parts). */

describe('isTruthy (WP45)', () => {
	it('reads a zero written as text as false', () => {
		for (const v of ['0.0', '-0', '0e3', ' 0.00 ']) expect(isTruthy(v)).toBe(false)
		for (const v of ['0.5', '-1', '1e3']) expect(isTruthy(v)).toBe(true)
	})
	it('reads an empty JSON list or object as false', () => {
		expect(isTruthy('[]')).toBe(false)
		expect(isTruthy(' {} ')).toBe(false)
		expect(isTruthy('[0]')).toBe(true)
	})
})

describe('evaluateCondition (WP45)', () => {
	it('an empty value is not a number: it fails every number test', () => {
		for (const c of ['lt', 'lte', 'gt', 'gte']) expect(evaluateCondition('', c, '5')).toBe(false)
		expect(evaluateCondition('', 'between', '-1,1')).toBe(false)
	})
	it('equals compares numbers as numbers, text as text', () => {
		expect(evaluateCondition('5', 'equals', '5.0')).toBe(true)
		expect(evaluateCondition('1,000', 'equals', '1000')).toBe(true)
		expect(evaluateCondition('5', 'not_equals', '5.0')).toBe(false)
		expect(evaluateCondition('Yes', 'equals', 'yes')).toBe(true)
	})
})

describe('While loop (WP45)', () => {
	const double = async (value: string) => String(Number(value) * 2)

	it('runs while the condition holds and reports the last value and the count', async () => {
		const out = await runWhileLoop({ initial: '3', test: (v) => evaluateCondition(v, 'lt', '100'), max: 100, body: double })
		expect(out).toEqual({ value: '192', count: 6, end: 'condition' })
	})
	it('never runs the body when the start value fails the condition', async () => {
		const out = await runWhileLoop({ initial: '500', test: (v) => evaluateCondition(v, 'lt', '100'), max: 100, body: double })
		expect(out).toEqual({ value: '500', count: 0, end: 'condition' })
	})
	it('ends at Max iterations', async () => {
		const out = await runWhileLoop({ initial: '1', test: () => true, max: 5, body: async (v) => v + '!' })
		expect(out).toEqual({ value: '1!!!!!', count: 5, end: 'max' })
	})
	it('passes the 1-based iteration number to the body', async () => {
		const seen: number[] = []
		await runWhileLoop({ initial: 'x', test: () => true, max: 3, body: async (v, i) => (seen.push(i), v) })
		expect(seen).toEqual([1, 2, 3])
	})
	it('a pass with no result ends the loop (break), or fails with noResult: "error"', async () => {
		const body = async (v: string, i: number) => (i === 3 ? null : v + i)
		expect(await runWhileLoop({ initial: 'a', test: () => true, max: 10, body })).toEqual({ value: 'a12', count: 3, end: 'no_result' })
		await expect(runWhileLoop({ initial: 'a', test: () => true, max: 10, body, noResult: 'error' })).rejects.toThrow('Iteration 3')
	})
	it('a body error stops the loop', async () => {
		await expect(
			runWhileLoop({ initial: '1', test: () => true, max: 10, body: async () => { throw new Error('boom') } })
		).rejects.toThrow('boom')
	})
	it('clamps Max iterations to 1..10000, default 100', () => {
		expect(clampMaxIterations(undefined)).toBe(WHILE_DEFAULT_MAX)
		expect(clampMaxIterations('')).toBe(WHILE_DEFAULT_MAX)
		expect(clampMaxIterations(0)).toBe(1)
		expect(clampMaxIterations(-5)).toBe(1)
		expect(clampMaxIterations(7.9)).toBe(7)
		expect(clampMaxIterations(1e9)).toBe(WHILE_HARD_MAX)
		expect(WHILE_HARD_MAX).toBe(10000)
	})
})

describe('Decision switch reads (WP45)', () => {
	const route = (mode: 'auto' | 'noul' | 'choice' | 'score', decisionRaw: string) =>
		routeDecision({ mode, decisionRaw, value: null, threshold: 0.5, margin: 0, optionsText: '', bandsText: 'low: 0.33\nmid: 0.66\nhigh' })

	it('true / false and y / n are yes / no', () => {
		expect(detectMode(parseDecision('true'))).toBe('noul')
		expect(detectMode(parseDecision('False'))).toBe('noul')
		expect(route('auto', 'true').chosenPortId).toBe('yes')
		expect(route('auto', 'false').chosenPortId).toBe('no')
		expect(route('noul', 'y').chosenPortId).toBe('yes')
		expect(route('noul', 'N').chosenPortId).toBe('no')
	})
	it('yes/no mode reads a number as P(yes): 0..1, or 0..100 as a percent', () => {
		expect(yesProbabilityFromText('0.8')).toBeCloseTo(0.8)
		expect(yesProbabilityFromText('75')).toBeCloseTo(0.75)
		expect(yesProbabilityFromText('banana')).toBeNull()
		expect(route('noul', '0.8').chosenPortId).toBe('yes')
		expect(route('noul', '20').chosenPortId).toBe('no')
	})
	it('auto mode reads a plain number as a score, not as a choice named "0_8"', () => {
		const r = route('auto', '0.8')
		expect(r.resolvedMode).toBe('score')
		expect(r.chosenPortId).toBe('band:high')
	})
	it('explains an empty or unreadable decision', () => {
		expect(decisionProblem('', route('auto', ''))).toMatch(/empty/)
		expect(decisionProblem('banana', route('noul', 'banana'))).toMatch(/Yes\/no mode cannot read "banana"/)
		expect(decisionProblem('{"a":0.1,"b":0.9}', route('noul', '{"a":0.1,"b":0.9}'))).toMatch(/Yes\/no mode/)
		expect(decisionProblem('yes', route('score', 'yes'))).toMatch(/Score mode needs a number/)
		expect(decisionProblem('yes', route('auto', 'yes'))).toBeNull()
	})
})

describe('Code card errors and time limit (WP45)', () => {
	it('maps a runtime error back to the line the user wrote, TypeScript types included', () => {
		const source = [
			'// line 1',
			'type Inputs = Record<string, string>',
			'export default function run({ a }: Inputs) {',
			'  const x: number = 1',
			'  return (a as any).nope.deeper',
			'}',
			'',
		].join('\n')
		const code = compileCode(source, 'ts')
		const mod: { exports: Record<string, unknown> } = { exports: {} }
		new Function('module', 'exports', code)(mod, mod.exports)
		let stack = ''
		try {
			;(mod.exports.default as (i: Record<string, string>) => unknown)({ a: 'x' })
		} catch (e) {
			stack = (e as Error).stack ?? ''
		}
		expect(jsErrorLine(stack)).toBe(5)
	})
	it('reads the line of a syntax error', () => {
		let message = ''
		try {
			compileCode('export default function run() {\n  const x = \n}\n', 'js')
		} catch (e) {
			message = (e as Error).message
		}
		const info = syntaxErrorInfo(message)
		expect(info.line).toBe(3)
		expect(formatCodeError(info.message, info.line)).toMatch(/^Line 3: Syntax error: /)
	})
	it('reads the user line and the message from a Python traceback', () => {
		const tb = [
			'Traceback (most recent call last):',
			'  File "/lib/python312.zip/_pyodide/_base.py", line 597, in eval_code_async',
			'  File "<exec>", line 9, in <module>',
			'  File "<code>", line 2, in <module>',
			"NameError: name 'nope' is not defined",
		].join('\n')
		expect(pythonErrorInfo(tb)).toEqual({ line: 2, message: "NameError: name 'nope' is not defined" })
		expect(formatCodeError('boom', null)).toBe('boom')
	})
	it('compiles Python as "<code>" and keeps print() output on an error', () => {
		const program = pythonProgram('print(1)', { a: 'x' }, ['output'])
		expect(program).toContain('compile(user_code, "<code>", "exec")')
		expect(program).toContain('except BaseException:')
		expect(readPythonLogs('noise\n___LOG___hello\nworld')).toBe('hello\nworld')
		expect(readPythonLogs('___LOG___hi\n___RESULT___{}')).toBe('hi')
		expect(readPythonLogs('no marker')).toBe('')
	})
	it('clamps the time limit, default 10 s', () => {
		expect(clampCodeTimeoutSec(undefined)).toBe(CODE_DEFAULT_TIMEOUT_SEC)
		expect(clampCodeTimeoutSec('')).toBe(10)
		expect(clampCodeTimeoutSec(0)).toBe(0.1)
		expect(clampCodeTimeoutSec(5000)).toBe(600)
		expect(clampCodeTimeoutSec(2)).toBe(2)
	})
})
