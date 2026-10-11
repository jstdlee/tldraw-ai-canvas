/**
 * Splitting a SQL script into individual statements, and classifying each one
 * (read vs write, risky vs not). Pure logic, used by the server (running a script
 * statement-by-statement, deciding on a transaction) and the client (the "N
 * statements · M writes" line, the risky-statement confirm, and the run-cache
 * side-effect check in `shared/runCache.ts`).
 */

/**
 * Split a SQL script on statement-terminating semicolons, respecting single-quoted
 * strings ('...', '' escapes the quote), double-quoted identifiers ("..."), dollar-quoted
 * strings ($$...$$ or $tag$...$tag$), line comments (--) and block comments (/* ... *\/).
 * Empty statements (blank, or comment-only) are dropped.
 */
export function splitSqlStatements(sql: string): string[] {
	const statements: string[] = []
	let start = 0
	let i = 0
	const n = sql.length
	while (i < n) {
		const ch = sql[i]
		if (ch === "'" || ch === '"') {
			const quote = ch
			i++
			while (i < n) {
				if (sql[i] === quote) {
					if (sql[i + 1] === quote) {
						i += 2
						continue
					}
					i++
					break
				}
				i++
			}
			continue
		}
		if (ch === '-' && sql[i + 1] === '-') {
			i += 2
			while (i < n && sql[i] !== '\n') i++
			continue
		}
		if (ch === '/' && sql[i + 1] === '*') {
			i += 2
			while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++
			i += 2
			continue
		}
		if (ch === '$') {
			// $$ ... $$ or $tag$ ... $tag$
			const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
			if (tagMatch) {
				const delim = tagMatch[0]
				const close = sql.indexOf(delim, i + delim.length)
				i = close === -1 ? n : close + delim.length
				continue
			}
		}
		if (ch === ';') {
			const stmt = sql.slice(start, i).trim()
			if (stmt) statements.push(stmt)
			start = i + 1
			i++
			continue
		}
		i++
	}
	const tail = sql.slice(start).trim()
	if (tail) statements.push(tail)
	return statements
}

const READ_ONLY_COMMANDS = new Set(['SELECT', 'EXPLAIN', 'SHOW', 'PRAGMA', 'DESCRIBE', 'ANALYZE', 'VALUES', 'TABLE'])
const TRANSACTION_COMMANDS = new Set(['BEGIN', 'COMMIT', 'ROLLBACK', 'START'])

/** First SQL keyword of a statement, uppercased. `WITH ... INSERT/UPDATE/DELETE` looks past the CTEs. */
export function statementCommand(statement: string): string {
	const stripped = statement.replace(/^(\s*--[^\n]*\n|\s*\/\*[\s\S]*?\*\/)+/, '').trim()
	const first = /^[A-Za-z]+/.exec(stripped)?.[0]?.toUpperCase() ?? ''
	if (first !== 'WITH') return first
	// A CTE-prefixed statement: skip the parenthesised CTE bodies, then take the first
	// DML/DDL keyword seen at paren-depth 0 (never one from inside a CTE's own SELECT).
	let depth = 0
	const tokenRe = /[A-Za-z_][A-Za-z0-9_]*|[()]/g
	let m: RegExpExecArray | null
	while ((m = tokenRe.exec(stripped.slice(4)))) {
		const tok = m[0]
		if (tok === '(') depth++
		else if (tok === ')') depth--
		else if (depth === 0 && /^(SELECT|INSERT|UPDATE|DELETE|MERGE)$/i.test(tok)) return tok.toUpperCase()
	}
	return first
}

/** True when running this command can change data or schema. */
export function isWriteCommand(command: string): boolean {
	return !READ_ONLY_COMMANDS.has(command) && !TRANSACTION_COMMANDS.has(command)
}

export function sqlHasWrite(sql: string): boolean {
	return splitSqlStatements(sql).some((stmt) => isWriteCommand(statementCommand(stmt)))
}

export interface RiskyCheck {
	risky: boolean
	reason?: string
}

/** DROP/TRUNCATE, or an UPDATE/DELETE with no WHERE clause (a naive text check: good enough
 * to prompt a confirm, not a guarantee — a WHERE inside a string literal would still count). */
export function isRiskyStatement(statement: string): RiskyCheck {
	const command = statementCommand(statement)
	if (command === 'DROP') return { risky: true, reason: 'Drops a table or other object' }
	if (command === 'TRUNCATE') return { risky: true, reason: 'Removes every row' }
	if ((command === 'DELETE' || command === 'UPDATE') && !/\bWHERE\b/i.test(statement)) {
		return { risky: true, reason: `${command} with no WHERE clause` }
	}
	return { risky: false }
}

export interface StatementSummary {
	count: number
	writes: number
	risky: RiskyCheck[]
}

export function summarizeScript(sql: string): StatementSummary {
	const statements = splitSqlStatements(sql)
	const risky = statements.map(isRiskyStatement)
	const writes = statements.filter((stmt) => isWriteCommand(statementCommand(stmt))).length
	return { count: statements.length, writes, risky }
}
