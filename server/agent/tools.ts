/**
 * WP31 Part C: builds the agent's tool set — one `web_search` per chosen search provider,
 * every tool of each chosen MCP server (namespaced `server__tool`), and skill-reading tools
 * (`read_skill`, `read_skill_file`) for the chosen skills.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import { McpServerConfig } from '../../shared/mcpConfig'
import { SearchProviderId, SEARCH_PROVIDER_LABELS } from '../../shared/search'
import { SkillInfo } from '../../shared/skills'
import { callMcpTool, listMcpTools } from '../mcp'
import { readSkillFile, readSkillMd } from '../skills'
import { runSearch } from '../search'

/** Result text is truncated before it goes back to the model (keeps context/costs bounded). */
const RESULT_MAX_CHARS = 8000

function truncate(text: string): string {
	return text.length > RESULT_MAX_CHARS ? text.slice(0, RESULT_MAX_CHARS) + '\n…(truncated)' : text
}

export interface SearchProviderChoice {
	provider: SearchProviderId
	keyRef?: string
}

/** One `web_search` tool per configured provider id ("web_search" when there's just one). */
export function buildSearchTools(providers: SearchProviderChoice[]): AgentTool<any>[] {
	return providers.map((choice) => {
		const suffix = providers.length > 1 ? `_${choice.provider}` : ''
		return {
			name: `web_search${suffix}`,
			label: `Web search (${SEARCH_PROVIDER_LABELS[choice.provider]})`,
			description: `Search the web with ${SEARCH_PROVIDER_LABELS[choice.provider]} and get back titles, URLs and snippets.`,
			parameters: Type.Object({
				query: Type.String({ description: 'The search query' }),
				count: Type.Optional(Type.Number({ description: 'How many results (default 5, max 20)' })),
			}),
			execute: async (_id: string, rawParams: unknown, signal?: AbortSignal) => {
				const params = rawParams as { query: string; count?: number }
				const result = await runSearch({
					provider: choice.provider,
					query: params.query,
					count: params.count,
					keyRef: choice.keyRef,
					signal,
				})
				const lines = result.results.map((r) => `- ${r.title} (${r.url})\n  ${r.snippet}`)
				const text = [result.answer, ...lines].filter(Boolean).join('\n') || '(no results)'
				return { content: [{ type: 'text', text: truncate(text) }], details: { provider: choice.provider, count: result.results.length } }
			},
		} satisfies AgentTool<any>
	})
}

/** Every tool of every chosen MCP server, namespaced `<serverId>__<toolName>`. */
export async function buildMcpTools(servers: McpServerConfig[], signal?: AbortSignal): Promise<AgentTool<any>[]> {
	const tools: AgentTool<any>[] = []
	for (const server of servers) {
		let serverTools
		try {
			serverTools = await listMcpTools(server, signal)
		} catch (e) {
			// One misconfigured server shouldn't take down the whole run; it just offers no tools.
			console.warn(`[agent] MCP server "${server.name}" unavailable: ${(e as Error).message}`)
			continue
		}
		for (const tool of serverTools) {
			tools.push({
				name: `${server.id}__${tool.name}`,
				label: `${server.name}: ${tool.name}`,
				description: tool.description || `${tool.name} (from MCP server "${server.name}")`,
				// MCP input schemas are already JSON Schema; pi-ai's Tool.parameters accepts raw
				// JSON Schema-shaped TSchema objects, so pass it through unchanged.
				parameters: (tool.inputSchema ?? Type.Object({})) as any,
				execute: async (_id: string, rawParams: unknown) => {
					const params = (rawParams ?? {}) as Record<string, unknown>
					const result = await callMcpTool(server, tool.name, params, signal)
					return {
						content: [{ type: 'text', text: truncate(result.text) }],
						details: { server: server.id, tool: tool.name },
					}
				},
			} satisfies AgentTool<any>)
		}
	}
	return tools
}

/** `read_skill` (SKILL.md) and `read_skill_file` (other files in that skill's folder only). */
export function buildSkillTools(skills: SkillInfo[]): AgentTool<any>[] {
	if (skills.length === 0) return []
	const ids = new Set(skills.map((s) => s.id))
	return [
		{
			name: 'read_skill',
			label: 'Read skill',
			description: `Read a skill's full SKILL.md. Available skills: ${skills.map((s) => `${s.id} (${s.name})`).join(', ')}.`,
			parameters: Type.Object({ id: Type.String({ description: 'Skill id' }) }),
			execute: async (_id: string, rawParams: unknown) => {
				const params = rawParams as { id: string }
				if (!ids.has(params.id)) throw new Error(`Unknown skill "${params.id}"`)
				return { content: [{ type: 'text', text: truncate(readSkillMd(params.id)) }], details: { id: params.id } }
			},
		},
		{
			name: 'read_skill_file',
			label: 'Read skill file',
			description: 'Read one of a skill\'s other files (path relative to its own folder only).',
			parameters: Type.Object({
				id: Type.String({ description: 'Skill id' }),
				path: Type.String({ description: 'File path, relative to the skill folder' }),
			}),
			execute: async (_id: string, rawParams: unknown) => {
				const params = rawParams as { id: string; path: string }
				if (!ids.has(params.id)) throw new Error(`Unknown skill "${params.id}"`)
				return {
					content: [{ type: 'text', text: truncate(readSkillFile(params.id, params.path)) }],
					details: { id: params.id, path: params.path },
				}
			},
		},
	] satisfies AgentTool<any>[]
}

/** The system-prompt blurb listing chosen skills (name + description only; full text on demand). */
export function skillsSystemPromptBlock(skills: SkillInfo[]): string {
	if (skills.length === 0) return ''
	const lines = skills.map((s) => `- ${s.id}: ${s.name} — ${s.description}`)
	return (
		'\n\nAvailable skills (call read_skill with the id for full instructions before using one):\n' +
		lines.join('\n')
	)
}
