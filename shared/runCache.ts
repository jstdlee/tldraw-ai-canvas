import { sqlHasWrite } from './sqlStatements'

/**
 * Which cards never use the input-hash run cache (WP14 Part B): side effects
 * (http, download, save, camera, capture), non-determinism (random), time
 * (sleep, and any formula calling today()), and calls whose whole point is a
 * fresh answer each time (chat, image_gen).
 */
export const NO_CACHE_NODE_TYPES: ReadonlySet<string> = new Set([
	'http',
	'download',
	'save',
	'camera',
	'capture',
	'random',
	'sleep',
	'chat',
	'image_gen',
])

/** True when a Database card's SQL (the field, or the wired override already applied to
 * it by the caller) contains a write/DDL statement — a run then has a side effect, so it
 * is never skipped by the cache (WP13). */
function databaseNodeHasWrite(node: Record<string, unknown>): boolean {
	const sql = node.sql
	return typeof sql === 'string' && sql.trim() !== '' && sqlHasWrite(sql)
}

/** True if any string field on the node (a formula, usually) calls today(). */
export function usesTimeDependentFormula(node: Record<string, unknown>): boolean {
	for (const value of Object.values(node)) {
		if (typeof value === 'string' && value.includes('today(')) return true
	}
	return false
}

/** Whether a card of this type/settings may be skipped when its run hash is unchanged. */
export function isRunCacheable(node: { type: string } & Record<string, unknown>): boolean {
	if (NO_CACHE_NODE_TYPES.has(node.type)) return false
	if (node.type === 'database' && databaseNodeHasWrite(node)) return false
	return !usesTimeDependentFormula(node)
}
