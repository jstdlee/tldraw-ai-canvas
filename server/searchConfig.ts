/**
 * WP24: per-provider keys for the Web search card (Exa, Tavily, Brave), saved from the AI
 * providers dialog's "Search providers" section. Stored in `data/search-config.json` (mode
 * 0600) as a `secret:<id>` ref per provider — never the raw key, which lives only in the
 * secret store (secretsStore.ts) and is resolved at request time. The card uses the saved
 * key for its provider unless the card itself carries its own `keyRef`.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { SearchProviderId } from '../shared/search'

// Computed independently from DATA_DIR, same as secretsStore.ts, to avoid an import cycle.
function dataDir() {
	return resolve(process.env.DATA_DIR ?? join(process.cwd(), 'data'))
}

const STORE_PATH = join(dataDir(), 'search-config.json')

export type SearchConfig = Partial<Record<SearchProviderId, { keyRef?: string }>>

let cached: SearchConfig | null = null

export function loadSearchConfig(): SearchConfig {
	if (cached) return cached
	if (!existsSync(STORE_PATH)) {
		cached = {}
		return cached
	}
	try {
		cached = JSON.parse(readFileSync(STORE_PATH, 'utf8')) as SearchConfig
	} catch {
		cached = {}
	}
	return cached
}

export function saveSearchConfig(config: SearchConfig) {
	mkdirSync(dirname(STORE_PATH), { recursive: true })
	const tmp = `${STORE_PATH}.tmp`
	writeFileSync(tmp, JSON.stringify(config, null, '\t'), { mode: 0o600 })
	renameSync(tmp, STORE_PATH)
	chmodSync(STORE_PATH, 0o600)
	cached = config
}
