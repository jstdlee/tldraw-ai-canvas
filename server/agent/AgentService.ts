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

	const { textStream } = streamText({
		model,
		...(isAnthropic ? { allowSystemInMessages: true } : { system: systemPrompt }),
		messages,
		maxOutputTokens: modelConfig.maxOutputTokens ?? 16384,
		...(modelConfig.supportsTemperature === false ? {} : { temperature: 0 }),
		providerOptions: getProviderOptions(provider, modelConfig),
		abortSignal: signal,
		onError: ({ error }) => {
			throw error
		},
	})

	// Anthropic and Google continue the prefilled turn; others repeat it.
	let buffer = prefill && (provider.kind === 'anthropic' || provider.kind === 'google') ? PREFILL : ''
	let cursor = 0
	let maybeIncompleteAction: AgentAction | null = null
	let startTime = Date.now()

	for await (const text of textStream) {
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
