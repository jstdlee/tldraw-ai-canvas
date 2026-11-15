import { describe, expect, it } from 'vitest'
import { extractHtml } from '../server/http'
import { extractArticle, formatArticle, parseHtml, querySelectorAll, selectorTable, textOf } from '../shared/htmlScrape'
import { parseTableText } from '../shared/tableText'

/** WP49: the HTTP card's Extract modes (Main article, CSS selector). */

const PAGE = `<!doctype html>
<html><head><title>Shop &amp; Co</title><style>.x{}</style><script>var a = "<p>no</p>"</script></head>
<body>
<nav class="menu"><a href="/home">Home</a></nav>
<ul id="items">
  <li class="item"><a class="name" href="/p/1">Mug</a> <span class="price">€5</span>
  <li class="item sale"><a class="name" href="https://other.test/p/2">Lamp</a> <span class="price">€20</span>
</ul>
<div class="content"><p>First paragraph with a lot of text about the shop and what it sells.
<p>Second paragraph, unclosed, with <b>bold</b> text and a <a href="/about">link</a>.</div>
<footer>© 2026</footer>
</body></html>`

describe('parseHtml', () => {
	it('closes unclosed li and p, keeps script text out of the tree text', () => {
		const root = parseHtml(PAGE)
		expect(querySelectorAll(root, 'li')).toHaveLength(2)
		expect(querySelectorAll(root, '.content p')).toHaveLength(2)
		expect(textOf(querySelectorAll(root, 'body')[0])).not.toContain('no</p>')
		expect(textOf(querySelectorAll(root, 'title')[0])).toBe('Shop & Co')
	})
})

describe('CSS selector extraction', () => {
	it('matches tag, class, id, child and descendant selectors', () => {
		const root = parseHtml(PAGE)
		expect(querySelectorAll(root, '#items > li.item').map((el) => el.attrs.class)).toEqual(['item', 'item sale'])
		expect(querySelectorAll(root, 'ul .price').map((el) => textOf(el))).toEqual(['€5', '€20'])
		expect(querySelectorAll(root, 'li.sale a.name').map((el) => textOf(el))).toEqual(['Lamp'])
		expect(querySelectorAll(root, 'a[href^="/p/"], footer')).toHaveLength(2)
		expect(querySelectorAll(root, 'li:first-child .name').map((el) => textOf(el))).toEqual(['Mug'])
	})

	it('builds a table of texts and an attribute, links made absolute', () => {
		const table = selectorTable(PAGE, 'a.name', 'href', 'https://shop.test/list')
		expect(table.headers).toEqual(['text', 'href'])
		expect(table.rows).toEqual([
			['Mug', 'https://shop.test/p/1'],
			['Lamp', 'https://other.test/p/2'],
		])
		expect(selectorTable(PAGE, '.price').rows).toEqual([['€5'], ['€20']])
	})

	it('explains a selector it cannot read', () => {
		expect(() => selectorTable(PAGE, '')).toThrow('Type a CSS selector')
		expect(() => selectorTable(PAGE, 'a:hover')).toThrow('does not support')
	})
})

describe('Main article', () => {
	it('picks the block with the most paragraph text, with its title and links', () => {
		const article = extractArticle(PAGE, 'https://shop.test/')
		expect(article.title).toBe('Shop & Co')
		expect(article.text).toContain('First paragraph')
		expect(article.text).not.toContain('Home')
		expect(article.links).toEqual([{ text: 'link', url: 'https://shop.test/about' }])
		const text = formatArticle(article)
		expect(text.startsWith('Shop & Co\n\nFirst paragraph')).toBe(true)
		expect(text).toContain('Links:\n- link: https://shop.test/about')
	})

	it('prefers <article> when there is one', () => {
		const html = '<body><div><p>' + 'x '.repeat(200) + '</p></div><article><h1>Real</h1><p>Body</p></article></body>'
		expect(extractArticle(html).text).toBe('Real\nBody')
	})
})

describe('server extractHtml', () => {
	it('selector mode returns CSV; full mode is the old page text', () => {
		const csv = extractHtml(PAGE, { extract: 'selector', selector: 'a.name', attribute: 'href' }, 'https://shop.test/')
		expect(parseTableText(csv).rows[0]).toEqual(['Mug', 'https://shop.test/p/1'])
		expect(extractHtml(PAGE, {})).toContain('• Mug €5')
		expect(extractHtml(PAGE, { extract: 'article' }, 'https://shop.test/')).toContain('Links:')
	})
})
