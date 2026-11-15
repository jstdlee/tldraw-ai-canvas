/**
 * WP49: a small HTML parser and CSS selector matcher for the HTTP card's "Extract" modes (Main
 * article, CSS selector). No dependency (no HTML parser is in node_modules); good enough for
 * real pages: unclosed <p>/<li>/<td>, void tags, raw text in <script>/<style>, entities.
 * Pure, no DOM, testable in Node (tests/htmlScrape.test.ts).
 */

export interface HtmlElement {
	kind: 'element'
	tag: string
	attrs: Record<string, string>
	children: HtmlNode[]
	parent: HtmlElement | null
	/** Offsets in the source: from the start tag's "<" to just after the end tag (or the end of
	 * the last child when the tag was never closed). */
	start: number
	end: number
}

export interface HtmlText {
	kind: 'text'
	text: string
}

export type HtmlNode = HtmlElement | HtmlText

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title', 'noscript'])
/** A start tag of one of these closes an open <p>. */
const CLOSES_P = new Set([
	'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
	'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul', 'figure',
])

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–',
	lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', laquo: '«', raquo: '»', euro: '€', pound: '£',
}

export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
		if (body[0] === '#') {
			const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
			return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole
		}
		return NAMED_ENTITIES[body.toLowerCase()] ?? whole
	})
}

function element(tag: string, attrs: Record<string, string>, parent: HtmlElement | null, start: number): HtmlElement {
	return { kind: 'element', tag, attrs, children: [], parent, start, end: start }
}

function parseAttrs(source: string): Record<string, string> {
	const attrs: Record<string, string> = {}
	const re = /([^\s"'=<>/`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
	for (let m = re.exec(source); m; m = re.exec(source)) {
		const name = m[1].toLowerCase()
		if (name in attrs) continue
		attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
	}
	return attrs
}

/** Parse an HTML document into a tree. The root is a synthetic "#root" element. */
export function parseHtml(html: string): HtmlElement {
	const root = element('#root', {}, null, 0)
	root.end = html.length
	const stack: HtmlElement[] = [root]
	const top = () => stack[stack.length - 1]
	const closeTo = (index: number, at: number) => {
		while (stack.length - 1 >= index && stack.length > 1) {
			const el = stack.pop()!
			el.end = Math.max(el.end, at)
		}
	}
	const openIndex = (tag: string, stopAt?: Set<string>) => {
		for (let i = stack.length - 1; i > 0; i--) {
			if (stack[i].tag === tag) return i
			if (stopAt?.has(stack[i].tag)) return -1
		}
		return -1
	}
	const addText = (text: string) => {
		if (text) top().children.push({ kind: 'text', text: decodeEntities(text) })
	}

	let i = 0
	while (i < html.length) {
		const lt = html.indexOf('<', i)
		if (lt === -1) {
			addText(html.slice(i))
			break
		}
		if (lt > i) addText(html.slice(i, lt))
		if (html.startsWith('<!--', lt)) {
			const close = html.indexOf('-->', lt + 4)
			i = close === -1 ? html.length : close + 3
			continue
		}
		if (html[lt + 1] === '!' || html[lt + 1] === '?') {
			const close = html.indexOf('>', lt)
			i = close === -1 ? html.length : close + 1
			continue
		}
		const endTag = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(html.slice(lt, lt + 200))
		if (endTag) {
			const tag = endTag[1].toLowerCase()
			const at = lt + endTag[0].length
			const index = openIndex(tag)
			if (index > 0) closeTo(index, at)
			i = at
			continue
		}
		const startTag = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(lt, lt + 100))
		if (!startTag) {
			addText('<')
			i = lt + 1
			continue
		}
		// Find the tag's end ">", skipping quoted attribute values.
		let j = lt + startTag[0].length
		let quote = ''
		for (; j < html.length; j++) {
			const c = html[j]
			if (quote) {
				if (c === quote) quote = ''
			} else if (c === '"' || c === "'") quote = c
			else if (c === '>') break
		}
		const tag = startTag[1].toLowerCase()
		const inner = html.slice(lt + startTag[0].length, j)
		const selfClosing = inner.trimEnd().endsWith('/')
		const attrs = parseAttrs(selfClosing ? inner.trimEnd().slice(0, -1) : inner)
		const afterTag = Math.min(html.length, j + 1)

		// Implied end tags (the common cases on real pages).
		if (CLOSES_P.has(tag)) {
			const p = openIndex('p', new Set(['div', 'section', 'article', 'main', 'td', 'th', 'li', 'blockquote']))
			if (p > 0) closeTo(p, lt)
		}
		if (tag === 'li') {
			const li = openIndex('li', new Set(['ul', 'ol']))
			if (li > 0) closeTo(li, lt)
		}
		if (tag === 'dt' || tag === 'dd') {
			const d = Math.max(openIndex('dt', new Set(['dl'])), openIndex('dd', new Set(['dl'])))
			if (d > 0) closeTo(d, lt)
		}
		if (tag === 'tr') {
			const tr = openIndex('tr', new Set(['table']))
			if (tr > 0) closeTo(tr, lt)
		}
		if (tag === 'td' || tag === 'th') {
			const cell = Math.max(openIndex('td', new Set(['tr', 'table'])), openIndex('th', new Set(['tr', 'table'])))
			if (cell > 0) closeTo(cell, lt)
		}
		if (tag === 'option') {
			const option = openIndex('option', new Set(['select']))
			if (option > 0) closeTo(option, lt)
		}

		const el = element(tag, attrs, top(), lt)
		el.end = afterTag
		top().children.push(el)
		i = afterTag
		if (VOID_TAGS.has(tag) || selfClosing) continue
		if (RAW_TEXT_TAGS.has(tag)) {
			const closeRe = new RegExp(`</${tag}\\s*>`, 'i')
			const rest = html.slice(afterTag)
			const m = closeRe.exec(rest)
			const textEnd = m ? afterTag + m.index : html.length
			const raw = html.slice(afterTag, textEnd)
			if (raw) el.children.push({ kind: 'text', text: tag === 'script' || tag === 'style' ? raw : decodeEntities(raw) })
			el.end = m ? textEnd + m[0].length : html.length
			i = el.end
			continue
		}
		stack.push(el)
	}
	closeTo(1, html.length)
	return root
}

/** Every element below `root` (depth-first, document order). */
export function allElements(root: HtmlElement): HtmlElement[] {
	const out: HtmlElement[] = []
	const walk = (el: HtmlElement) => {
		for (const child of el.children) {
			if (child.kind !== 'element') continue
			out.push(child)
			walk(child)
		}
	}
	walk(root)
	return out
}

const SKIP_TEXT = new Set(['script', 'style', 'noscript', 'template', 'svg'])
const BLOCK_TAGS = new Set([
	'p', 'div', 'li', 'tr', 'section', 'article', 'header', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre',
	'ul', 'ol', 'table', 'br', 'main', 'aside', 'nav', 'figure', 'figcaption', 'dt', 'dd',
])

/** The readable text of an element: whitespace collapsed, a line break between block elements. */
export function textOf(el: HtmlElement): string {
	let out = ''
	const walk = (node: HtmlNode) => {
		if (node.kind === 'text') {
			out += node.text
			return
		}
		if (SKIP_TEXT.has(node.tag)) return
		const block = BLOCK_TAGS.has(node.tag)
		if (block) out += '\n'
		for (const child of node.children) walk(child)
		if (block) out += '\n'
	}
	for (const child of el.children) walk(child)
	return out
		.split('\n')
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join('\n')
}

// ---------------------------------------------------------------------------
// CSS selectors: tag, *, #id, .class, [attr], [attr=v], [attr^=v], [attr$=v], [attr*=v],
// [attr~=v], descendant (space), child (>), and comma lists. Also :first-child, :last-child.
// ---------------------------------------------------------------------------

interface AttrTest {
	name: string
	op?: '=' | '^=' | '$=' | '*=' | '~='
	value?: string
}

interface Compound {
	tag?: string
	id?: string
	classes: string[]
	attrs: AttrTest[]
	pseudo: ('first-child' | 'last-child')[]
}

/** One selector: compounds left to right, with the combinator before each (after the first). */
interface Complex {
	parts: { compound: Compound; combinator: ' ' | '>' }[]
}

function parseCompound(source: string, whole: string): Compound {
	const compound: Compound = { classes: [], attrs: [], pseudo: [] }
	let i = 0
	const ident = () => {
		const m = /^[\w-]+/.exec(source.slice(i))
		if (!m) throw new Error(`Cannot read the CSS selector "${whole}"`)
		i += m[0].length
		return m[0]
	}
	if (source[0] === '*') i = 1
	else if (/^[a-zA-Z]/.test(source)) compound.tag = ident().toLowerCase()
	while (i < source.length) {
		const c = source[i]
		if (c === '#') {
			i++
			compound.id = ident()
		} else if (c === '.') {
			i++
			compound.classes.push(ident())
		} else if (c === '[') {
			const close = source.indexOf(']', i)
			if (close === -1) throw new Error(`Cannot read the CSS selector "${whole}": missing "]"`)
			const body = source.slice(i + 1, close)
			const m = /^\s*([\w:-]+)\s*(?:([\^$*~]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?\s*$/.exec(body)
			if (!m) throw new Error(`Cannot read the CSS selector "${whole}": [${body}]`)
			compound.attrs.push({ name: m[1].toLowerCase(), op: m[2] as AttrTest['op'], value: m[3] ?? m[4] ?? m[5] })
			i = close + 1
		} else if (c === ':') {
			const m = /^:(first-child|last-child)/.exec(source.slice(i))
			if (!m) throw new Error(`The CSS selector "${whole}" uses a part this card does not support (${source.slice(i)}). Use tag, #id, .class, [attr], >, or a space.`)
			compound.pseudo.push(m[1] as 'first-child' | 'last-child')
			i += m[0].length
		} else {
			throw new Error(`Cannot read the CSS selector "${whole}" at "${source.slice(i)}"`)
		}
	}
	return compound
}

export function parseSelector(selector: string): Complex[] {
	const list = selector
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
	if (!list.length) throw new Error('Type a CSS selector, e.g. h2 a or .price')
	return list.map((one) => {
		// Tokenise around ">" and whitespace, keeping [..] groups whole.
		const tokens: string[] = []
		let buf = ''
		let inBracket = false
		for (const c of one) {
			if (c === '[') inBracket = true
			if (c === ']') inBracket = false
			if (!inBracket && (c === '>' || /\s/.test(c))) {
				if (buf) tokens.push(buf)
				buf = ''
				if (c === '>') tokens.push('>')
				continue
			}
			buf += c
		}
		if (buf) tokens.push(buf)
		const parts: Complex['parts'] = []
		let combinator: ' ' | '>' = ' '
		for (const token of tokens) {
			if (token === '>') {
				combinator = '>'
				continue
			}
			parts.push({ compound: parseCompound(token, one), combinator })
			combinator = ' '
		}
		if (!parts.length) throw new Error(`Cannot read the CSS selector "${one}"`)
		return { parts }
	})
}

function elementChildren(el: HtmlElement): HtmlElement[] {
	return el.children.filter((c): c is HtmlElement => c.kind === 'element')
}

function matchesCompound(el: HtmlElement, c: Compound): boolean {
	if (c.tag && el.tag !== c.tag) return false
	if (c.id && el.attrs.id !== c.id) return false
	if (c.classes.length) {
		const classes = new Set((el.attrs.class ?? '').split(/\s+/).filter(Boolean))
		if (!c.classes.every((name) => classes.has(name))) return false
	}
	for (const test of c.attrs) {
		const value = el.attrs[test.name]
		if (value === undefined) return false
		if (!test.op) continue
		const want = test.value ?? ''
		if (test.op === '=' && value !== want) return false
		if (test.op === '^=' && !value.startsWith(want)) return false
		if (test.op === '$=' && !value.endsWith(want)) return false
		if (test.op === '*=' && !value.includes(want)) return false
		if (test.op === '~=' && !value.split(/\s+/).includes(want)) return false
	}
	for (const pseudo of c.pseudo) {
		const siblings = el.parent ? elementChildren(el.parent) : [el]
		if (pseudo === 'first-child' && siblings[0] !== el) return false
		if (pseudo === 'last-child' && siblings[siblings.length - 1] !== el) return false
	}
	return true
}

function matchesComplex(el: HtmlElement, complex: Complex, index = complex.parts.length - 1): boolean {
	const part = complex.parts[index]
	if (!matchesCompound(el, part.compound)) return false
	if (index === 0) return true
	if (part.combinator === '>') {
		return !!el.parent && el.parent.tag !== '#root' && matchesComplex(el.parent, complex, index - 1)
	}
	for (let p = el.parent; p && p.tag !== '#root'; p = p.parent) {
		if (matchesComplex(p, complex, index - 1)) return true
	}
	return false
}

/** All elements under `root` matching the selector, in document order. */
export function querySelectorAll(root: HtmlElement, selector: string): HtmlElement[] {
	const selectors = parseSelector(selector)
	return allElements(root).filter((el) => selectors.some((complex) => matchesComplex(el, complex)))
}

// ---------------------------------------------------------------------------
// Extract modes
// ---------------------------------------------------------------------------

function absoluteUrl(value: string, baseUrl?: string): string {
	if (!baseUrl) return value
	try {
		return new URL(value, baseUrl).toString()
	} catch {
		return value
	}
}

const URL_ATTRS = new Set(['href', 'src', 'action', 'poster', 'data-src'])

/**
 * "CSS selector": one row per matched element. Columns: `text`, plus the attribute when one is
 * named (links and image sources are made absolute against the page URL).
 */
export function selectorTable(
	html: string,
	selector: string,
	attribute?: string,
	baseUrl?: string
): { headers: string[]; rows: string[][] } {
	const root = parseHtml(html)
	const matches = querySelectorAll(root, selector)
	const attr = (attribute ?? '').trim().toLowerCase()
	const headers = attr ? ['text', attr] : ['text']
	const rows = matches.map((el) => {
		const text = textOf(el).replace(/\n/g, ' ')
		if (!attr) return [text]
		const raw = el.attrs[attr] ?? ''
		return [text, raw && URL_ATTRS.has(attr) ? absoluteUrl(raw, baseUrl) : raw]
	})
	return { headers, rows }
}

export interface ArticleResult {
	title: string
	/** The source range of the chosen element, so the caller can run its own HTML-to-text. */
	range: { start: number; end: number }
	text: string
	links: { text: string; url: string }[]
}

const NOT_CONTENT = /(^|[\s_-])(nav|menu|footer|header|sidebar|comment|share|social|cookie|banner|advert|promo|related)([\s_-]|$)/i

/**
 * "Main article": the element that most likely holds the page's own text. An <article>, <main>
 * or [role=main] when there is one; otherwise the block whose paragraphs hold the most text.
 */
export function extractArticle(html: string, baseUrl?: string): ArticleResult {
	const root = parseHtml(html)
	const elements = allElements(root)
	const metaTitle = elements.find((el) => el.tag === 'meta' && (el.attrs.property === 'og:title' || el.attrs.name === 'twitter:title'))?.attrs.content
	const titleTag = elements.find((el) => el.tag === 'title')
	const h1 = elements.find((el) => el.tag === 'h1')
	const title = (metaTitle || (titleTag ? textOf(titleTag) : '') || (h1 ? textOf(h1) : '')).trim()

	const articles = elements.filter((el) => el.tag === 'article')
	let best: HtmlElement | undefined =
		articles.length === 1
			? articles[0]
			: elements.find((el) => el.tag === 'main') ?? elements.find((el) => el.attrs.role === 'main')
	if (!best) {
		// Score each block by the text of the paragraphs directly inside it.
		const scores = new Map<HtmlElement, number>()
		for (const p of elements.filter((el) => el.tag === 'p' || el.tag === 'pre' || el.tag === 'blockquote')) {
			const parent = p.parent
			if (!parent || parent.tag === '#root') continue
			const hint = `${parent.attrs.class ?? ''} ${parent.attrs.id ?? ''}`
			if (NOT_CONTENT.test(hint)) continue
			const length = textOf(p).length
			scores.set(parent, (scores.get(parent) ?? 0) + length)
			if (parent.parent && parent.parent.tag !== '#root') scores.set(parent.parent, (scores.get(parent.parent) ?? 0) + length / 2)
		}
		let top = 0
		for (const [el, score] of scores) {
			if (score > top) {
				top = score
				best = el
			}
		}
	}
	best ??= elements.find((el) => el.tag === 'body') ?? root

	const seen = new Set<string>()
	const links: { text: string; url: string }[] = []
	for (const a of allElements(best)) {
		if (a.tag !== 'a' || !a.attrs.href) continue
		const url = absoluteUrl(a.attrs.href, baseUrl)
		if (!/^https?:/i.test(url) || seen.has(url)) continue
		const text = textOf(a).replace(/\n/g, ' ')
		if (!text) continue
		seen.add(url)
		links.push({ text, url })
		if (links.length >= 100) break
	}
	return { title, range: { start: best.start, end: best.end }, text: textOf(best), links }
}

/** The article as one text: title, body, then the links (one per line). */
export function formatArticle(article: { title: string; text: string; links: { text: string; url: string }[] }): string {
	const parts: string[] = []
	if (article.title) parts.push(article.title)
	// The body often starts with the same heading as the title: keep it once.
	let body = article.text
	if (article.title && body.startsWith(article.title)) body = body.slice(article.title.length).trimStart()
	if (body) parts.push(body)
	if (article.links.length) parts.push('Links:\n' + article.links.map((link) => `- ${link.text}: ${link.url}`).join('\n'))
	return parts.join('\n\n')
}
