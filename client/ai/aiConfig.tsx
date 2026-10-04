import { atom, useValue } from 'tldraw'
import {
	getDefaultModelKey,
	ModelCapability,
	ModelConfig,
	PublicAIConfig,
	PublicProviderConfig,
} from '../../shared/aiConfig'

/** The user's AI providers and models, as served by the local server (no keys). */
export const $aiConfig = atom<PublicAIConfig | null>('ai config', null)
export const $aiConfigError = atom<string | null>('ai config error', null)

async function readJson<T>(res: Response): Promise<T> {
	const data = await res.json().catch(() => ({ error: res.statusText }))
	if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
	return data as T
}

let retryTimer: ReturnType<typeof setTimeout> | undefined

/** Load the config; while the server is down, keep retrying every 3 s. */
export async function refreshAIConfig() {
	clearTimeout(retryTimer)
	try {
		$aiConfig.set(await readJson<PublicAIConfig>(await fetch('/api/config')))
		$aiConfigError.set(null)
	} catch (e) {
		$aiConfigError.set(`Cannot reach the local server: ${(e as Error).message}`)
		retryTimer = setTimeout(refreshAIConfig, 3000)
	}
}

// Another tab (or a script) may have changed the config.
if (typeof window !== 'undefined') window.addEventListener('focus', () => refreshAIConfig())

/** Save the config. Providers may carry a new `apiKey` ('' clears it). */
export async function saveAIConfig(
	config: Omit<PublicAIConfig, 'providers'> & {
		providers: (PublicProviderConfig & { apiKey?: string })[]
	}
) {
	const saved = await readJson<PublicAIConfig>(
		await fetch('/api/config', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(config),
		})
	)
	$aiConfig.set(saved)
	return saved
}

export async function fetchProviderModels(
	provider: PublicProviderConfig & { apiKey?: string }
): Promise<{ id: string; label?: string; vision?: boolean }[]> {
	const res = await fetch('/api/providers/models', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ provider }),
	})
	return (await readJson<{ models: { id: string; label?: string; vision?: boolean }[] }>(res)).models
}

export function useAIConfig() {
	return useValue('ai config', () => $aiConfig.get(), [])
}

export function useModels(capability: ModelCapability): ModelConfig[] {
	return useValue(
		'models ' + capability,
		() => ($aiConfig.get()?.models ?? []).filter((m) => m.capabilities.includes(capability)),
		[capability]
	)
}

export function getDefaultModel(capability: ModelCapability): ModelConfig | undefined {
	const config = $aiConfig.get()
	if (!config) return undefined
	const key = getDefaultModelKey(config, capability)
	return config.models.find((m) => m.key === key)
}

export function getModelLabel(key: string | null | undefined, capability: ModelCapability) {
	const config = $aiConfig.get()
	const model = key ? config?.models.find((m) => m.key === key) : getDefaultModel(capability)
	if (!model) return key ? `${key} (missing)` : 'No model set'
	return model.label || model.key
}

/** Whether the AI providers dialog is open. */
export const $providersDialogOpen = atom('providers dialog open', false)
export function openProvidersDialog() {
	$providersDialogOpen.set(true)
}

/**
 * A model picker limited to models with one capability. The empty value
 * means "the default model for this capability".
 */
export function ModelSelect({
	capability,
	value,
	onChange,
	className,
	title,
}: {
	capability: ModelCapability
	value: string
	onChange(value: string): void
	className?: string
	title?: string
}) {
	const models = useModels(capability)
	const defaultLabel = useValue('default label', () => getModelLabel(null, capability), [capability])
	const missing = value && !models.some((m) => m.key === value)
	return (
		<select
			className={className}
			title={title}
			value={value}
			onPointerDown={(e) => e.stopPropagation()}
			onChange={(e) => {
				if (e.target.value === '__providers__') {
					openProvidersDialog()
					return
				}
				onChange(e.target.value)
			}}
		>
			<option value="">Default: {defaultLabel}</option>
			{models.map((m) => (
				<option key={m.key} value={m.key}>
					{m.label || m.key}
				</option>
			))}
			{missing && <option value={value}>{value} (missing)</option>}
			<option value="__providers__">AI providers…</option>
		</select>
	)
}
