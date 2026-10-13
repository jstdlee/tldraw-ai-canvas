/**
 * WP31 Part B: MCP client. Connections are opened on demand (first tool list/call for a
 * server) and closed after an idle period, so a misbehaving stdio server does not keep
 * running forever. Secrets in `env`/`headers` are refs (`secret:<id>` / `env:NAME`):
 * resolved here, right before spawning/connecting, and never sent to the client or logged.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpServerConfig } from '../shared/mcpConfig'
import { resolveSecret } from '../shared/secrets'
import { getSecretValue } from './secretsStore'

const IDLE_CLOSE_MS = 5 * 60_000
const CALL_TIMEOUT_MS = 60_000
const CONNECT_TIMEOUT_MS = 20_000

export interface McpToolInfo {
	name: string
	description?: string
	inputSchema: unknown
}

interface OpenConnection {
	client: Client
	idleTimer: ReturnType<typeof setTimeout>
	closing: Promise<void> | null
}

const connections = new Map<string, OpenConnection>()

function resolveMap(map: Record<string, string> | undefined): Record<string, string> {
	const out: Record<string, string> = {}
	for (const [key, value] of Object.entries(map ?? {})) {
		out[key] = resolveSecret(value, process.env, getSecretValue)
	}
	return out
}

function scheduleIdleClose(id: string) {
	const conn = connections.get(id)
	if (!conn) return
	clearTimeout(conn.idleTimer)
	conn.idleTimer = setTimeout(() => {
		void closeServer(id)
	}, IDLE_CLOSE_MS)
	// Don't keep the process alive just for an idle MCP connection.
	conn.idleTimer.unref?.()
}

async function connect(server: McpServerConfig): Promise<Client> {
	const client = new Client({ name: 'oh-my-tldraw', version: '1.0.0' }, { capabilities: {} })
	const transport =
		server.transport === 'stdio'
			? new StdioClientTransport({
					command: server.command,
					args: server.args,
					env: { ...resolveMap(server.env) },
					cwd: server.cwd,
					stderr: 'ignore',
				})
			: new StreamableHTTPClientTransport(new URL(server.url), {
					requestInit: { headers: resolveMap(server.headers) },
				})
	const timeout = new Promise<never>((_, reject) =>
		setTimeout(() => reject(new Error(`Connecting to "${server.name}" timed out`)), CONNECT_TIMEOUT_MS)
	)
	await Promise.race([client.connect(transport), timeout])
	return client
}

/** Get (or open) the connection for a server. Resets the idle-close timer on every use. */
async function getConnection(server: McpServerConfig): Promise<Client> {
	if (!server.enabled) throw new Error(`MCP server "${server.name}" is turned off`)
	const existing = connections.get(server.id)
	if (existing && !existing.closing) {
		scheduleIdleClose(server.id)
		return existing.client
	}
	const client = await connect(server)
	const conn: OpenConnection = { client, idleTimer: setTimeout(() => {}, 0), closing: null }
	connections.set(server.id, conn)
	scheduleIdleClose(server.id)
	client.onclose = () => {
		if (connections.get(server.id) === conn) connections.delete(server.id)
	}
	return client
}

export async function closeServer(id: string) {
	const conn = connections.get(id)
	if (!conn) return
	clearTimeout(conn.idleTimer)
	connections.delete(id)
	try {
		await conn.client.close()
	} catch {
		// best effort
	}
}

export async function closeAllMcpConnections() {
	await Promise.all([...connections.keys()].map(closeServer))
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string, signal?: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), ms)
		const onAbort = () => {
			clearTimeout(timer)
			reject(new Error('Aborted'))
		}
		signal?.addEventListener('abort', onAbort, { once: true })
		promise
			.then((v) => {
				clearTimeout(timer)
				signal?.removeEventListener('abort', onAbort)
				resolve(v)
			})
			.catch((e) => {
				clearTimeout(timer)
				signal?.removeEventListener('abort', onAbort)
				reject(e)
			})
	})
}

/** List a server's tools (used for "Test connection" and to build the agent's tool set). */
export async function listMcpTools(server: McpServerConfig, signal?: AbortSignal): Promise<McpToolInfo[]> {
	const client = await getConnection(server)
	const result = await withTimeout(
		client.listTools(),
		CALL_TIMEOUT_MS,
		`Listing tools from "${server.name}" timed out`,
		signal
	)
	return result.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
}

export interface McpCallResult {
	text: string
	isError: boolean
}

/** Call one tool on a server. Text content is joined; non-text content is summarized. */
export async function callMcpTool(
	server: McpServerConfig,
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal
): Promise<McpCallResult> {
	const client = await getConnection(server)
	const result = await withTimeout(
		client.callTool({ name: toolName, arguments: args }),
		CALL_TIMEOUT_MS,
		`Calling "${toolName}" on "${server.name}" timed out`,
		signal
	)
	const content = Array.isArray(result.content) ? result.content : []
	const text = content
		.map((block: { type: string; text?: string }) =>
			block.type === 'text' ? (block.text ?? '') : `[${block.type} content]`
		)
		.join('\n')
		.trim()
	return { text: text || '(no output)', isError: !!result.isError }
}
