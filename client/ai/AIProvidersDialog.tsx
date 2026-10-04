import { useEffect, useMemo, useState } from 'react'
import {
	AIDefaults,
	guessCapabilities,
	MODEL_CAPABILITIES,
	ModelCapability,
	ModelConfig,
	modelKey,
	PROVIDER_KINDS,
	PROVIDER_PRESETS,
	ProviderKind,
	PublicProviderConfig,
	ReasoningEffort,
} from '../../shared/aiConfig'
import { $aiConfig, fetchProviderModels, saveAIConfig } from './aiConfig'

type DraftProvider = PublicProviderConfig & { apiKey?: string }

const CAPABILITY_HELP: Record<ModelCapability, string> = {
	agent: 'Canvas agent (edits shapes). Needs a strong model that follows JSON well.',
	chat: 'Chat and text nodes',
	vision: 'Reads images (chat with sketches, describe image)',
	jev: 'JEV decisions: probabilities for yes/no, choice, score (System One API, or any chat model)',
}

function uniqueId(base: string, taken: string[]) {
	const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'provider'
	let id = slug
	for (let i = 2; taken.includes(id); i++) id = `${slug}-${i}`
	return id
}

export function AIProvidersDialog({ onClose }: { onClose(): void }) {
	const initial = $aiConfig.get()
	const [providers, setProviders] = useState<DraftProvider[]>(() => structuredClone(initial?.providers ?? []))
	const [models, setModels] = useState<ModelConfig[]>(() => structuredClone(initial?.models ?? []))
	const [defaults, setDefaults] = useState<AIDefaults>(() => ({ ...(initial?.defaults ?? {}) }))
	const [selectedId, setSelectedId] = useState<string | null>(providers[0]?.id ?? null)
	const [fetched, setFetched] = useState<{ id: string; label?: string; vision?: boolean }[] | null>(null)
	const [status, setStatus] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
	const [busy, setBusy] = useState(false)
	const [manualModel, setManualModel] = useState('')

	const provider = providers.find((p) => p.id === selectedId) ?? null
	const providerModels = models.filter((m) => m.providerId === selectedId)
	const kindInfo = provider ? PROVIDER_KINDS[provider.kind] : null

	const updateProvider = (patch: Partial<DraftProvider>) => {
		if (!provider) return
		setProviders((ps) => ps.map((p) => (p.id === provider.id ? { ...p, ...patch } : p)))
	}
	const updateModel = (key: string, patch: Partial<ModelConfig>) =>
		setModels((ms) => ms.map((m) => (m.key === key ? { ...m, ...patch } : m)))

	const addProvider = (presetIndex: number) => {
		const preset = PROVIDER_PRESETS[presetIndex]
		const id = uniqueId(preset.provider.name, providers.map((p) => p.id))
		const baseURL = preset.provider.baseURL ?? PROVIDER_KINDS[preset.provider.kind].defaultBaseURL
		setProviders((ps) => [...ps, { ...preset.provider, id, baseURL, hasApiKey: false }])
		setSelectedId(id)
		setFetched(null)
		setStatus(null)
	}

	const removeProvider = () => {
		if (!provider) return
		setProviders((ps) => ps.filter((p) => p.id !== provider.id))
		setModels((ms) => ms.filter((m) => m.providerId !== provider.id))
		setSelectedId(providers.find((p) => p.id !== provider.id)?.id ?? null)
		setFetched(null)
	}

	const addModel = (id: string, label?: string, vision?: boolean) => {
		if (!provider || !id) return
		const key = modelKey(provider.id, id)
		if (models.some((m) => m.key === key)) return
		let capabilities = guessCapabilities(provider.kind, id)
		if (vision !== undefined && capabilities.includes('chat')) {
			capabilities = capabilities.filter((c) => c !== 'vision')
			if (vision) capabilities.push('vision')
		}
		setModels((ms) => [
			...ms,
			{
				key,
				providerId: provider.id,
				model: id,
				label: label && label !== id ? label : id,
				capabilities,
				supportsTemperature: true,
			},
		])
	}

	const doFetch = async () => {
		if (!provider) return
		setBusy(true)
		setStatus(null)
		try {
			const list = await fetchProviderModels(provider)
			setFetched(list)
			setStatus({
				kind: 'info',
				text: list.length ? `Found ${list.length} models.` : 'The provider listed no models. Add model ids by hand.',
			})
		} catch (e) {
			setFetched(null)
			setStatus({ kind: 'error', text: (e as Error).message })
		} finally {
			setBusy(false)
		}
	}

	const doSave = async () => {
		setBusy(true)
		try {
			await saveAIConfig({ providers, models, defaults })
			onClose()
		} catch (e) {
			setStatus({ kind: 'error', text: `Save failed: ${(e as Error).message}` })
			setBusy(false)
		}
	}

	const modelsByCapability = useMemo(() => {
		const result = {} as Record<ModelCapability, ModelConfig[]>
		for (const cap of MODEL_CAPABILITIES) result[cap] = models.filter((m) => m.capabilities.includes(cap))
		return result
	}, [models])

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])

	return (
		<div className="ai-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-dialog-title">
			<div className="ai-dialog__header">
				<h2 id="ai-dialog-title">AI providers</h2>
				<button className="ai-icon-button" onClick={onClose} title="Close (Esc)" aria-label="Close">
					✕
				</button>
			</div>
			<div className="ai-dialog__body">
				<div className="ai-dialog__columns">
					<div className="ai-dialog__list">
						{providers.map((p) => (
							<button
								key={p.id}
								className={'ai-dialog__list-item' + (p.id === selectedId ? ' is-selected' : '')}
								onClick={() => {
									setSelectedId(p.id)
									setFetched(null)
									setStatus(null)
								}}
							>
								<span className={'ai-dot' + (p.enabled ? ' is-on' : '')} />
								<span className="ai-dialog__list-name">{p.name}</span>
								<span className="ai-dialog__list-kind">
									{PROVIDER_KINDS[p.kind].local ? 'local' : 'online'}
								</span>
							</button>
						))}
						<select
							className="ai-dialog__add"
							value=""
							onChange={(e) => e.target.value && addProvider(Number(e.target.value))}
						>
							<option value="">+ Add provider…</option>
							{PROVIDER_PRESETS.map((p, i) => (
								<option key={p.label} value={i}>
									{p.label}
								</option>
							))}
						</select>
					</div>

					<div className="ai-dialog__detail">
						{!provider ? (
							<p className="ai-muted">Add a provider to start. Local servers (Ollama, LM Studio, ComfyUI) work offline.</p>
						) : (
							<>
								<div className="ai-grid">
									<label>Name</label>
									<input value={provider.name} onChange={(e) => updateProvider({ name: e.target.value })} />
									<label>Type</label>
									<select
										value={provider.kind}
										onChange={(e) => updateProvider({ kind: e.target.value as ProviderKind })}
									>
										{Object.entries(PROVIDER_KINDS).map(([k, info]) => (
											<option key={k} value={k}>
												{info.label}
											</option>
										))}
									</select>
									<label>Base URL</label>
									<input
										value={provider.baseURL ?? ''}
										placeholder={kindInfo?.defaultBaseURL}
										onChange={(e) => updateProvider({ baseURL: e.target.value })}
									/>
									<label>API key</label>
									<div className="ai-row">
										<input
											type="password"
											autoComplete="off"
											value={provider.apiKey ?? ''}
											placeholder={
												provider.hasApiKey
													? 'Saved on the server (type to replace)'
													: kindInfo?.needsApiKey
														? 'Required'
														: 'Optional'
											}
											onChange={(e) => updateProvider({ apiKey: e.target.value })}
										/>
										{provider.hasApiKey && (
											<button className="ai-link" onClick={() => updateProvider({ apiKey: '', hasApiKey: false })}>
												Clear
											</button>
										)}
									</div>
									<label>On</label>
									<div className="ai-row">
										<input
											type="checkbox"
											checked={provider.enabled}
											onChange={(e) => updateProvider({ enabled: e.target.checked })}
										/>
										<span className="ai-muted">
											Can do: {kindInfo?.capabilities.join(', ')}
											{kindInfo?.local ? ' · runs offline' : ' · needs internet'}
										</span>
									</div>
								</div>

								<div className="ai-row ai-gap">
									<button className="ai-button" onClick={doFetch} disabled={busy}>
										{busy ? 'Working…' : 'Fetch models'}
									</button>
									<input
										placeholder="or type a model id"
										value={manualModel}
										onChange={(e) => setManualModel(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === 'Enter') {
												addModel(manualModel.trim())
												setManualModel('')
											}
										}}
									/>
									<button
										className="ai-button"
										onClick={() => {
											addModel(manualModel.trim())
											setManualModel('')
										}}
									>
										Add
									</button>
									<span className="ai-spacer" />
									<button className="ai-link ai-danger" onClick={removeProvider}>
										Remove provider
									</button>
								</div>

								{status && <div className={'ai-status is-' + status.kind}>{status.text}</div>}

								{fetched && fetched.length > 0 && (
									<div className="ai-fetched">
										{fetched.map((m) => {
											const added = models.some((x) => x.key === modelKey(provider.id, m.id))
											return (
												<button
													key={m.id}
													className={'ai-chip' + (added ? ' is-added' : '')}
													disabled={added}
													onClick={() => addModel(m.id, m.label, m.vision)}
													title={added ? 'Added' : 'Add this model'}
												>
													{added ? '✓ ' : '+ '}
													{m.id}
												</button>
											)
										})}
									</div>
								)}

								<table className="ai-models">
									<thead>
										<tr>
											<th>Model</th>
											{MODEL_CAPABILITIES.map((cap) => (
												<th key={cap} title={CAPABILITY_HELP[cap]}>
													{cap}
												</th>
											))}
											<th title="Reasoning effort (models that think)">effort</th>
											<th />
										</tr>
									</thead>
									<tbody>
										{providerModels.length === 0 && (
											<tr>
												<td colSpan={MODEL_CAPABILITIES.length + 3} className="ai-muted">
													No models yet. Use “Fetch models” or type an id.
												</td>
											</tr>
										)}
										{providerModels.map((m) => (
											<tr key={m.key}>
												<td>
													<input
														className="ai-model-label"
														value={m.label}
														title={m.model}
														onChange={(e) => updateModel(m.key, { label: e.target.value })}
													/>
												</td>
												{MODEL_CAPABILITIES.map((cap) => (
													<td key={cap} className="ai-center">
														<input
															type="checkbox"
															title={CAPABILITY_HELP[cap]}
															checked={m.capabilities.includes(cap)}
															onChange={(e) =>
																updateModel(m.key, {
																	capabilities: e.target.checked
																		? [...m.capabilities, cap]
																		: m.capabilities.filter((c) => c !== cap),
																})
															}
														/>
													</td>
												))}
												<td>
													<select
														value={m.reasoningEffort ?? ''}
														onChange={(e) =>
															updateModel(m.key, {
																reasoningEffort: (e.target.value || undefined) as ReasoningEffort | undefined,
															})
														}
													>
														<option value="">auto</option>
														<option value="none">none</option>
														<option value="low">low</option>
														<option value="medium">medium</option>
														<option value="high">high</option>
													</select>
												</td>
												<td>
													<button
														className="ai-link ai-danger"
														title="Remove model"
														onClick={() => setModels((ms) => ms.filter((x) => x.key !== m.key))}
													>
														✕
													</button>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</>
						)}
					</div>
				</div>

				<div className="ai-defaults">
					<div className="ai-defaults__title">Default model for each job</div>
					<div className="ai-defaults__grid">
						{MODEL_CAPABILITIES.map((cap) => (
							<label key={cap} title={CAPABILITY_HELP[cap]}>
								<span>{cap}</span>
								<select
									value={defaults[cap] ?? ''}
									onChange={(e) => setDefaults((d) => ({ ...d, [cap]: e.target.value || undefined }))}
								>
									<option value="">First that can</option>
									{modelsByCapability[cap].map((m) => (
										<option key={m.key} value={m.key}>
											{m.label}
										</option>
									))}
								</select>
							</label>
						))}
					</div>
				</div>
			</div>
			<div className="ai-dialog__footer">
				<span className="ai-muted">Keys stay on this machine (data/ai-config.json).</span>
				<span className="ai-spacer" />
				<button className="ai-button" onClick={onClose}>
					Cancel
				</button>
				<button className="ai-button is-primary" onClick={doSave} disabled={busy}>
					Save
				</button>
			</div>
		</div>
	)
}
