import { describe, expect, it } from 'vitest'
import { buildSystemOneBody, parseSystemOneAnswer } from '../server/jev'

describe('buildSystemOneBody', () => {
	it('builds a noul question', () => {
		const body = buildSystemOneBody('clef-flash', { type: 'noul', question: ' Is this spicy? ' }, [], [])
		expect(body).toEqual({
			model: 'clef-flash',
			state: '(no context)',
			questions: { decision: { type: 'noul', instructions: 'Is this spicy?' } },
		})
	})

	it('builds a choice question with criteria from the options', () => {
		const body = buildSystemOneBody(
			'clef',
			{ type: 'choice', question: 'What dish is this?', context: 'rice and vegetables' },
			[
				{ label: 'fried rice', description: 'rice fried with egg and vegetables' },
				{ label: 'salad', description: 'raw vegetables' },
				{ label: 'pizza', description: 'dough with toppings' },
			],
			[]
		)
		expect(body.model).toBe('clef')
		expect(body.state).toBe('rice and vegetables')
		expect(body.questions.decision).toEqual({
			type: 'choice',
			instructions: 'What dish is this?',
			criteria: {
				'fried rice': 'rice fried with egg and vegetables',
				salad: 'raw vegetables',
				pizza: 'dough with toppings',
			},
		})
	})

	it('builds a score question with criteria from the levels', () => {
		const body = buildSystemOneBody('clef-flash', { type: 'score', question: 'How good is it?' }, [], [
			'poor',
			'ok',
			'good',
			'great',
		])
		expect(body.questions.decision).toEqual({
			type: 'score',
			instructions: 'How good is it?',
			criteria: ['poor', 'ok', 'good', 'great'],
		})
	})

	it('defaults the model name to "auto" and falls back to "(no context)"', () => {
		const body = buildSystemOneBody('', { type: 'noul', question: 'q' }, [], [])
		expect(body.model).toBe('auto')
		expect(body.state).toBe('(no context)')
	})
})

describe('parseSystemOneAnswer', () => {
	// The verified Clef response shape from docs/rework/WP6-cloudflare-clef.md.
	const verified = {
		model: 'clef-flash',
		answers: {
			decision: {
				type: 'noul',
				noul: 0.9124,
			},
		},
		usage: { input_tokens: 343, output_tokens: 0 },
	}

	it('parses a noul answer as yes/no probabilities', () => {
		const result = parseSystemOneAnswer(verified, { type: 'noul', question: 'q' }, [])
		expect(result.answer).toBe('yes')
		expect(result.probabilities.yes).toBeCloseTo(0.9124)
		expect(result.probabilities.no).toBeCloseTo(1 - 0.9124)
	})

	it('parses a choice answer', () => {
		const data = {
			model: 'clef-flash',
			answers: {
				decision: {
					type: 'choice',
					choice: 'fried rice',
					probabilities: { 'fried rice': 0.96, salad: 0.03, pizza: 0.01 },
					confidence: 0.89,
				},
			},
		}
		const result = parseSystemOneAnswer(data, { type: 'choice', question: 'q' }, [])
		expect(result.answer).toBe('fried rice')
		expect(result.confidence).toBe(0.89)
		expect(result.probabilities['fried rice']).toBeCloseTo(0.96)
	})

	it('parses a score answer, naming levels from the legend', () => {
		const data = {
			model: 'clef-flash',
			answers: {
				decision: {
					type: 'score',
					score: 1.77,
					legend: { '0': 'poor', '1': 'ok', '2': 'good', '3': 'great' },
					probabilities: { '0': 0.05, '1': 0.32, '2': 0.44, '3': 0.19 },
					confidence: 0.11,
				},
			},
		}
		const result = parseSystemOneAnswer(data, { type: 'score', question: 'q' }, ['poor', 'ok', 'good', 'great'])
		expect(result.answer).toBe('good')
		expect(result.confidence).toBe(0.11)
		// probabilities keyed by the legend's names, normalised (they already sum to 1).
		expect(Object.keys(result.probabilities).sort()).toEqual(['good', 'great', 'ok', 'poor'])
		expect(result.probabilities.good).toBeCloseTo(0.44)
		const total = Object.values(result.probabilities).reduce((s, v) => s + v, 0)
		expect(total).toBeCloseTo(1)
	})

	it('falls back to the levels we sent when there is no legend', () => {
		const data = {
			answers: { decision: { type: 'score', score: 2, probabilities: { '0': 0.1, '1': 0.2, '2': 0.5, '3': 0.2 } } },
		}
		const result = parseSystemOneAnswer(data, { type: 'score', question: 'q' }, ['poor', 'ok', 'good', 'great'])
		expect(result.answer).toBe('good')
	})

	it('unwraps a Workers AI `{ result: … }` envelope before parsing', () => {
		const wrapped = { result: verified, success: true, errors: [] }
		const unwrapped = wrapped.result ?? wrapped
		const result = parseSystemOneAnswer(unwrapped, { type: 'noul', question: 'q' }, [])
		expect(result.answer).toBe('yes')
	})

	it('throws a clear error when there is no answer', () => {
		expect(() => parseSystemOneAnswer({}, { type: 'noul', question: 'q' }, [])).toThrow(/no answer/i)
	})
})
