/**
 * WP31: MCP (Model Context Protocol) servers the agent card can use. Config is saved to
 * `data/mcp-config.json` (mode 0600). Secrets (env values, header values) are never stored
 * raw — only `secret:<id>` / `env:NAME` refs, resolved on the server at connect time
 * (see `server/mcp.ts`). The client only ever sees this shape (never a resolved secret).
 */

export type McpTransportKind = 'stdio' | 'http'

export interface McpStdioServerConfig {
	id: string
	name: string
	transport: 'stdio'
	command: string
	args?: string[]
	/** Env var name -> value, where the value may be a `secret:<id>` / `env:NAME` ref. */
	env?: Record<string, string>
	cwd?: string
	enabled: boolean
}

export interface McpHttpServerConfig {
	id: string
	name: string
	transport: 'http'
	/** Streamable HTTP endpoint URL. */
	url: string
	/** Header name -> value, where the value may be a `secret:<id>` / `env:NAME` ref. */
	headers?: Record<string, string>
	enabled: boolean
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig

export type McpConfig = McpServerConfig[]

function isNonEmptyString(v: unknown): v is string {
	return typeof v === 'string' && v.trim().length > 0
}

function isStringRecord(v: unknown): v is Record<string, string> {
	if (v == null) return true
	if (typeof v !== 'object' || Array.isArray(v)) return false
	return Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string')
}

/** A value that is only ever a ref: `secret:<id>` (the secret store) or `env:NAME` (the
 * server's own environment) — see `shared/secrets.ts`'s `resolveSecret`. */
const REF_PATTERN = /^(secret:[A-Za-z0-9_-]+|env:[A-Za-z_][A-Za-z0-9_]*)$/

/** Env/header names that plausibly hold a credential. A value under one of these keys must
 * be a ref, never a raw literal — otherwise a real key could land in `mcp-config.json` in
 * plain text by a copy-paste mistake. */
const SECRET_LIKE_NAME = /auth|token|key|secret|password|credential/i

/** Checks a name -> value map (env or headers) for a secret-looking name with a raw value. */
function findRawSecretLikeValue(map: Record<string, string> | undefined, label: string, ownerName: string): string | null {
	for (const [key, value] of Object.entries(map ?? {})) {
		if (SECRET_LIKE_NAME.test(key) && value && !REF_PATTERN.test(value)) {
			return `"${ownerName}": ${label} "${key}" looks like a secret; use a secret: or env: reference, not a raw value`
		}
	}
	return null
}

/** Human-readable validation error, or null if `entry` is a valid server config. */
export function validateMcpServer(entry: unknown): string | null {
	if (!entry || typeof entry !== 'object') return 'Server entry must be an object'
	const e = entry as Record<string, unknown>
	if (!isNonEmptyString(e.id)) return 'Server needs an id'
	if (!isNonEmptyString(e.name)) return 'Server needs a name'
	if (e.transport === 'stdio') {
		if (!isNonEmptyString(e.command)) return `"${e.name}": stdio server needs a command`
		if (e.args !== undefined && (!Array.isArray(e.args) || !e.args.every((a) => typeof a === 'string'))) {
			return `"${e.name}": args must be a list of strings`
		}
		if (!isStringRecord(e.env)) return `"${e.name}": env must be a map of string values`
		if (e.cwd !== undefined && typeof e.cwd !== 'string') return `"${e.name}": cwd must be a string`
		return findRawSecretLikeValue(e.env as Record<string, string> | undefined, 'env var', e.name as string)
	}
	if (e.transport === 'http') {
		if (!isNonEmptyString(e.url)) return `"${e.name}": HTTP server needs a URL`
		if (!/^https?:\/\//.test(e.url as string)) return `"${e.name}": URL must start with http:// or https://`
		if (!isStringRecord(e.headers)) return `"${e.name}": headers must be a map of string values`
		return findRawSecretLikeValue(e.headers as Record<string, string> | undefined, 'header', e.name as string)
	}
	return `"${e.name}": transport must be "stdio" or "http"`
}

/** Validates a whole config array; throws with the first problem found. */
export function validateMcpConfig(config: unknown): McpConfig {
	if (!Array.isArray(config)) throw new Error('MCP config must be a list of servers')
	const ids = new Set<string>()
	for (const entry of config) {
		const problem = validateMcpServer(entry)
		if (problem) throw new Error(problem)
		const id = (entry as McpServerConfig).id
		if (ids.has(id)) throw new Error(`Duplicate server id "${id}"`)
		ids.add(id)
	}
	return config as McpConfig
}

/** What the client is allowed to see: never raw secret values (refs are fine, they aren't secret). */
export type PublicMcpServerConfig = McpServerConfig

export function toPublicMcpConfig(config: McpConfig): PublicMcpServerConfig[] {
	// Refs (`secret:<id>` / `env:NAME`) are not secret values themselves, so the whole
	// config can be returned as-is; only server/secretsStore.ts holds real values.
	return config
}
