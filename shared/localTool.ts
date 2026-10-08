/**
 * Local tools run the real gawk, sed, grep, cut, sort, uniq and wc programs on the
 * server, on text sent through stdin. They never read a file and never start a shell.
 * Only whitelisted options pass: anything that can write a file, run a program or
 * name a file (sed w/e, gawk system(), sort -o, grep -f, uniq OUTPUT) is refused.
 */

export const LOCAL_TOOLS = ['grep', 'gawk', 'awk', 'sed', 'cut', 'sort', 'uniq', 'wc'] as const
export type LocalTool = (typeof LOCAL_TOOLS)[number]

interface Spec {
	/** Options without a value, one letter each (they may be combined: -inE). */
	flags: string
	/** Options that take a value. */
	valued: string
	/** Long options without a value. */
	long: string[]
	/** How many bare words are allowed: a program or pattern. */
	words: 0 | 1
	/** Fixed arguments added first. */
	fixed: string[]
	/** How the single word is passed. */
	wordFlag?: string
}

const SPECS: Record<LocalTool, Spec> = {
	grep: { flags: 'ivcnEFwxoqsL', valued: 'mABC', long: ['--ignore-case', '--invert-match', '--count', '--line-number', '--word-regexp', '--only-matching'], words: 1, fixed: [], wordFlag: '-e' },
	gawk: { flags: '', valued: 'Fv', long: [], words: 1, fixed: ['--sandbox'] },
	awk: { flags: '', valued: 'Fv', long: [], words: 1, fixed: ['--sandbox'] },
	sed: { flags: 'nErz', valued: '', long: ['--regexp-extended'], words: 1, fixed: ['--sandbox'], wordFlag: '-e' },
	cut: { flags: 's', valued: 'dfcb', long: [], words: 0, fixed: [] },
	sort: { flags: 'nrufbhVsdM', valued: 'kt', long: ['--numeric-sort', '--reverse', '--unique', '--ignore-case'], words: 0, fixed: [] },
	uniq: { flags: 'cduiD', valued: 'fsw', long: [], words: 0, fixed: [] },
	wc: { flags: 'lwcmL', valued: '', long: ['--lines', '--words', '--bytes', '--chars'], words: 0, fixed: [] },
}

/** Split a command line the way a shell would for quotes only. No expansion, no operators. */
export function splitArgs(line: string): string[] {
	const out: string[] = []
	let cur = ''
	let has = false
	let quote: '"' | "'" | null = null
	for (let i = 0; i < line.length; i++) {
		const ch = line[i]
		if (quote) {
			if (ch === quote) quote = null
			else if (ch === '\\' && quote === '"' && i + 1 < line.length && /["\\$`]/.test(line[i + 1])) cur += line[++i]
			else cur += ch
		} else if (ch === '"' || ch === "'") {
			quote = ch
			has = true
		} else if (/\s/.test(ch)) {
			if (has || cur) out.push(cur)
			cur = ''
			has = false
		} else {
			cur += ch
			has = true
		}
	}
	if (quote) throw new Error('A quote is not closed')
	if (has || cur) out.push(cur)
	return out
}

export function isLocalTool(tool: string): tool is LocalTool {
	return (LOCAL_TOOLS as readonly string[]).includes(tool)
}

/** The program and arguments to run, or an error that says which option is not allowed. */
export function buildToolCommand(tool: string, argLine: string): { cmd: string; args: string[] } {
	if (!isLocalTool(tool)) throw new Error(`Tool must be one of ${LOCAL_TOOLS.join(', ')}`)
	if (/[\n\r\0]/.test(argLine) && tool !== 'gawk' && tool !== 'awk' && tool !== 'sed') throw new Error('Arguments must be one line')
	const spec = SPECS[tool]
	const tokens = splitArgs(argLine)
	if (tokens.length > 40) throw new Error('Too many arguments')
	const args: string[] = [...spec.fixed]
	const words: string[] = []
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i]
		if (t === '--') {
			words.push(...tokens.slice(i + 1))
			break
		}
		if (spec.long.includes(t)) {
			args.push(t)
			continue
		}
		if (/^-[A-Za-z]/.test(t) && !t.startsWith('--')) {
			// -k2 or -k 2: a valued option; -inE: a run of plain flags.
			const letter = t[1]
			if (spec.valued.includes(letter)) {
				const value = t.length > 2 ? t.slice(2) : tokens[++i]
				if (value === undefined) throw new Error(`-${letter} needs a value`)
				args.push(`-${letter}`, value)
				continue
			}
			const rest = t.slice(1)
			if (rest.split('').every((c) => spec.flags.includes(c))) {
				args.push(t)
				continue
			}
			const bad = rest.split('').find((c) => !spec.flags.includes(c))
			throw new Error(`${tool}: option -${bad} is not allowed here`)
		}
		if (t.startsWith('--')) throw new Error(`${tool}: option ${t} is not allowed here`)
		words.push(t)
	}
	if (words.length > spec.words) {
		throw new Error(
			spec.words === 0
				? `${tool} reads the text sent to it. Remove "${words[0]}"`
				: `${tool} takes one ${tool === 'grep' ? 'pattern' : 'program'}. Quote it: '…'`
		)
	}
	if (spec.words === 1 && !words.length) throw new Error(`${tool} needs a ${tool === 'grep' ? 'pattern' : 'program'}`)
	if (words.length) args.push(...(spec.wordFlag ? [spec.wordFlag, words[0]] : [words[0]]))
	return { cmd: tool === 'awk' ? 'gawk' : tool, args }
}
