/**
 * `data/mcp-config.json` (mode 0600): the MCP servers the user configured. Only secret refs
 * are ever stored, never real values — see `shared/mcpConfig.ts` and `server/mcp.ts`.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { McpConfig, validateMcpConfig } from '../shared/mcpConfig'

function dataDir() {
	return resolve(process.env.DATA_DIR ?? join(process.cwd(), 'data'))
}

const STORE_PATH = join(dataDir(), 'mcp-config.json')

let cached: McpConfig | null = null

export function loadMcpConfig(): McpConfig {
	if (cached) return cached
	if (!existsSync(STORE_PATH)) {
		cached = []
		return cached
	}
	try {
		cached = validateMcpConfig(JSON.parse(readFileSync(STORE_PATH, 'utf8')))
	} catch {
		cached = []
	}
	return cached
}

export function reloadMcpConfig(): McpConfig {
	cached = null
	return loadMcpConfig()
}

export function saveMcpConfig(config: McpConfig) {
	const validated = validateMcpConfig(config)
	mkdirSync(dirname(STORE_PATH), { recursive: true })
	const tmp = `${STORE_PATH}.tmp`
	writeFileSync(tmp, JSON.stringify(validated, null, '\t'), { mode: 0o600 })
	renameSync(tmp, STORE_PATH)
	chmodSync(STORE_PATH, 0o600)
	cached = validated
}

export function getMcpServer(id: string): McpServerConfigOrThrow {
	const server = loadMcpConfig().find((s) => s.id === id)
	if (!server) throw new Error(`Unknown MCP server "${id}". Add it in AI providers.`)
	return server
}

type McpServerConfigOrThrow = ReturnType<typeof loadMcpConfig>[number]
