/**
 * Keys typed into a node (model API key, HTTP auth value) must not leak into backups,
 * the history log, or prompts sent to a model. Values are blanked by property name.
 * A key can also be given as `env:NAME`, which the server resolves from its environment,
 * so the secret never enters the canvas at all.
 */

const SECRET_KEYS = new Set(['apikey', 'authvalue', 'token', 'secretkey', 'password', 'accesskey'])

export function isSecretKey(key: string): boolean {
	return SECRET_KEYS.has(key.toLowerCase())
}

/** A copy of the value with every secret property set to an empty string. Objects and arrays are walked. */
export function stripSecrets<T>(value: T, depth = 0): T {
	if (depth > 40 || value === null || typeof value !== 'object') return value
	if (Array.isArray(value)) return value.map((item) => stripSecrets(item, depth + 1)) as unknown as T
	const out: Record<string, unknown> = {}
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		out[key] = isSecretKey(key) && typeof item === 'string' && item !== '' ? '' : stripSecrets(item, depth + 1)
	}
	return out as T
}

/** `env:NAME` reads NAME from the environment. Anything else is used as typed. */
export function resolveSecret(value: string | undefined, env: Record<string, string | undefined>): string {
	const text = (value ?? '').trim()
	const match = /^env:([A-Za-z_][A-Za-z0-9_]*)$/.exec(text)
	if (!match) return text
	const found = env[match[1]]
	if (!found) throw new Error(`Environment variable ${match[1]} is not set on the server`)
	return found
}
