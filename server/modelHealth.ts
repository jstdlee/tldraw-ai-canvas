/**
 * WP14 Part C: check that each default model (agent, chat, vision, jev,
 * image) actually answers, so the AI providers dialog can show a status dot
 * and the app can toast once when a default is broken.
 */
import { generateText } from 'ai'
import { CapabilityHealth, ModelCapability, ModelsHealth } from '../shared/aiConfig'
import { resolveModel } from './config'
import { decide } from './jev'
import { getLanguageModel } from './llm'

const CACHE_MS = 10 * 60 * 1000
const TIMEOUT_MS = 10_000
const CAPABILITIES: ModelCapability[] = ['agent', 'chat', 'vision', 'jev', 'image']

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout>
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`No answer within ${Math.round(ms / 1000)}s`)), ms)
	})
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>
}

async function checkOne(capability: ModelCapability): Promise<CapabilityHealth> {
	let model: string | undefined
	try {
		const { model: modelConfig, provider } = resolveModel(undefined, capability)
		model = modelConfig.key
		if (capability === 'image') {
			// Image generation has no cheap test call; a configured model is enough.
			return { ok: true, model }
		}
		if (capability === 'jev') {
			await withTimeout(decide({ model, question: 'Health check: answer yes.', type: 'noul' }), TIMEOUT_MS)
			return { ok: true, model }
		}
		await withTimeout(
			generateText({
				model: getLanguageModel(provider, modelConfig),
				messages: [{ role: 'user', content: 'hi' }],
				maxOutputTokens: 1,
			}),
			TIMEOUT_MS
		)
		return { ok: true, model }
	} catch (e) {
		return { ok: false, model, error: e instanceof Error ? e.message : String(e) }
	}
}

let cache: { at: number; result: ModelsHealth } | null = null

/** Health of every default model, cached for 10 minutes. */
export async function checkModelsHealth(force = false): Promise<ModelsHealth> {
	if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.result
	const entries = await Promise.all(CAPABILITIES.map(async (cap) => [cap, await checkOne(cap)] as const))
	const result: ModelsHealth = Object.fromEntries(entries)
	cache = { at: Date.now(), result }
	return result
}
