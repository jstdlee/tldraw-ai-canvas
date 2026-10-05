/** Light syntax colour and auto-format for the code and text editors. No extra parser dependency. */

const KEYWORDS: Record<string, string[]> = {
	js: ['async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'else', 'export', 'false', 'for', 'from', 'function', 'if', 'import', 'let', 'new', 'null', 'return', 'switch', 'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'while'],
	ts: ['async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'else', 'export', 'false', 'for', 'from', 'function', 'if', 'implements', 'import', 'interface', 'let', 'new', 'null', 'number', 'return', 'string', 'switch', 'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'var', 'while'],
	py: ['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'elif', 'else', 'except', 'for', 'from', 'if', 'import', 'in', 'is', 'lambda', 'not', 'or', 'pass', 'return', 'try', 'while', 'with', 'yield'],
	sql: ['AND', 'AS', 'BY', 'CREATE', 'DELETE', 'FROM', 'GROUP', 'INSERT', 'INTO', 'JOIN', 'LIMIT', 'NOT', 'NULL', 'OR', 'ORDER', 'SELECT', 'SET', 'TABLE', 'UPDATE', 'VALUES', 'WHERE'],
}

export type CodeLang = 'js' | 'ts' | 'py' | 'sql' | 'json' | 'text'

export function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function highlightText(html: string): string {
	return html
		.replace(/<[^>]+>/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
}

interface Token {
	kind: string
	text: string
}

function keywordsFor(lang: string): Set<string> {
	if (lang === 'ts') return new Set(KEYWORDS.ts)
	if (lang === 'py') return new Set(KEYWORDS.py)
	if (lang === 'sql') return new Set(KEYWORDS.sql.map((word) => word.toLowerCase()))
	return new Set(KEYWORDS.js)
}

/** Split source into tokens. The joined text is the source. */
export function tokenize(code: string, lang: string): Token[] {
	const keywords = keywordsFor(lang === 'sql' ? 'sql' : lang)
	const tokens: Token[] = []
	let i = 0
	const push = (kind: string, text: string) => tokens.push({ kind, text })
	while (i < code.length) {
		const ch = code[i]
		if (ch === '/' && code[i + 1] === '/') {
			let j = i
			while (j < code.length && code[j] !== '\n') j++
			push('com', code.slice(i, j))
			i = j
			continue
		}
		if (ch === '#' && lang === 'py') {
			let j = i
			while (j < code.length && code[j] !== '\n') j++
			push('com', code.slice(i, j))
			i = j
			continue
		}
		if (ch === '/' && code[i + 1] === '*') {
			let j = i + 2
			while (j < code.length && !(code[j] === '*' && code[j + 1] === '/')) j++
			j = Math.min(code.length, j + 2)
			push('com', code.slice(i, j))
			i = j
			continue
		}
		if (ch === '"' || ch === "'" || ch === '`') {
			let j = i + 1
			while (j < code.length) {
				if (code[j] === '\\') {
					j += 2
					continue
				}
				if (code[j] === ch) {
					j++
					break
				}
				if (ch !== '`' && code[j] === '\n') break
				j++
			}
			push('str', code.slice(i, j))
			i = j
			continue
		}
		if (/[A-Za-z_$]/.test(ch)) {
			let j = i + 1
			while (j < code.length && /[A-Za-z0-9_$]/.test(code[j])) j++
			const word = code.slice(i, j)
			const lookup = lang === 'sql' ? word.toLowerCase() : word
			push(keywords.has(lookup) ? 'key' : 'name', word)
			i = j
			continue
		}
		if (/[0-9]/.test(ch)) {
			let j = i + 1
			while (j < code.length && /[0-9.]/.test(code[j])) j++
			push('num', code.slice(i, j))
			i = j
			continue
		}
		push('plain', ch)
		i++
	}
	return tokens
}

export function highlightCode(code: string, lang: string): string {
	return tokenize(code, lang)
		.map((token) => `<span class="tok-${token.kind}">${escapeHtml(token.text)}</span>`)
		.join('')
}

function trimTrailing(text: string): string {
	return text
		.replace(/[ \t]+$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
}

/** Indent braces, brackets and parentheses. Strings and comments stay intact. */
export function formatBraces(source: string): string {
	const text = trimTrailing(source.replace(/\t/g, '  '))
	let out = ''
	let indent = 0
	let i = 0
	let lineStart = true
	const pad = () => '  '.repeat(Math.max(0, indent))
	const write = (chunk: string) => {
		if (lineStart && chunk !== '\n') {
			out += pad()
			lineStart = false
		}
		out += chunk
	}
	while (i < text.length) {
		const ch = text[i]
		if (ch === '"' || ch === "'" || ch === '`') {
			let j = i + 1
			while (j < text.length) {
				if (text[j] === '\\') {
					j += 2
					continue
				}
				if (text[j] === ch) {
					j++
					break
				}
				if (ch !== '`' && text[j] === '\n') break
				j++
			}
			write(text.slice(i, j))
			i = j
			continue
		}
		if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
			const block = text[i + 1] === '*'
			let j = i + 2
			if (block) {
				while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j++
				j = Math.min(text.length, j + 2)
			} else {
				while (j < text.length && text[j] !== '\n') j++
			}
			write(text.slice(i, j))
			i = j
			continue
		}
		if (ch === '\n') {
			out += '\n'
			i++
			lineStart = true
			continue
		}
		if ((ch === ' ' || ch === '\t') && lineStart) {
			i++
			continue
		}
		if (ch === '}' || ch === ']' || ch === ')') {
			indent = Math.max(0, indent - 1)
			write(ch)
			i++
			continue
		}
		write(ch)
		if (ch === '{' || ch === '[' || ch === '(') indent++
		i++
	}
	const trimmed = out.replace(/[ \t]+\n/g, '\n').replace(/\s+$/, '')
	return trimmed ? `${trimmed}\n` : ''
}

export function formatPlain(source: string): string {
	const trimmed = trimTrailing(source).replace(/\s+$/, '')
	return trimmed ? `${trimmed}\n` : ''
}

export function formatPython(source: string): string {
	const text = source.replace(/\t/g, '    ')
	const lines = trimTrailing(text).replace(/\s+$/, '').split('\n')
	return lines.length ? `${lines.join('\n')}\n` : ''
}

export function formatSql(source: string): string {
	const upper = source.replace(/\s+/g, ' ').trim()
	if (!upper) return ''
	const broken = upper
		.replace(/\b(select|from|where|group by|order by|insert into|values|update|set|create table|delete from|and|or)\b/gi, (word) => {
			const lead = /^(and|or)$/i.test(word) ? '  ' : '\n'
			return `${lead}${word.toUpperCase()}`
		})
		.replace(/^\n/, '')
	return `${broken}\n`
}

export function formatCode(source: string, lang: string): string {
	if (lang === 'json') {
		try {
			return `${JSON.stringify(JSON.parse(source), null, 2)}\n`
		} catch {
			return formatBraces(source)
		}
	}
	if (lang === 'py') return formatPython(source)
	if (lang === 'sql') return formatSql(source)
	if (lang === 'text') return formatPlain(source)
	return formatBraces(source)
}
