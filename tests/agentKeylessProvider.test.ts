import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { apiKeyOrLocalPlaceholder } from '../server/llm'
import { toPiModel } from '../server/agent/model'
import { runAgent } from '../server/agent/runner'
import { AgentRunEvent } from '../server/agent/types'
import { ModelConfig, ProviderConfig } from '../shared/aiConfig'

/**
 * AI-01/FLOW-01/GAPS-03: the Agent card refused to run against a keyless local/self-hosted
 * provider (e.g. this project's own Magpie setup) with "No API key for provider: openai", even
 * though every other LLM card tolerates the exact same empty key fine. The fix mirrors
 * `server/llm.ts`'s `apiKeyOrLocalPlaceholder` in `server/index.ts`'s `/api/agent/run` route.
 *
 * This drives the real `@mariozechner/pi-ai` `openai-completions` provider (not the faux/mock
 * one `agentRunner.test.ts` uses, which never reaches the real "no key" check at all) against a
 * tiny local OpenAI-compatible fixture, so the exact failure mode and the fix are both real.
 */

const servers: Server[] = []

afterAll(async () => {
	await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))))
})

function sseChunk(obj: unknown): string {
	return `data: ${JSON.stringify(obj)}\n\n`
}

/** A minimal OpenAI-compatible `/v1/chat/completions` endpoint: streams back one fixed reply.
 * Like a real local/keyless router (Magpie/Ollama/LiteLLM), it never checks the Authorization
 * header's value — only records whether one was sent at all. */
function startFixtureServer(reply: string): Promise<{ baseURL: string; sawAuth: () => string | undefined }> {
	let lastAuth: string | undefined
	const server = createServer((req, res) => {
		if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
			lastAuth = req.headers.authorization
			res.writeHead(200, { 'Content-Type': 'text/event-stream' })
			res.write(
				sseChunk({
					id: '1',
					object: 'chat.completion.chunk',
					created: 1,
					model: 'm',
					choices: [{ index: 0, delta: { role: 'assistant', content: reply }, finish_reason: null }],
				})
			)
			res.write(
				sseChunk({
					id: '1',
					object: 'chat.completion.chunk',
					created: 1,
					model: 'm',
					choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
				})
			)
			res.write('data: [DONE]\n\n')
			res.end()
			return
		}
		res.writeHead(404)
		res.end()
	})
	servers.push(server)
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo
			resolve({ baseURL: `http://127.0.0.1:${port}/v1`, sawAuth: () => lastAuth })
		})
	})
}

function provider(partial: Partial<ProviderConfig>): ProviderConfig {
	return { id: 'local', name: 'Local', kind: 'openai', enabled: true, ...partial }
}
function model(partial: Partial<ModelConfig>): ModelConfig {
	return { key: 'local/m', providerId: 'local', model: 'm', label: 'M', capabilities: ['agent'], ...partial }
}

async function collect(gen: AsyncGenerator<AgentRunEvent>): Promise<AgentRunEvent[]> {
	const out: AgentRunEvent[] = []
	for await (const e of gen) out.push(e)
	return out
}

describe('Agent card against a keyless local/self-hosted provider', () => {
	it('(the old bug) throws "No API key for provider" when an empty key is passed straight through', async () => {
		const fixture = await startFixtureServer('should never be reached')
		const p = provider({ baseURL: fixture.baseURL, apiKey: '' })
		const piModel = toPiModel(p, model({}))
		// The exact expression `server/index.ts` used before the fix:
		// `provider.apiKey || (provider.kind === 'cloudflare' ? provider.apiKey : undefined)`.
		const oldApiKey = p.apiKey || (((p.kind as string) === 'cloudflare') ? p.apiKey : undefined)
		const events = await collect(
			runAgent({ model: piModel, apiKey: oldApiKey, systemPrompt: 't', task: 'say ok', tools: [], maxSteps: 3, maxRunMs: 5000 })
		)
		const error = events.find((e) => e.type === 'error') as Extract<AgentRunEvent, { type: 'error' }> | undefined
		expect(error?.message).toMatch(/No API key for provider/)
	})

	it('(the fix) runs successfully once the route uses apiKeyOrLocalPlaceholder', async () => {
		const fixture = await startFixtureServer('ok, hi!')
		const p = provider({ baseURL: fixture.baseURL, apiKey: '' })
		const piModel = toPiModel(p, model({}))
		const apiKey = apiKeyOrLocalPlaceholder(p) // what server/index.ts now actually passes
		const events = await collect(
			runAgent({ model: piModel, apiKey, systemPrompt: 't', task: 'say ok', tools: [], maxSteps: 3, maxRunMs: 5000 })
		)
		const final = events.find((e) => e.type === 'final') as Extract<AgentRunEvent, { type: 'final' }> | undefined
		expect(events.find((e) => e.type === 'error')).toBeUndefined()
		expect(final?.output).toContain('ok, hi!')
		// A harmless placeholder was sent, not nothing (the fixture, like a real local router,
		// never validates it).
		expect(fixture.sawAuth()).toBeTruthy()
	})

	it('still uses the real key when one is configured (never overridden by the placeholder)', async () => {
		const fixture = await startFixtureServer('ok')
		const p = provider({ baseURL: fixture.baseURL, apiKey: 'sk-real-secret' })
		expect(apiKeyOrLocalPlaceholder(p)).toBe('sk-real-secret')
	})
})
