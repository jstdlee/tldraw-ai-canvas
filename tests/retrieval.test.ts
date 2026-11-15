import { describe, expect, it } from 'vitest'
import {
	bm25Rank,
	buildDocQaPrompt,
	chunkDocuments,
	chunkText,
	cosine,
	cosineTopK,
	hashText,
	NOT_IN_DOCUMENTS,
	parseDocumentsInput,
	tokenize,
} from '../shared/retrieval'

describe('chunkText', () => {
	it('keeps short text as one chunk', () => {
		expect(chunkText('Hello world.', 800, 100)).toEqual(['Hello world.'])
		expect(chunkText('   ', 800, 100)).toEqual([])
	})

	it('cuts long text into windows no longer than the chunk size, with overlap', () => {
		const words = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ')
		const chunks = chunkText(words, 200, 50)
		expect(chunks.length).toBeGreaterThan(5)
		for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200)
		// Every chunk after the first starts with words the previous chunk ended with.
		for (let i = 1; i < chunks.length; i++) {
			const firstWord = chunks[i].split(' ')[0]
			expect(chunks[i - 1].split(' ')).toContain(firstWord)
		}
		// Nothing is lost: the last word is in the last chunk, the first in the first.
		expect(chunks[0].startsWith('w0 ')).toBe(true)
		expect(chunks.at(-1)!.endsWith('w399')).toBe(true)
		// Words are never cut in half.
		const all = new Set(words.split(' '))
		for (const chunk of chunks) for (const w of chunk.split(' ')) expect(all.has(w)).toBe(true)
	})

	it('with no overlap, the chunks join back into the text', () => {
		const text = Array.from({ length: 50 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
		const chunks = chunkText(text, 120, 0)
		expect(chunks.join(' ')).toBe(text)
	})

	it('prefers to cut at a sentence end', () => {
		const text = 'A'.repeat(70) + '. ' + 'B'.repeat(70) + '. ' + 'C'.repeat(70) + '.'
		const chunks = chunkText(text, 100, 0)
		expect(chunks[0]).toBe('A'.repeat(70) + '.')
	})

	it('chunks several documents and keeps their index', () => {
		const chunks = chunkDocuments([{ text: 'one' }, { text: 'two' }])
		expect(chunks).toEqual([
			{ doc: 0, index: 0, text: 'one' },
			{ doc: 1, index: 0, text: 'two' },
		])
	})
})

describe('BM25', () => {
	const chunks = [
		{ text: 'The office opens at 8:00 on weekdays.' },
		{ text: 'Cats sleep most of the day.' },
		{ text: 'On Saturdays the office opens at 10:00.' },
		{ text: 'Parking is free for visitors.' },
	]

	it('ranks the chunks that share the rare query words first', () => {
		const ranked = bm25Rank(chunks, 'When does the office open on Saturday?', 3)
		expect(ranked[0].text).toContain('Saturdays')
		expect(ranked[1].text).toContain('weekdays')
		expect(ranked.every((c) => c.score > 0)).toBe(true)
		expect(ranked.length).toBe(2)
	})

	it('returns nothing when no word matches', () => {
		expect(bm25Rank(chunks, 'quantum chromodynamics', 5)).toEqual([])
	})

	it('drops stop words and stems plurals', () => {
		expect(tokenize('The cats are sleeping')).toEqual(['cat', 'sleep'])
		expect(bm25Rank(chunks, 'cat', 1)[0].text).toContain('Cats')
	})

	it('limits to top K', () => {
		expect(bm25Rank(chunks, 'office opens', 1)).toHaveLength(1)
	})
})

describe('cosine top-K', () => {
	it('computes cosine similarity', () => {
		expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
		expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
		expect(cosine([1, 1], [-1, -1])).toBeCloseTo(-1)
		expect(cosine([0, 0], [1, 1])).toBe(0)
	})

	it('returns the k closest chunks, best first', () => {
		const chunks = [{ text: 'a' }, { text: 'b' }, { text: 'c' }]
		const vectors = [
			[1, 0, 0],
			[0.9, 0.1, 0],
			[0, 0, 1],
		]
		const ranked = cosineTopK(chunks, vectors, [1, 0, 0], 2)
		expect(ranked.map((c) => c.text)).toEqual(['a', 'b'])
		expect(ranked[0].score).toBeCloseTo(1)
	})
})

describe('parseDocumentsInput', () => {
	it('reads plain text as one document', () => {
		expect(parseDocumentsInput('Just some notes, with commas, and more.')).toEqual([
			{ name: 'Document 1', text: 'Just some notes, with commas, and more.' },
		])
	})

	it('reads file paths and URLs, one per line (Read from binary notes are skipped)', () => {
		const docs = parseDocumentsInput('/api/files/abc123\n(binary file, 2 KB — open the link to download it)\nhttps://example.com/guide.html')
		expect(docs).toEqual([
			{ name: 'File 1', ref: '/api/files/abc123' },
			{ name: 'example.com/guide.html', ref: 'https://example.com/guide.html' },
		])
	})

	it('reads a table of texts with a name column', () => {
		const docs = parseDocumentsInput('title,content\nHours,Open at 8\nParking,Free for visitors')
		expect(docs).toEqual([
			{ name: 'Hours', text: 'Open at 8' },
			{ name: 'Parking', text: 'Free for visitors' },
		])
	})

	it('picks the longest column when no column is named like text', () => {
		const docs = parseDocumentsInput('id,notes\n1,a long note about the office hours\n2,another long note about parking')
		expect(docs.map((d) => d.text)).toEqual(['a long note about the office hours', 'another long note about parking'])
	})
})

describe('Document Q&A prompt', () => {
	it('numbers the sources and asks to say when the answer is missing', () => {
		const prompt = buildDocQaPrompt('When?', [
			{ text: 'At 8.', document: 'Hours' },
			{ text: 'Free.', document: 'Parking' },
		])
		expect(prompt).toContain('[1] (from Hours)\nAt 8.')
		expect(prompt).toContain('[2] (from Parking)\nFree.')
		expect(prompt).toContain(NOT_IN_DOCUMENTS)
		expect(prompt.trim().endsWith('Question: When?')).toBe(true)
	})

	it('hashes texts stably', () => {
		expect(hashText('abc')).toBe(hashText('abc'))
		expect(hashText('abc')).not.toBe(hashText('abd'))
	})
})
