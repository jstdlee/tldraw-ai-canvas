/**
 * One search engine for every card: the library drawer, the wire-drop picker, the
 * command palette, and the Build-with-AI chips all rank the same documents the same
 * way. Pure logic (no tldraw import), so it is unit-testable in Node — see
 * tests/cardSearch.test.ts.
 *
 * A document is either a plain card (one per node type) or a "deep entry": a
 * pre-configured preset of a card, such as "DataPipe · Pivot" or "Chart · Line".
 * Deep entries are built from the existing op/kind registries (`shared/tableOps.ts`,
 * `shared/chartOption.ts`, `shared/jevKinds.ts`, `shared/textTools.ts`,
 * `shared/textAiOps.ts`) — never a hand-written list — so adding an op there adds a
 * searchable, insertable entry here for free.
 */

import { NODE_PORTS } from './nodeCatalog'
import { NODE_DESCRIPTIONS } from './nodeDescriptions'
import { categoryOf } from './nodeGroups'
import { TABLE_OPS } from './tableOps'
import { CHART_KINDS } from './chartOption'
import { JEV_KINDS } from './jevKinds'
import { TEXT_TOOL_OPS } from './textTools'
import { TEXT_AI_OPERATIONS } from './textAiOps'
import { DB_SOURCES } from './dbSources'
import { recencyScore, type PickerRecency } from './recency'
import { TABLE_TEMPLATE_LABELS, type TableTemplateId } from './table/canvasTableOps'

/** One searchable, insertable card. `deep` presets a field when the card is inserted. */
export interface CardDoc {
	/** Unique across the whole index: the node type, or `${type}:${opId}` for a deep entry. */
	id: string
	/** The node type to actually create. */
	type: string
	title: string
	group: string
	description: string
	keywords: string[]
	/** Preset a field on insert, e.g. `{ field: 'op', value: 'pivot' }`. */
	deep?: { field: string; value: string }
	/** WP40: this doc inserts a canvas `table` shape, not a node — `type` is the sentinel
	 * `'canvas-table'` (never a real node type, so `getNodeDefinitions(editor)[type]` is
	 * naturally undefined for it and every node-insert code path's existing `if (!def) return`
	 * guard already skips it). `'blank'` for a default-size blank table, or a template id. */
	insertTable?: 'blank' | TableTemplateId
}

export interface RankedCard {
	doc: CardDoc
	score: number
}

export interface CardSearchOptions {
	recency?: PickerRecency
	now?: number
	/** Node types whose input ports are compatible with a dropped wire's source port. */
	compatibleTypes?: ReadonlySet<string>
	/** Hard-filter to `compatibleTypes` instead of just boosting them (the wire-drop picker). */
	requireCompatible?: boolean
}

/** Node types superseded by another card; excluded from search like the picker/library already excludes them. */
const HIDDEN_TYPES = new Set(['adjust', 'number', 'router', 'subgraph', 'url_in', 'postgres'])

// ---------------------------------------------------------------------------
// Tokenizing: lower-case, split camelCase/snake_case, simple English stemming.
// ---------------------------------------------------------------------------

function splitWords(text: string): string[] {
	return text
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[^a-zA-Z0-9]+/)
		.filter(Boolean)
}

/** Conservative suffix stripping: -ies/-ing/-ed/-es/-s. Never touches words of 3 letters or fewer. */
export function stem(word: string): string {
	const w = word.toLowerCase()
	if (w.length <= 3) return w
	if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
	if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3)
	if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2)
	if (w.endsWith('es') && w.length > 4) return w.slice(0, -2)
	if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1)
	return w
}

export function tokenize(text: string): string[] {
	return splitWords(text)
		.map((w) => stem(w.toLowerCase()))
		.filter(Boolean)
}

// ---------------------------------------------------------------------------
// Synonyms: a small, hand-written table of word clusters.
// ---------------------------------------------------------------------------

const SYNONYM_GROUPS: string[][] = [
	['sum', 'total', 'aggregate'],
	['filter', 'where'],
	['join', 'merge', 'lookup'],
	['pivot', 'crosstab'],
	['csv', 'table'],
	['llm', 'ai', 'model'],
	['decide', 'judge', 'classify'],
	['chart', 'plot', 'graph'],
	['sql', 'query'],
]

const SYNONYMS: Record<string, string[]> = {}
for (const group of SYNONYM_GROUPS) {
	for (const word of group) {
		const stemmed = stem(word)
		SYNONYMS[stemmed] = [...new Set([...(SYNONYMS[stemmed] ?? []), ...group.filter((w) => stem(w) !== stemmed).map(stem)])]
	}
}

function expandSynonyms(tokens: string[]): string[] {
	const out = new Set(tokens)
	for (const t of tokens) for (const syn of SYNONYMS[t] ?? []) out.add(syn)
	return [...out]
}

// ---------------------------------------------------------------------------
// Document weights: title tokens count more than description/keywords.
// ---------------------------------------------------------------------------

function docText(doc: CardDoc) {
	return {
		title: tokenize(doc.title),
		rest: tokenize([doc.description, doc.group, ...doc.keywords, doc.type].join(' ')),
	}
}

function docBag(doc: CardDoc): string[] {
	const { title, rest } = docText(doc)
	// Title words count 3x, the rest count 1x.
	return [...title, ...title, ...title, ...rest]
}

// ---------------------------------------------------------------------------
// BM25 over the whole doc set.
// ---------------------------------------------------------------------------

const BM25_K1 = 1.5
const BM25_B = 0.75

interface Bm25Index {
	docTokens: Map<string, string[]>
	docFreq: Map<string, number>
	avgLen: number
	n: number
}

function buildBm25Index(docs: CardDoc[]): Bm25Index {
	const docTokens = new Map<string, string[]>()
	const docFreq = new Map<string, number>()
	let totalLen = 0
	for (const doc of docs) {
		const tokens = docBag(doc)
		docTokens.set(doc.id, tokens)
		totalLen += tokens.length
		for (const term of new Set(tokens)) docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
	}
	return { docTokens, docFreq, avgLen: docs.length ? totalLen / docs.length : 0, n: docs.length }
}

function bm25Score(index: Bm25Index, docId: string, queryTerms: string[]): number {
	const tokens = index.docTokens.get(docId)
	if (!tokens || !tokens.length) return 0
	const dl = tokens.length
	const tf = new Map<string, number>()
	for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
	let score = 0
	for (const term of queryTerms) {
		const freq = tf.get(term)
		if (!freq) continue
		const df = index.docFreq.get(term) ?? 0
		const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5))
		score += idf * ((freq * (BM25_K1 + 1)) / (freq + BM25_K1 * (1 - BM25_B + BM25_B * (dl / (index.avgLen || 1)))))
	}
	return score
}

// ---------------------------------------------------------------------------
// Character-trigram similarity on the title (typos, partial words).
// ---------------------------------------------------------------------------

function trigrams(text: string): string[] {
	const padded = `  ${text.toLowerCase()}  `
	const grams: string[] = []
	for (let i = 0; i < padded.length - 2; i++) grams.push(padded.slice(i, i + 3))
	return grams
}

/** Dice coefficient over character trigrams. */
export function trigramSimilarity(a: string, b: string): number {
	if (!a.trim() || !b.trim()) return 0
	const ag = trigrams(a)
	const bg = trigrams(b)
	if (!ag.length || !bg.length) return 0
	const bCount = new Map<string, number>()
	for (const g of bg) bCount.set(g, (bCount.get(g) ?? 0) + 1)
	let shared = 0
	for (const g of ag) {
		const left = bCount.get(g) ?? 0
		if (left > 0) {
			shared++
			bCount.set(g, left - 1)
		}
	}
	return (2 * shared) / (ag.length + bg.length)
}

/** How many whole query words are a prefix of a title word. */
function prefixMatchCount(queryWords: string[], title: string): number {
	const titleWords = title.toLowerCase().split(/\s+/)
	let count = 0
	for (const q of queryWords) {
		if (!q) continue
		if (titleWords.some((w) => w.startsWith(q))) count++
	}
	return count
}

/**
 * Best per-word trigram similarity between the query and the title, below a floor
 * treated as zero. Comparing word-by-word (not the whole title string at once) keeps a
 * long multi-word title from diluting a strong match on just one of its words, and the
 * floor keeps two short, unrelated words from scoring just because they happen to share
 * one boundary trigram (e.g. both ending in the same letter).
 */
const TRIGRAM_FLOOR = 0.24
function bestTrigramSimilarity(queryWords: string[], title: string): number {
	const titleWords = title.toLowerCase().split(/\s+/).filter(Boolean)
	let best = 0
	for (const q of queryWords) {
		if (!q) continue
		for (const w of titleWords) best = Math.max(best, trigramSimilarity(q, w))
	}
	return best >= TRIGRAM_FLOOR ? best : 0
}

// ---------------------------------------------------------------------------
// Weights (one table, as the WP asks).
// ---------------------------------------------------------------------------

export const CARD_SEARCH_WEIGHTS = {
	bm25: 1,
	trigram: 1.2,
	prefix: 1.5,
	recency: 0.8,
	compatible: 1,
}

/** Rank `docs` for `query`. An empty query ranks everything by recency only. */
export function searchCards(query: string, docs: CardDoc[], opts: CardSearchOptions = {}): RankedCard[] {
	const recency = opts.recency ?? {}
	const now = opts.now ?? Date.now()
	const pool =
		opts.compatibleTypes && opts.requireCompatible
			? docs.filter((d) => opts.compatibleTypes!.has(d.type))
			: docs

	const q = query.trim().toLowerCase()
	if (!q) {
		return pool
			.map((doc) => ({ doc, score: CARD_SEARCH_WEIGHTS.recency * recencyScore(recency[doc.id], now) }))
			.sort((a, b) => b.score - a.score)
	}

	const rawWords = q.split(/\s+/).filter(Boolean)
	const queryTerms = expandSynonyms(tokenize(q))
	const index = buildBm25Index(pool)

	const ranked = pool.map((doc) => {
		const bm = bm25Score(index, doc.id, queryTerms)
		const title = doc.title.toLowerCase()
		const tri = bestTrigramSimilarity(rawWords, title)
		const prefix = prefixMatchCount(rawWords, title)
		const rec = recencyScore(recency[doc.id], now)
		const compat = opts.compatibleTypes?.has(doc.type) ? 1 : 0
		const score =
			CARD_SEARCH_WEIGHTS.bm25 * bm +
			CARD_SEARCH_WEIGHTS.trigram * tri +
			CARD_SEARCH_WEIGHTS.prefix * prefix +
			CARD_SEARCH_WEIGHTS.recency * rec +
			CARD_SEARCH_WEIGHTS.compatible * compat
		return { doc, score }
	})

	return ranked.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score)
}

// ---------------------------------------------------------------------------
// The document set: one per card, plus the deep entries built from the registries.
// ---------------------------------------------------------------------------

function baseDoc(type: string): CardDoc {
	const described = NODE_DESCRIPTIONS[type]
	return {
		id: type,
		type,
		title: described?.title ?? type,
		group: categoryOf(type),
		description: described?.description ?? '',
		keywords: described?.keywords ?? [],
	}
}

function deepDoc(type: string, opId: string, field: string, title: string, description: string, keywords: string[]): CardDoc {
	const base = baseDoc(type)
	return {
		id: `${type}:${opId}`,
		type,
		title: `${base.title} · ${title}`,
		group: base.group,
		description: description || base.description,
		keywords: [...base.keywords, ...keywords, opId],
		deep: { field, value: opId },
	}
}

/** Extra search words for a table op, beyond its own label/description. */
const TABLE_OP_EXTRA_KEYWORDS: Record<string, string[]> = {
	groupby: ['sum', 'aggregate', 'total', 'average', 'count', 'summarize'],
	pivot: ['crosstab', 'reshape'],
	formula: ['compute', 'expression', 'calculate'],
	lookup: ['join', 'merge', 'vlookup'],
	sort: ['order'],
	dedupe: ['unique', 'distinct'],
}

function tableOpDocs(): CardDoc[] {
	return TABLE_OPS.filter((op) => !op.hidden).map((op) =>
		deepDoc('table', op.id, 'op', op.label, op.description, TABLE_OP_EXTRA_KEYWORDS[op.id] ?? [])
	)
}

function chartKindDocs(): CardDoc[] {
	return CHART_KINDS.map((kind) => deepDoc('chart', kind.id, 'kind', kind.label, `Draws a ${kind.label.toLowerCase()} chart from a table.`, [kind.id]))
}

function jevKindDocs(): CardDoc[] {
	return JEV_KINDS.map((kind) => deepDoc('jev', kind.id, 'kind', kind.label, '', []))
}

function textToolOpDocs(): CardDoc[] {
	return TEXT_TOOL_OPS.map((op) => deepDoc('text_tool', op.id, 'op', op.label, '', [op.group]))
}

function textAiOpDocs(): CardDoc[] {
	return TEXT_AI_OPERATIONS.map((op) => deepDoc('text_ai', op.id, 'operation', op.label, '', []))
}

/** "Database · SQLite file / Built-in Postgres / Postgres / DuckDB" (WP13): one deep entry
 * per source, built from the same registry the card's own source picker uses. */
function dbSourceDocs(): CardDoc[] {
	return DB_SOURCES.map((source) => deepDoc('database', source.id, 'source', source.label, source.description, source.keywords))
}

/** WP40: "Table" (blank + the 4 list templates) as insertable entries in the same Ctrl+P /
 * Insert palette as every node card, so a canvas table is searchable and insertable the same
 * way. Not a node — see `CardDoc.insertTable`. */
function tableInsertDocs(): CardDoc[] {
	const blank: CardDoc = {
		id: 'canvas-table:blank',
		type: 'canvas-table',
		title: 'Table',
		group: 'table',
		description: 'A blank canvas table (presentation / small lists), not DataPipe.',
		keywords: ['table', 'grid', 'spreadsheet', 'rows', 'columns', 'list'],
		insertTable: 'blank',
	}
	const templates = (Object.keys(TABLE_TEMPLATE_LABELS) as TableTemplateId[]).map(
		(id): CardDoc => ({
			id: `canvas-table:${id}`,
			type: 'canvas-table',
			title: `Table · ${TABLE_TEMPLATE_LABELS[id]}`,
			group: 'table',
			description: `Insert a ${TABLE_TEMPLATE_LABELS[id]} table template.`,
			keywords: ['table', 'template', ...TABLE_TEMPLATE_LABELS[id].toLowerCase().split(' ')],
			insertTable: id,
		})
	)
	return [blank, ...templates]
}

/**
 * Every searchable, insertable card: one base document per non-superseded node type,
 * plus every deep entry built from the op/kind registries above.
 */
export function buildCardDocs(): CardDoc[] {
	const types = Object.keys(NODE_PORTS).filter((type) => !HIDDEN_TYPES.has(type))
	return [
		...types.map(baseDoc),
		...tableOpDocs(),
		...chartKindDocs(),
		...jevKindDocs(),
		...textToolOpDocs(),
		...textAiOpDocs(),
		...dbSourceDocs(),
		...tableInsertDocs(),
	]
}

let cachedDocs: CardDoc[] | null = null

/** The full index, built once and memoised (pure data, never depends on recency/query). */
export function getCardDocs(): CardDoc[] {
	if (!cachedDocs) cachedDocs = buildCardDocs()
	return cachedDocs
}

// ---------------------------------------------------------------------------
// Optional JEV re-rank: blend a local ranking with a JEV-returned order.
// ---------------------------------------------------------------------------

/** 0.6 local / 0.4 JEV blend, both normalised 0..1 by rank. Pure — callers do the fetch. */
export function blendWithJev(local: RankedCard[], jevProbs: Record<string, number>): RankedCard[] {
	const ids = Object.keys(jevProbs)
	if (!ids.length || !local.length) return local
	// Local relevance relative to the best hit, and JEV probability relative to its best option:
	// a card JEV gives almost nothing gets almost no boost.
	const topScore = Math.max(...local.map((entry) => entry.score), 1e-9)
	const topProb = Math.max(...ids.map((id) => jevProbs[id]), 1e-9)
	const combined = local.map((entry) => ({
		doc: entry.doc,
		score: 0.6 * (entry.score / topScore) + 0.4 * ((jevProbs[entry.doc.id] ?? 0) / topProb),
	}))
	combined.sort((a, b) => b.score - a.score)
	return combined
}
