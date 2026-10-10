/**
 * Secrets saved from the canvas (model provider keys). Stored in `data/secrets.json`
 * (mode 0600), keyed by a random id. A node only ever keeps the ref `secret:<id>`;
 * the value is never sent back to the client.
 */

import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// Computed independently from `server/config.ts`'s DATA_DIR (same env var and
// default) rather than imported from it, so the two modules do not import each
// other: `config.ts` needs `getSecretValue` to resolve ad-hoc model refs.
function dataDir() {
	return resolve(process.env.DATA_DIR ?? join(process.cwd(), 'data'))
}

const STORE_PATH = join(dataDir(), 'secrets.json')

type SecretStore = Record<string, string>

function load(): SecretStore {
	if (!existsSync(STORE_PATH)) return {}
	try {
		return JSON.parse(readFileSync(STORE_PATH, 'utf8')) as SecretStore
	} catch {
		return {}
	}
}

function save(store: SecretStore) {
	mkdirSync(dirname(STORE_PATH), { recursive: true })
	const tmp = `${STORE_PATH}.tmp`
	writeFileSync(tmp, JSON.stringify(store), { mode: 0o600 })
	renameSync(tmp, STORE_PATH)
	chmodSync(STORE_PATH, 0o600)
}

/** Save a value and return its new id (used as `secret:<id>`). */
export function createSecret(value: string): string {
	const store = load()
	const id = randomUUID().replace(/-/g, '')
	store[id] = value
	save(store)
	return id
}

/** The saved value, or undefined if the id is unknown. Never logged, never returned to the client. */
export function getSecretValue(id: string): string | undefined {
	return load()[id]
}

export function deleteSecret(id: string) {
	const store = load()
	if (!(id in store)) return
	delete store[id]
	save(store)
}
