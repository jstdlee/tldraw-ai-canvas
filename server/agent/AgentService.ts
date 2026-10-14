import { ModelMessage, streamText } from 'ai'
import { DebugPart } from '../../shared/schema/PromptPartDefinitions'
import { AgentAction } from '../../shared/types/AgentAction'
import { AgentPrompt } from '../../shared/types/AgentPrompt'
import { getPromptPartDefinition } from '../../shared/types/PromptPart'
import { Streaming } from '../../shared/types/Streaming'
import { resolveModel } from '../config'
import { getLanguageModel, getProviderOptions } from '../llm'
import { buildMessages } from './prompt/buildMessages'
import { buildSystemPrompt } from './prompt/buildSystemPrompt'
import { closeAndParseJson } from './closeAndParseJson'

const PREFILL = '{"actions": [{"_type":'

/**
 * Hard idle timeout (Problem 1b): if the model stalls — a dead local router, a provider
 * that accepts the request but never streams anything back — the request used to hang
 * forever with no error. Reset on every text chunk; overridable for tests.
 */
export const AGENT_STREAM_IDLE_TIMEOUT_MS = Number(process.env.AGENT_STREAM_IDLE_TIMEOUT_MS) || 90_000

/**
 * Re-yield `iterable`, but throw a clear timeout error if no chunk arrives within `ms` of
 * the previous one (or of the start). Needed because a provider-level failure (missing/bad
 * API key, an unreachable local router, a model that silently drops the connection) can
 * leave the underlying stream open with no further chunks and no error of its own.
 */
export async function* withIdleTimeout<T>(iterable: AsyncIterable<T>, ms: number): AsyncGenerator<T> {
	const iterator = iterable[Symbol.asyncIterator]()
	try {
		while (true) {
			let timer: ReturnType<typeof setTimeout>
			const timedOut = new Promise<'timeout'>((resolve) => {
				timer = setTimeout(() => resolve('timeout'), ms)
			})
			const next = iterator.next()
			const result = await Promise.race([next, timedOut])
			clearTimeout(timer!)
			if (result === 'timeout') {
				throw new Error(
					`No response from the model after ${Math.round(ms / 1000)}s. ` +
						`The provider may be unreachable, misconfigured, or stuck. Try again or pick a different model.`
				)
			}
			if (result.done) return
			yield result.value
		}
	} finally {
		// Best-effort cleanup only, fire-and-forget: the underlying reader may already be
		// released (stream ended normally, or the request was aborted), in which case
		// `.return()` itself throws — that must never shadow the real error/result above.
		// It must also never be awaited here: if the step we timed out on is genuinely stuck
		// (the promise it's awaiting never settles, not just slow), `.return()` on an async
		// generator queues behind that in-flight step and would never resolve either,
		// defeating the whole point of the timeout above.
		try {
			iterator.return?.()?.catch(() => {})
		} catch {
			// ignore synchronous throws from `.return()` too
		}
	}
}

/** The model key the client picked (a prompt part may carry it). */
function getRequestedModelKey(prompt: AgentPrompt): string | null {
	for (const part of Object.values(prompt)) {
		const definition = getPromptPartDefinition(part.type)
		const name = definition.getModelName?.(part)
		if (name) return name
	}
	return null
}

/**
 * Turn an agent prompt into a stream of canvas actions, using the model the
 * user picked from their own providers.
 */
export async function* streamAgentActions(
	prompt: AgentPrompt,
	signal?: AbortSignal
): AsyncGenerator<Streaming<AgentAction>> {
	const { model: modelConfig, provider } = resolveModel(getRequestedModelKey(prompt), 'agent')
	const model = getLanguageModel(provider, modelConfig)

	const systemPrompt = buildSystemPrompt(prompt)
	// Anthropic needs the system prompt as a message to mark it for caching;
	// everyone else gets it through the `system` option.
	const isAnthropic = provider.kind === 'anthropic'
	const messages: ModelMessage[] = isAnthropic
		? [
				{
					role: 'system',
					content: systemPrompt,
					providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
				},
			]
		: []
	const promptMessages = buildMessages(prompt)
	messages.push(...promptMessages)

	const debugPart = prompt.debug as DebugPart | undefined
	if (debugPart?.logSystemPrompt) {
		console.log('[DEBUG] System Prompt:\n', buildSystemPrompt(prompt, { withSchema: false }))
	}
	if (debugPart?.logMessages) {
		console.log('[DEBUG] Messages:\n', JSON.stringify(promptMessages, null, 2))
	}

	// Prefill the assistant turn to force the JSON start, where the model allows it.
	const prefill = !!modelConfig.supportsPrefill
	if (prefill) messages.push({ role: 'assistant', content: PREFILL })

	// Problem 1b: `onError` throwing here does NOT reliably propagate as an exception out of
	// `textStream`'s iteration (confirmed: a missing-API-key failure against a local router
	// left `textStream` ending with zero chunks and no thrown error, which used to surface as
	// the generic "did not return canvas actions" message below — hiding the real cause).
	// Capture it instead, and prefer it over the generic message once the stream ends.
	let streamError: unknown = null
	const { textStream } = streamText({
		model,
		...(isAnthropic ? { allowSystemInMessages: true } : { system: systemPrompt }),
		messages,
		maxOutputTokens: modelConfig.maxOutputTokens ?? 16384,
		...(modelConfig.supportsTemperature === false ? {} : { temperature: 0 }),
		providerOptions: getProviderOptions(provider, modelConfig),
		abortSignal: signal,
		onError: ({ error }) => {
			streamError = error
		},
	})

	// Anthropic and Google continue the prefilled turn; others repeat it.
	let buffer = prefill && (provider.kind === 'anthropic' || provider.kind === 'google') ? PREFILL : ''
	let cursor = 0
	let maybeIncompleteAction: AgentAction | null = null
	let startTime = Date.now()

	for await (const text of withIdleTimeout(textStream, AGENT_STREAM_IDLE_TIMEOUT_MS)) {
		buffer += text
		const partialObject = closeAndParseJson(stripToJson(buffer))
		if (!partialObject) continue

		const actions = partialObject.actions
		if (!Array.isArray(actions) || actions.length === 0) continue

		// The list grew past the cursor, so the previous action is complete.
		if (actions.length > cursor) {
			const action = actions[cursor - 1] as AgentAction
			if (action) {
				yield { ...action, complete: true, time: Date.now() - startTime }
				maybeIncompleteAction = null
			}
			cursor++
		}

		// Yield the current action in its (possibly incomplete) state.
		const action = actions[cursor - 1] as AgentAction
		if (action) {
			if (!maybeIncompleteAction) startTime = Date.now()
			maybeIncompleteAction = action
			yield { ...action, complete: false, time: Date.now() - startTime }
		}
	}

	if (maybeIncompleteAction) {
		yield { ...maybeIncompleteAction, complete: true, time: Date.now() - startTime }
	}

	if (cursor === 0) {
		if (streamError) {
			// A real provider/transport failure (bad key, unreachable host, model refused the
			// request, …): surface it as-is instead of the generic "wrong format" message.
			const message = streamError instanceof Error ? streamError.message : String(streamError)
			console.warn(`[agent] ${modelConfig.key} failed: ${message}`)
			throw new Error(message)
		}
		// The model answered, but not in the agent's JSON format. Small local
		// models often do this; say so instead of silently doing nothing.
		const preview = buffer.trim().slice(0, 400) || '(empty reply)'
		console.warn(`[agent] ${modelConfig.key} returned no actions. Reply starts:\n${preview}`)
		throw new Error(
			`${modelConfig.label || modelConfig.key} did not return canvas actions. ` +
				`Try a stronger agent model. Reply started: ${preview.slice(0, 160)}`
		)
	}
}

/**
 * Local models often wrap JSON in ```json fences or write a short preamble, or
 * emit <think>…</think> first. Drop everything before the first `{`.
 */
export function stripToJson(text: string): string {
	let t = text
	const thinkEnd = t.lastIndexOf('</think>')
	if (thinkEnd !== -1) t = t.slice(thinkEnd + '</think>'.length)
	else if (t.trimStart().startsWith('<think>')) return ''
	const start = t.indexOf('{')
	if (start === -1) return ''
	t = t.slice(start)
	const fence = t.lastIndexOf('```')
	return fence !== -1 ? t.slice(0, fence) : t
}
