import { describe, expect, it } from 'vitest'
import { withIdleTimeout, AGENT_STREAM_IDLE_TIMEOUT_MS } from '../server/agent/AgentService'
import { closeAndParseJson } from '../server/agent/closeAndParseJson'
import { stripToJson } from '../server/agent/AgentService'
import { apiKeyOrLocalPlaceholder } from '../server/llm'
import { ProviderConfig } from '../shared/aiConfig'

/**
 * Problem 1 (owner's "hi" gets no reply): two real root causes, reproduced against the
 * owner's actual provider/model config (openai kind pointed at a local Magpie router,
 * `opencode-go/deepseek-v4.1-flash` — a reasoning model whose replies include a separate
 * `reasoning_content`/`reasoning` stream alongside the real answer):
 *
 * 1. `@ai-sdk/openai` refuses to build a client at all without an `apiKey`
 *    (`AI_LoadAPIKeyError`), even for a local router that ignores auth. That failure happens
 *    inside `streamText`'s streaming internals, not as a synchronous throw, so `textStream`
 *    just ends with zero chunks and no error — see `withIdleTimeout` below for why that no
 *    longer hangs forever either.
 * 2. With no idle timeout, a stalled request (bad key, unreachable router, a model that
 *    drops the connection after emitting only `reasoning_content` and no final answer) hung
 *    the SSE connection forever: no reply, and no error bubble, matching exactly what was
 *    reported.
 */

function provider(partial: Partial<ProviderConfig>): ProviderConfig {
	return { id: 'magpie', name: 'Magpie', kind: 'openai', enabled: true, ...partial }
}

describe('apiKeyOrLocalPlaceholder (fix for silent AI_LoadAPIKeyError against local routers)', () => {
	it('fills in a placeholder for a custom baseURL with no key (e.g. a local Magpie/Ollama/LiteLLM router)', () => {
		expect(apiKeyOrLocalPlaceholder(provider({ baseURL: 'http://127.0.0.1:3425/v1' }))).toBeTruthy()
	})

	it('keeps a real key when one is configured', () => {
		expect(apiKeyOrLocalPlaceholder(provider({ baseURL: 'http://127.0.0.1:3425/v1', apiKey: 'sk-real' }))).toBe(
			'sk-real'
		)
	})

	it('does not invent a key for the real cloud endpoint (no custom baseURL)', () => {
		expect(apiKeyOrLocalPlaceholder(provider({ baseURL: undefined }))).toBeUndefined()
	})
})

/** A fake `textStream`: only `type: 'text'` chunks ever reach `textStream` — the AI SDK already
 * strips `reasoning`/`reasoning_content` deltas out of it upstream, so the "reasoning_content
 * fixture" here is the realistic shape of what's left once that filtering has happened: a long
 * silent gap (the reasoning phase, producing nothing on this stream) followed by the real
 * answer. */
async function* fakeTextStreamAfterReasoningGap(gapMs: number, chunks: string[]) {
	await new Promise((resolve) => setTimeout(resolve, gapMs))
	for (const chunk of chunks) {
		yield chunk
	}
}

describe('withIdleTimeout (fix for a hang with no error — Problem 1b)', () => {
	it('tolerates a long reasoning-phase gap before the real answer, as long as it is under the limit', async () => {
		const chunks: string[] = []
		for await (const chunk of withIdleTimeout(fakeTextStreamAfterReasoningGap(50, ['{"actions": [{"_type": "message", "text": "hi"}]}']), 2000)) {
			chunks.push(chunk)
		}
		const parsed = closeAndParseJson(stripToJson(chunks.join('')))
		expect(parsed.actions).toEqual([{ _type: 'message', text: 'hi' }])
	})

	it('throws a clear, bounded-time error when the model never produces anything (stuck in reasoning, dropped connection, bad key)', async () => {
		async function* neverResolves() {
			await new Promise(() => {}) // a provider that accepts the request but never streams back
			yield 'unreachable'
		}
		const start = Date.now()
		await expect(async () => {
			for await (const _ of withIdleTimeout(neverResolves(), 50)) {
				// never reached
			}
		}).rejects.toThrow(/No response from the model after/)
		expect(Date.now() - start).toBeLessThan(1000)
	})

	it('resets the timer on every chunk instead of using one deadline for the whole stream', async () => {
		async function* slowButSteady() {
			for (const chunk of ['a', 'b', 'c']) {
				await new Promise((resolve) => setTimeout(resolve, 40))
				yield chunk
			}
		}
		// Each individual gap (40ms) is under the 80ms idle limit, even though the total
		// stream duration (120ms+) exceeds it.
		const chunks: string[] = []
		for await (const chunk of withIdleTimeout(slowButSteady(), 80)) {
			chunks.push(chunk)
		}
		expect(chunks).toEqual(['a', 'b', 'c'])
	})

	it('does not swallow the real result if cleanup (iterator.return) itself fails', async () => {
		async function* streamWithBrokenReturn() {
			yield 'ok'
		}
		const iterable = streamWithBrokenReturn()
		const original = iterable.return?.bind(iterable)
		iterable.return = (() => {
			throw new Error('reader not attached to a stream')
		}) as typeof original
		const chunks: string[] = []
		for await (const chunk of withIdleTimeout(iterable, 1000)) {
			chunks.push(chunk)
		}
		expect(chunks).toEqual(['ok'])
	})

	it('has a sane production default (90s)', () => {
		expect(AGENT_STREAM_IDLE_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000)
	})
})

describe('agent reply parsing with a reasoning preamble (fixture)', () => {
	it('still extracts the message action once an open-ended <think> block from a reasoning model is stripped', () => {
		const reasoningThenAnswer =
			'<think>The user said hi, a simple greeting, I should reply warmly and briefly.</think>' +
			'{"actions": [{"_type": "message", "text": "Hi! How can I help?"}]}'
		expect(closeAndParseJson(stripToJson(reasoningThenAnswer))).toEqual({
			actions: [{ _type: 'message', text: 'Hi! How can I help?' }],
		})
	})
})
