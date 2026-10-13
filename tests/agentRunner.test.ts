import type { AgentTool } from '@mariozechner/pi-agent-core'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, Type } from '@mariozechner/pi-ai'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { closeAllMcpConnections, callMcpTool, listMcpTools } from '../server/mcp'
import { runAgent } from '../server/agent/runner'
import { AgentRunEvent } from '../server/agent/types'
import { McpServerConfig } from '../shared/mcpConfig'

const FIXTURE = join(__dirname, 'fixtures', 'fake-mcp-server.mjs')
const fakeMcpServer: McpServerConfig = {
	id: 'fake',
	name: 'Fake MCP',
	transport: 'stdio',
	command: process.execPath,
	args: [FIXTURE],
	enabled: true,
}

/** A `web_search`-shaped tool that never touches the network: a fixed, fake result set. */
const fakeWebSearchTool: AgentTool<any> = {
	name: 'web_search',
	label: 'Web search (fake)',
	description: 'Fake web search for tests',
	parameters: Type.Object({ query: Type.String() }),
	execute: async (_id: string, rawParams: unknown) => {
		const params = rawParams as { query: string }
		return {
			content: [{ type: 'text' as const, text: `Fake result for "${params.query}": the sky is blue` }],
			details: {},
		}
	},
}

async function buildFakeMcpTools(signal?: AbortSignal): Promise<AgentTool<any>[]> {
	const tools = await listMcpTools(fakeMcpServer, signal)
	const built: AgentTool<any>[] = tools.map((t) => ({
		name: `${fakeMcpServer.id}__${t.name}`,
		label: t.name,
		description: t.description ?? '',
		parameters: (t.inputSchema ?? Type.Object({})) as any,
		execute: async (_id: string, rawParams: unknown) => {
			const result = await callMcpTool(fakeMcpServer, t.name, (rawParams ?? {}) as Record<string, unknown>, signal)
			return { content: [{ type: 'text' as const, text: result.text }], details: {} }
		},
	}))
	return built
}

async function collect(gen: AsyncGenerator<AgentRunEvent>): Promise<AgentRunEvent[]> {
	const out: AgentRunEvent[] = []
	for await (const e of gen) out.push(e)
	return out
}

describe('agent runner: pi-agent-core + pi-ai, no network (faux model + fake MCP)', () => {
	afterAll(async () => {
		await closeAllMcpConnections()
	})

	it('calls web_search then an MCP tool, then answers', async () => {
		const reg = registerFauxProvider({
			models: [{ id: 'faux-1' }],
		})
		reg.setResponses([
			fauxAssistantMessage([fauxToolCall('web_search', { query: 'sky color' })]),
			fauxAssistantMessage([fauxToolCall('fake__echo', { text: 'done' })]),
			fauxAssistantMessage('The sky is blue. (DONE)'),
		])
		const mcpTools = await buildFakeMcpTools()
		const events = await collect(
			runAgent({
				model: reg.getModel(),
				systemPrompt: 'You are a test agent.',
				task: 'What color is the sky?',
				tools: [fakeWebSearchTool, ...mcpTools],
				maxSteps: 10,
				maxRunMs: 15_000,
			})
		)
		reg.unregister()

		const toolCalls = events.filter((e) => e.type === 'tool_call')
		const toolResults = events.filter((e) => e.type === 'tool_result')
		expect(toolCalls.map((e: any) => e.name)).toEqual(['web_search', 'fake__echo'])
		expect(toolResults).toHaveLength(2)
		expect((toolResults[0] as any).resultPreview).toMatch(/sky is blue/)
		expect((toolResults[1] as any).resultPreview).toBe('DONE')

		const final = events.find((e) => e.type === 'final') as Extract<AgentRunEvent, { type: 'final' }>
		expect(final).toBeTruthy()
		expect(final.output).toMatch(/DONE/)
		expect(final.steps.some((s) => s.kind === 'tool_call' && s.name === 'web_search')).toBe(true)
	})

	it('stops after maxSteps turns even if the model keeps calling tools', async () => {
		const reg = registerFauxProvider({ models: [{ id: 'faux-2' }] })
		reg.setResponses([
			fauxAssistantMessage([fauxToolCall('web_search', { query: 'a' })]),
			fauxAssistantMessage([fauxToolCall('web_search', { query: 'b' })]),
			fauxAssistantMessage([fauxToolCall('web_search', { query: 'c' })]),
			fauxAssistantMessage([fauxToolCall('web_search', { query: 'd' })]),
			fauxAssistantMessage('should not get here'),
		])
		const events = await collect(
			runAgent({
				model: reg.getModel(),
				systemPrompt: 'test',
				task: 'loop forever',
				tools: [fakeWebSearchTool],
				maxSteps: 2,
				maxRunMs: 15_000,
			})
		)
		reg.unregister()
		const toolCalls = events.filter((e) => e.type === 'tool_call')
		expect(toolCalls.length).toBeLessThanOrEqual(2)
		const final = events.find((e) => e.type === 'final' || e.type === 'error')
		expect(final).toBeTruthy()
		if (final?.type === 'final') expect(final.output).toMatch(/step limit/)
	})

	it('propagates external abort as a stop, not a crash', async () => {
		const reg = registerFauxProvider({ models: [{ id: 'faux-3' }] })
		reg.setResponses([
			fauxAssistantMessage([fauxToolCall('web_search', { query: 'a' })]),
			fauxAssistantMessage('done'),
		])
		const controller = new AbortController()
		controller.abort()
		const events = await collect(
			runAgent({
				model: reg.getModel(),
				systemPrompt: 'test',
				task: 'anything',
				tools: [fakeWebSearchTool],
				maxSteps: 5,
				maxRunMs: 15_000,
				signal: controller.signal,
			})
		)
		reg.unregister()
		expect(events.some((e) => e.type === 'error')).toBe(true)
	})
})
