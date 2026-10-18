/**
 * The DataPipe formula language: a small tokenizer + Pratt-style recursive-descent parser +
 * evaluator. No `eval`, no dependency. `evaluateFormula` is the engine; `shared/tableOps.ts`'s
 * `evalFormula(expr, record)` wraps it so old canvases keep working unchanged (see WP11-columns.md
 * Part A). Pure and tested in Node (tests/formula.test.ts).
 */

export class FormulaError extends Error {}

type Value = number | string | boolean | null

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokType = 'num' | 'str' | 'ident' | 'colref' | 'op' | 'lparen' | 'rparen' | 'comma' | 'eof'

interface Tok {
	type: TokType
	text: string
	value?: number | string
	pos: number
}

const TWO_CHAR_OPS = ['<=', '>=', '!=']
const ONE_CHAR_OPS = '+-*/%=<>&'

function tokenize(source: string): Tok[] {
	const toks: Tok[] = []
	const n = source.length
	let i = 0
	while (i < n) {
		const c = source[i]
		if (/\s/.test(c)) {
			i++
			continue
		}
		if (c === '(') {
			toks.push({ type: 'lparen', text: '(', pos: i })
			i++
			continue
		}
		if (c === ')') {
			toks.push({ type: 'rparen', text: ')', pos: i })
			i++
			continue
		}
		if (c === ',') {
			toks.push({ type: 'comma', text: ',', pos: i })
			i++
			continue
		}
		if (c === '[') {
			const start = i
			const end = source.indexOf(']', i + 1)
			if (end === -1) throw new FormulaError(`Formula: missing "]" to close a column name (started at "${source.slice(start)}")`)
			const name = source.slice(i + 1, end)
			toks.push({ type: 'colref', text: name, value: name, pos: start })
			i = end + 1
			continue
		}
		if (c === '"' || c === "'") {
			const quote = c
			const start = i
			let j = i + 1
			let s = ''
			while (j < n && source[j] !== quote) {
				s += source[j]
				j++
			}
			if (j >= n) throw new FormulaError(`Formula: missing closing ${quote} for the string starting at "${source.slice(start)}"`)
			toks.push({ type: 'str', text: s, value: s, pos: start })
			i = j + 1
			continue
		}
		if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
			const start = i
			let j = i
			while (j < n && /[0-9]/.test(source[j])) j++
			if (source[j] === '.') {
				j++
				while (j < n && /[0-9]/.test(source[j])) j++
			}
			const text = source.slice(start, j)
			toks.push({ type: 'num', text, value: Number(text), pos: start })
			i = j
			continue
		}
		if (/[A-Za-z_]/.test(c)) {
			const start = i
			let j = i
			while (j < n && /[A-Za-z0-9_]/.test(source[j])) j++
			toks.push({ type: 'ident', text: source.slice(start, j), pos: start })
			i = j
			continue
		}
		const two = source.slice(i, i + 2)
		if (TWO_CHAR_OPS.includes(two)) {
			toks.push({ type: 'op', text: two, pos: i })
			i += 2
			continue
		}
		if (ONE_CHAR_OPS.includes(c)) {
			toks.push({ type: 'op', text: c, pos: i })
			i++
			continue
		}
		throw new FormulaError(`Formula: unexpected character "${c}" in ${JSON.stringify(source)}`)
	}
	toks.push({ type: 'eof', text: '', pos: n })
	return toks
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

type Node =
	| { type: 'num'; value: number }
	| { type: 'str'; value: string }
	| { type: 'bool'; value: boolean }
	| { type: 'null' }
	| { type: 'col'; name: string }
	| { type: 'call'; name: string; args: Node[] }
	| { type: 'bin'; op: string; left: Node; right: Node }
	| { type: 'concat'; left: Node; right: Node }
	| { type: 'and' | 'or'; left: Node; right: Node }
	| { type: 'not'; operand: Node }
	| { type: 'neg'; operand: Node }

const COMPARISON_OPS = ['=', '!=', '<', '<=', '>', '>=']

class Parser {
	private pos = 0
	constructor(
		private toks: Tok[],
		private source: string
	) {}

	private peek(): Tok {
		return this.toks[this.pos]
	}
	private next(): Tok {
		return this.toks[this.pos++]
	}
	private isIdent(text: string): boolean {
		const t = this.peek()
		return t.type === 'ident' && t.text.toLowerCase() === text
	}
	private sourceUpTo(pos: number): string {
		return this.source.slice(0, pos).trim()
	}
	private expect(type: TokType, label: string): Tok {
		const t = this.peek()
		if (t.type === type) return this.next()
		throw new FormulaError(`Formula: expected "${label}" after ${this.sourceUpTo(t.pos) || '(nothing)'}`)
	}

	parse(): Node {
		const node = this.parseOr()
		if (this.peek().type !== 'eof') {
			throw new FormulaError(`Formula: unexpected text after ${this.sourceUpTo(this.peek().pos)}`)
		}
		return node
	}

	private parseOr(): Node {
		let left = this.parseAnd()
		while (this.isIdent('or')) {
			this.next()
			const right = this.parseAnd()
			left = { type: 'or', left, right }
		}
		return left
	}

	private parseAnd(): Node {
		let left = this.parseNot()
		while (this.isIdent('and')) {
			this.next()
			const right = this.parseNot()
			left = { type: 'and', left, right }
		}
		return left
	}

	private parseNot(): Node {
		if (this.isIdent('not')) {
			this.next()
			return { type: 'not', operand: this.parseNot() }
		}
		return this.parseComparison()
	}

	private parseComparison(): Node {
		let left = this.parseConcat()
		while (this.peek().type === 'op' && COMPARISON_OPS.includes(this.peek().text)) {
			const op = this.next().text
			const right = this.parseConcat()
			left = { type: 'bin', op, left, right }
		}
		return left
	}

	private parseConcat(): Node {
		let left = this.parseAdditive()
		while (this.peek().type === 'op' && this.peek().text === '&') {
			this.next()
			const right = this.parseAdditive()
			left = { type: 'concat', left, right }
		}
		return left
	}

	private parseAdditive(): Node {
		let left = this.parseMultiplicative()
		while (this.peek().type === 'op' && (this.peek().text === '+' || this.peek().text === '-')) {
			const op = this.next().text
			const right = this.parseMultiplicative()
			left = { type: 'bin', op, left, right }
		}
		return left
	}

	private parseMultiplicative(): Node {
		let left = this.parseUnary()
		while (this.peek().type === 'op' && ['*', '/', '%'].includes(this.peek().text)) {
			const op = this.next().text
			const right = this.parseUnary()
			left = { type: 'bin', op, left, right }
		}
		return left
	}

	private parseUnary(): Node {
		if (this.peek().type === 'op' && this.peek().text === '-') {
			this.next()
			return { type: 'neg', operand: this.parseUnary() }
		}
		return this.parsePrimary()
	}

	private parseArgs(): Node[] {
		const args: Node[] = []
		if (this.peek().type !== 'rparen') {
			args.push(this.parseOr())
			while (this.peek().type === 'comma') {
				this.next()
				args.push(this.parseOr())
			}
		}
		this.expect('rparen', ')')
		return args
	}

	private parsePrimary(): Node {
		const t = this.peek()
		if (t.type === 'num') {
			this.next()
			return { type: 'num', value: t.value as number }
		}
		if (t.type === 'str') {
			this.next()
			return { type: 'str', value: t.value as string }
		}
		if (t.type === 'colref') {
			this.next()
			return { type: 'col', name: t.value as string }
		}
		if (t.type === 'lparen') {
			this.next()
			const inner = this.parseOr()
			this.expect('rparen', ')')
			return inner
		}
		if (t.type === 'ident') {
			const lower = t.text.toLowerCase()
			if (lower === 'true' || lower === 'false') {
				this.next()
				return { type: 'bool', value: lower === 'true' }
			}
			if (lower === 'null') {
				this.next()
				return { type: 'null' }
			}
			this.next()
			if (this.peek().type === 'lparen') {
				this.next()
				const args = this.parseArgs()
				return { type: 'call', name: t.text, args }
			}
			return { type: 'col', name: t.text }
		}
		throw new FormulaError(`Formula: expected a value after ${this.sourceUpTo(t.pos) || '(nothing)'}`)
	}
}

function parse(source: string): Node {
	return new Parser(tokenize(source), source).parse()
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export interface FormulaOptions {
	/** Injectable clock for `today()`, so tests can fix the date. */
	now?: () => Date
}

interface Ctx {
	row: Record<string, string>
	now: () => Date
}

function tryNumber(v: Value): number | null {
	if (typeof v === 'number') return Number.isFinite(v) ? v : null
	if (typeof v === 'boolean') return v ? 1 : 0
	if (v === null) return null
	const s = v.trim()
	if (s === '') return null
	const cleaned = s.replace(/,/g, '')
	if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
	return Number(cleaned)
}

function toText(v: Value): string {
	if (v === null || v === undefined) return ''
	if (typeof v === 'boolean') return v ? 'true' : 'false'
	if (typeof v === 'number') return String(v)
	return v
}

function asNumber(v: Value, what = 'a number'): number {
	const n = tryNumber(v)
	if (n === null) throw new FormulaError(`Formula: expected ${what} but got "${toText(v)}"`)
	return n
}

function asBoolean(v: Value): boolean {
	if (typeof v === 'boolean') return v
	if (v === null) return false
	if (typeof v === 'number') return v !== 0
	const s = v.trim()
	if (s === '') return false
	if (s.toLowerCase() === 'true') return true
	if (s.toLowerCase() === 'false') return false
	const n = tryNumber(v)
	if (n !== null) return n !== 0
	return true
}

function looseEquals(a: Value, b: Value): boolean {
	if (a === null || b === null) return a === b
	const an = tryNumber(a)
	const bn = tryNumber(b)
	if (an !== null && bn !== null) return an === bn
	return toText(a) === toText(b)
}

function looseCompare(a: Value, b: Value): number {
	const an = tryNumber(a)
	const bn = tryNumber(b)
	if (an !== null && bn !== null) return an - bn
	return toText(a).localeCompare(toText(b))
}

function resolveColumn(name: string, ctx: Ctx): Value {
	if (Object.prototype.hasOwnProperty.call(ctx.row, name)) return ctx.row[name] ?? ''
	const columns = Object.keys(ctx.row)
	throw new FormulaError(`Formula: no column named "${name}". Columns: ${columns.join(', ') || '(none)'}`)
}

function evalBin(op: string, a: Value, b: Value): Value {
	switch (op) {
		case '+': {
			const an = tryNumber(a)
			const bn = tryNumber(b)
			if (an !== null && bn !== null) return an + bn
			return toText(a) + toText(b)
		}
		case '-':
			return asNumber(a) - asNumber(b)
		case '*':
			return asNumber(a) * asNumber(b)
		case '/': {
			const bn = asNumber(b)
			if (bn === 0) throw new FormulaError('Formula: division by zero')
			return asNumber(a) / bn
		}
		case '%': {
			const bn = asNumber(b)
			if (bn === 0) throw new FormulaError('Formula: division by zero')
			return asNumber(a) % bn
		}
		case '=':
			return looseEquals(a, b)
		case '!=':
			return !looseEquals(a, b)
		case '<':
			return looseCompare(a, b) < 0
		case '<=':
			return looseCompare(a, b) <= 0
		case '>':
			return looseCompare(a, b) > 0
		case '>=':
			return looseCompare(a, b) >= 0
		default:
			throw new FormulaError(`Formula: unknown operator ${op}`)
	}
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function parseDateValue(v: Value): Date {
	const text = toText(v)
	const date = new Date(text)
	if (Number.isNaN(date.getTime())) throw new FormulaError(`Formula: "${text}" is not a date`)
	return date
}

function pad2(n: number): string {
	return String(n).padStart(2, '0')
}

function formatDateISO(d: Date): string {
	return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

function isoWeek(date: Date): number {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
	const dayNum = (d.getUTCDay() + 6) % 7 // Mon=0 .. Sun=6
	d.setUTCDate(d.getUTCDate() - dayNum + 3)
	const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
	const diff = (d.getTime() - firstThursday.getTime()) / 86_400_000
	return 1 + Math.round(diff / 7)
}

function dateUnitDiff(a: Date, b: Date, unit: string): number {
	if (unit === 'day') {
		const an = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())
		const bn = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())
		return Math.round((bn - an) / 86_400_000)
	}
	if (unit === 'month') {
		return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
	}
	if (unit === 'year') return b.getUTCFullYear() - a.getUTCFullYear()
	throw new FormulaError(`Formula: datediff unit must be "day", "month" or "year", got "${unit}"`)
}

function dateAdd(date: Date, n: number, unit: string): Date {
	const d = new Date(date.getTime())
	if (unit === 'day') d.setUTCDate(d.getUTCDate() + n)
	else if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + n)
	else if (unit === 'year') d.setUTCFullYear(d.getUTCFullYear() + n)
	else throw new FormulaError(`Formula: dateadd unit must be "day", "month" or "year", got "${unit}"`)
	return d
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

const FUNCTION_NAMES = [
	'upper', 'lower', 'trim', 'len', 'left', 'right', 'mid', 'replace', 'contains', 'startswith',
	'endswith', 'split', 'concat', 'text', 'domain', 'path',
	'number', 'round', 'floor', 'ceil', 'abs', 'min', 'max', 'pow', 'sqrt',
	'if', 'ifs', 'coalesce', 'isempty',
	'date', 'year', 'month', 'day', 'weekday', 'week', 'quarter', 'hour', 'datediff', 'dateadd', 'today',
]

function levenshtein(a: string, b: string): number {
	const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
	for (let j = 0; j <= b.length; j++) dp[0][j] = j
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
		}
	}
	return dp[a.length][b.length]
}

/** P8: `domain(url)`/`path(url)` for a formula column built from a URL (e.g. a web-search
 * result) — accepts a URL with no scheme (adds `https://` to parse it) so a bare host like
 * "example.com/blog/post-1" still works. */
function parseUrlFormula(text: string): URL {
	try {
		return new URL(text)
	} catch {
		try {
			return new URL(`https://${text}`)
		} catch {
			throw new FormulaError(`Formula: "${text}" is not a URL`)
		}
	}
}

function unknownFunctionError(name: string): FormulaError {
	const lower = name.toLowerCase()
	const close = FUNCTION_NAMES.filter((fn) => levenshtein(fn, lower) <= 2).sort((a, b) => levenshtein(a, lower) - levenshtein(b, lower))
	if (close.length) return new FormulaError(`Formula: unknown function "${name}". Did you mean ${close.slice(0, 3).join(', ')}?`)
	return new FormulaError(`Formula: unknown function "${name}"`)
}

function requireArgs(name: string, args: unknown[], count: number) {
	if (args.length < count) throw new FormulaError(`Formula: ${name}(...) needs ${count} argument${count === 1 ? '' : 's'}`)
}

function callFunction(name: string, args: Value[], ctx: Ctx): Value {
	const lower = name.toLowerCase()
	switch (lower) {
		case 'upper':
			requireArgs(name, args, 1)
			return toText(args[0]).toUpperCase()
		case 'lower':
			requireArgs(name, args, 1)
			return toText(args[0]).toLowerCase()
		case 'trim':
			requireArgs(name, args, 1)
			return toText(args[0]).trim()
		case 'len':
			requireArgs(name, args, 1)
			return toText(args[0]).length
		case 'left':
			requireArgs(name, args, 2)
			return toText(args[0]).slice(0, Math.max(0, asNumber(args[1])))
		case 'right': {
			requireArgs(name, args, 2)
			const n = Math.max(0, asNumber(args[1]))
			return n === 0 ? '' : toText(args[0]).slice(-n)
		}
		case 'mid': {
			requireArgs(name, args, 3)
			const start = Math.max(1, asNumber(args[1]))
			const count = Math.max(0, asNumber(args[2]))
			return toText(args[0]).slice(start - 1, start - 1 + count)
		}
		case 'replace': {
			requireArgs(name, args, 3)
			const find = toText(args[1])
			if (find === '') return toText(args[0])
			return toText(args[0]).split(find).join(toText(args[2]))
		}
		case 'contains':
			requireArgs(name, args, 2)
			return toText(args[0]).includes(toText(args[1]))
		case 'startswith':
			requireArgs(name, args, 2)
			return toText(args[0]).startsWith(toText(args[1]))
		case 'endswith':
			requireArgs(name, args, 2)
			return toText(args[0]).endsWith(toText(args[1]))
		case 'split': {
			requireArgs(name, args, 3)
			const parts = toText(args[0]).split(toText(args[1]))
			const index = asNumber(args[2])
			return parts[index] ?? ''
		}
		case 'concat':
			return args.map(toText).join('')
		case 'text':
			requireArgs(name, args, 1)
			return toText(args[0])
		case 'domain':
			requireArgs(name, args, 1)
			return parseUrlFormula(toText(args[0]).trim()).hostname
		case 'path':
			requireArgs(name, args, 1)
			return parseUrlFormula(toText(args[0]).trim()).pathname
		case 'number':
			requireArgs(name, args, 1)
			return asNumber(args[0], `a number for number(${JSON.stringify(toText(args[0]))})`)
		case 'round': {
			requireArgs(name, args, 1)
			const decimals = args.length > 1 ? Math.max(0, Math.trunc(asNumber(args[1]))) : 0
			return asNumber(args[0]).toFixed(decimals)
		}
		case 'floor':
			requireArgs(name, args, 1)
			return Math.floor(asNumber(args[0]))
		case 'ceil':
			requireArgs(name, args, 1)
			return Math.ceil(asNumber(args[0]))
		case 'abs':
			requireArgs(name, args, 1)
			return Math.abs(asNumber(args[0]))
		case 'min':
			requireArgs(name, args, 1)
			return Math.min(...args.map((a) => asNumber(a)))
		case 'max':
			requireArgs(name, args, 1)
			return Math.max(...args.map((a) => asNumber(a)))
		case 'pow':
			requireArgs(name, args, 2)
			return Math.pow(asNumber(args[0]), asNumber(args[1]))
		case 'sqrt':
			requireArgs(name, args, 1)
			return Math.sqrt(asNumber(args[0]))
		case 'isempty':
			requireArgs(name, args, 1)
			return args[0] === null || toText(args[0]).trim() === ''
		case 'date':
			requireArgs(name, args, 1)
			return formatDateISO(parseDateValue(args[0]))
		case 'year':
			requireArgs(name, args, 1)
			return parseDateValue(args[0]).getUTCFullYear()
		case 'month':
			requireArgs(name, args, 1)
			return parseDateValue(args[0]).getUTCMonth() + 1
		case 'day':
			requireArgs(name, args, 1)
			return parseDateValue(args[0]).getUTCDate()
		case 'weekday': {
			requireArgs(name, args, 1)
			const day = parseDateValue(args[0]).getUTCDay()
			return day === 0 ? 7 : day
		}
		case 'week':
			requireArgs(name, args, 1)
			return isoWeek(parseDateValue(args[0]))
		case 'quarter':
			requireArgs(name, args, 1)
			return Math.floor(parseDateValue(args[0]).getUTCMonth() / 3) + 1
		case 'hour':
			requireArgs(name, args, 1)
			return parseDateValue(args[0]).getUTCHours()
		case 'datediff':
			requireArgs(name, args, 3)
			return dateUnitDiff(parseDateValue(args[0]), parseDateValue(args[1]), toText(args[2]))
		case 'dateadd':
			requireArgs(name, args, 3)
			return formatDateISO(dateAdd(parseDateValue(args[0]), asNumber(args[1]), toText(args[2])))
		case 'today':
			return formatDateISO(ctx.now())
		default:
			throw unknownFunctionError(name)
	}
}

function evaluate(node: Node, ctx: Ctx): Value {
	switch (node.type) {
		case 'num':
			return node.value
		case 'str':
			return node.value
		case 'bool':
			return node.value
		case 'null':
			return null
		case 'col':
			return resolveColumn(node.name, ctx)
		case 'neg':
			return -asNumber(evaluate(node.operand, ctx))
		case 'not':
			return !asBoolean(evaluate(node.operand, ctx))
		case 'and':
			return asBoolean(evaluate(node.left, ctx)) ? asBoolean(evaluate(node.right, ctx)) : false
		case 'or':
			return asBoolean(evaluate(node.left, ctx)) ? true : asBoolean(evaluate(node.right, ctx))
		case 'concat':
			return toText(evaluate(node.left, ctx)) + toText(evaluate(node.right, ctx))
		case 'bin':
			return evalBin(node.op, evaluate(node.left, ctx), evaluate(node.right, ctx))
		case 'call':
			return evalCall(node.name, node.args, ctx)
	}
}

function evalCall(nameRaw: string, argNodes: Node[], ctx: Ctx): Value {
	const name = nameRaw.toLowerCase()
	if (name === 'if') {
		requireArgs(nameRaw, argNodes, 3)
		return asBoolean(evaluate(argNodes[0], ctx)) ? evaluate(argNodes[1], ctx) : evaluate(argNodes[2], ctx)
	}
	if (name === 'ifs') {
		if (argNodes.length < 3 || argNodes.length % 2 === 0) {
			throw new FormulaError('Formula: ifs(...) needs condition/value pairs plus one final else value')
		}
		for (let i = 0; i + 1 < argNodes.length; i += 2) {
			if (asBoolean(evaluate(argNodes[i], ctx))) return evaluate(argNodes[i + 1], ctx)
		}
		return evaluate(argNodes[argNodes.length - 1], ctx)
	}
	if (name === 'coalesce') {
		requireArgs(nameRaw, argNodes, 1)
		for (const argNode of argNodes) {
			const value = evaluate(argNode, ctx)
			if (value !== null && toText(value) !== '') return value
		}
		return null
	}
	const args = argNodes.map((argNode) => evaluate(argNode, ctx))
	return callFunction(nameRaw, args, ctx)
}

/** Evaluate a formula against one row. `row` keys are the table's columns (used for
 * "unknown column" error listings). `options.now` fixes the clock for `today()` in tests. */
export function evaluateFormula(expr: string, row: Record<string, string>, options: FormulaOptions = {}): string {
	const source = expr.trim()
	if (!source) return ''
	const node = parse(source)
	const ctx: Ctx = { row, now: options.now ?? (() => new Date()) }
	return toText(evaluate(node, ctx))
}
