import { describe, expect, it, vi } from 'vitest'
import { buildClassifyPrompt, classifyWithRetry, parseLabels, validateClassifyReply } from '../shared/classify'

describe('parseLabels', () => {
	it('reads one label per line with an optional description after ":"', () => {
		expect(parseLabels('spam: unwanted ads\nnot spam\n\n- urgent: needs a reply today\n1. other')).toEqual([
			{ label: 'spam', description: 'unwanted ads' },
			{ label: 'not spam' },
			{ label: 'urgent', description: 'needs a reply today' },
			{ label: 'other' },
		])
	})

	it('drops duplicates and blank labels', () => {
		expect(parseLabels('Yes\nyes\n: nothing\n')).toEqual([{ label: 'Yes' }])
	})
})

describe('validateClassifyReply', () => {
	const labels = parseLabels('positive\nneutral\nnegative')

	it('accepts a fenced JSON reply and maps labels to their exact case', () => {
		const out = validateClassifyReply('```json\n{"labels": ["Positive"], "confidence": 0.9}\n```', labels, false)
		expect(out).toEqual({ ok: true, result: { labels: ['positive'], confidence: 0.9 } })
	})

	it('accepts "label" as a string', () => {
		expect(validateClassifyReply('{"label": "neutral", "confidence": "0.5"}', labels, false)).toEqual({
			ok: true,
			result: { labels: ['neutral'], confidence: 0.5 },
		})
	})

	it('lists the problems of a bad reply', () => {
		const out = validateClassifyReply('{"labels": ["happy", "negative", "positive"], "confidence": 7}', labels, false)
		expect(out.ok).toBe(false)
		if (!out.ok) {
			expect(out.problems).toContain('"happy" is not one of the labels')
			expect(out.problems).toContain('pick exactly one label')
			expect(out.problems).toContain('"confidence" must be a number from 0 to 1')
		}
		expect(validateClassifyReply('no json here', labels, false)).toEqual({ ok: false, problems: ['the reply has no JSON object'] })
	})

	it('allows several labels in multi-label mode', () => {
		expect(validateClassifyReply('{"labels": ["positive", "neutral"], "confidence": 0.6}', labels, true)).toEqual({
			ok: true,
			result: { labels: ['positive', 'neutral'], confidence: 0.6 },
		})
	})
})

describe('classifyWithRetry', () => {
	const labels = parseLabels('spam: ads\nham')

	it('retries once with the problems listed, then succeeds', async () => {
		const generate = vi
			.fn<(prompt: string) => Promise<string>>()
			.mockResolvedValueOnce('I think it is spam!')
			.mockResolvedValueOnce('{"labels": ["spam"], "confidence": 0.8}')
		const result = await classifyWithRetry('Buy now!!!', labels, false, generate)
		expect(result).toEqual({ labels: ['spam'], confidence: 0.8 })
		expect(generate).toHaveBeenCalledTimes(2)
		expect(generate.mock.calls[1][0]).toContain('Your last reply had these problems')
		expect(generate.mock.calls[1][0]).toContain('the reply has no JSON object')
	})

	it('throws a short message when the retry is still wrong', async () => {
		const generate = vi.fn(async () => '{"labels": ["maybe"], "confidence": 0.5}')
		await expect(classifyWithRetry('x', labels, false, generate)).rejects.toThrow(/did not return a valid label/)
		expect(generate).toHaveBeenCalledTimes(2)
	})

	it('builds a prompt that lists the labels with descriptions', () => {
		const prompt = buildClassifyPrompt('hello', labels, false)
		expect(prompt).toContain('- spam: ads')
		expect(prompt).toContain('- ham')
		expect(prompt).toContain('Pick exactly one label')
		expect(prompt.endsWith('Input:\nhello')).toBe(true)
	})
})
