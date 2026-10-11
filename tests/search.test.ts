import { describe, expect, it } from 'vitest'
import {
	buildBraveRequest,
	buildExaRequest,
	buildSearchRequest,
	buildTavilyRequest,
	clampSearchCount,
	formatSearchMarkdown,
	parseBraveResponse,
	parseExaResponse,
	parseSearchResponse,
	parseTavilyResponse,
} from '../shared/search'

describe('search: request builders', () => {
	it('builds an Exa request (x-api-key header, numResults, type auto)', () => {
		const req = buildExaRequest('exa-key', 'local llm news', 5)
		expect(req.method).toBe('POST')
		expect(req.url).toBe('https://api.exa.ai/search')
		expect(req.headers['x-api-key']).toBe('exa-key')
		expect(JSON.parse(req.body!)).toEqual({ query: 'local llm news', numResults: 5, type: 'auto' })
	})

	it('Exa: exaIncludeText adds a contents.text.maxCharacters block', () => {
		const req = buildExaRequest('k', 'q', 3, { exaIncludeText: true })
		const body = JSON.parse(req.body!)
		expect(body.contents.text.maxCharacters).toBeGreaterThan(0)
	})

	it('builds a Tavily request (Bearer auth, max_results, search_depth, include_answer)', () => {
		const req = buildTavilyRequest('tvly-key', 'local llm news', 7, { tavilyDepth: 'advanced', tavilyIncludeAnswer: true })
		expect(req.method).toBe('POST')
		expect(req.url).toBe('https://api.tavily.com/search')
		expect(req.headers.Authorization).toBe('Bearer tvly-key')
		expect(JSON.parse(req.body!)).toEqual({
			query: 'local llm news',
			max_results: 7,
			search_depth: 'advanced',
			include_answer: true,
		})
	})

	it('Tavily defaults to search_depth basic and include_answer false', () => {
		const req = buildTavilyRequest('k', 'q', 5)
		const body = JSON.parse(req.body!)
		expect(body.search_depth).toBe('basic')
		expect(body.include_answer).toBe(false)
	})

	it('builds a Brave request (GET, X-Subscription-Token, q/count query params)', () => {
		const req = buildBraveRequest('brave-key', 'local llm news', 10)
		expect(req.method).toBe('GET')
		expect(req.body).toBeUndefined()
		expect(req.headers['X-Subscription-Token']).toBe('brave-key')
		const url = new URL(req.url)
		expect(url.hostname).toBe('api.search.brave.com')
		expect(url.searchParams.get('q')).toBe('local llm news')
		expect(url.searchParams.get('count')).toBe('10')
	})

	it('buildSearchRequest dispatches by provider id', () => {
		expect(buildSearchRequest('exa', 'k', 'q', 5).url).toContain('exa.ai')
		expect(buildSearchRequest('tavily', 'k', 'q', 5).url).toContain('tavily.com')
		expect(buildSearchRequest('brave', 'k', 'q', 5).url).toContain('brave.com')
	})
})

describe('search: count clamping', () => {
	it('clamps to 1..20 and defaults to 5', () => {
		expect(clampSearchCount(undefined)).toBe(5)
		expect(clampSearchCount(0)).toBe(1)
		expect(clampSearchCount(-5)).toBe(1)
		expect(clampSearchCount(100)).toBe(20)
		expect(clampSearchCount(12)).toBe(12)
		expect(clampSearchCount(Number.NaN)).toBe(5)
	})
})

describe('search: response parsers', () => {
	it('parses an Exa response (title/url/text/publishedDate/score)', () => {
		const json = {
			results: [
				{ title: 'A post', url: 'https://example.com/a', text: 'Some extracted text.', publishedDate: '2026-01-01', score: 0.9 },
				{ url: 'https://example.com/b' }, // no title: falls back to the URL
			],
		}
		const { results, answer } = parseExaResponse(json)
		expect(answer).toBeUndefined()
		expect(results).toHaveLength(2)
		expect(results[0]).toMatchObject({
			title: 'A post',
			url: 'https://example.com/a',
			snippet: 'Some extracted text.',
			published: '2026-01-01',
			score: 0.9,
		})
		expect(results[1].title).toBe('https://example.com/b')
	})

	it('parses a Tavily response (title/url/content/score, plus a top-level answer)', () => {
		const json = {
			results: [{ title: 'A post', url: 'https://example.com/a', content: 'Some content.', score: 0.5 }],
			answer: 'A short generated answer.',
		}
		const { results, answer } = parseTavilyResponse(json)
		expect(answer).toBe('A short generated answer.')
		expect(results).toEqual([
			{ title: 'A post', url: 'https://example.com/a', snippet: 'Some content.', score: 0.5, content: 'Some content.' },
		])
	})

	it('Tavily: no answer field means no answer', () => {
		const { answer } = parseTavilyResponse({ results: [] })
		expect(answer).toBeUndefined()
	})

	it('parses a Brave response (web.results[].title/url/description/age)', () => {
		const json = {
			web: {
				results: [{ title: 'A post', url: 'https://example.com/a', description: 'A short excerpt.', age: '2 days ago' }],
			},
		}
		const { results, answer } = parseBraveResponse(json)
		expect(answer).toBeUndefined()
		expect(results).toEqual([
			{ title: 'A post', url: 'https://example.com/a', snippet: 'A short excerpt.', published: '2 days ago' },
		])
	})

	it('Brave: a missing web.results gives an empty list, not a throw', () => {
		expect(parseBraveResponse({})).toEqual({ results: [] })
	})

	it('parseSearchResponse dispatches by provider id', () => {
		expect(parseSearchResponse('exa', { results: [] })).toEqual({ results: [] })
		expect(parseSearchResponse('tavily', { results: [] })).toEqual({ results: [], answer: undefined })
		expect(parseSearchResponse('brave', {})).toEqual({ results: [] })
	})
})

describe('search: markdown formatting', () => {
	it('formats a numbered list with title, link and snippet', () => {
		const md = formatSearchMarkdown([
			{ title: 'First', url: 'https://a.com', snippet: 'about a' },
			{ title: 'Second', url: 'https://b.com', snippet: '' },
		])
		expect(md).toBe('1. [First](https://a.com) — about a\n2. [Second](https://b.com)')
	})

	it('an empty result list formats to an empty string', () => {
		expect(formatSearchMarkdown([])).toBe('')
	})
})
