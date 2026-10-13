import { useEffect, useMemo, useState } from 'react'
import { useValue } from 'tldraw'
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
import { SEARCH_PROVIDER_IDS, SEARCH_PROVIDER_LABELS, SearchProviderId } from '../../shared/search'
import { McpServerConfig } from '../../shared/mcpConfig'
import { SkillInfo } from '../../shared/skills'
import { UiButton, UiEmpty, UiField, UiSecretInput, UiTextInput } from '../ui'
import {
	$aiConfig,
	fetchMcpConfig,
	fetchProviderModels,
	fetchSearchConfig,
	fetchSkills,
	saveAIConfig,
	saveMcpConfig,
	saveSearchConfig,
	testMcpServer,
	testSearchProvider,
	type SearchConfig,
} from './aiConfig'
import { $modelHealth, refreshModelHealth } from './modelHealth'

type DraftProvider = PublicProviderConfig & { apiKey?: string }

const CAPABILITY_HELP: Record<ModelCapability, string> = {
	agent: 'Canvas agent (edits shapes). Needs a strong model that follows JSON well.',
	chat: 'Chat and text nodes',
	vision: 'Reads images (chat with sketches, describe image)',
	jev: 'JEV decisions: probabilities for yes/no, choice, score (System One API, or any chat model)',
	image: 'Generate image node (text-to-image)',
}

function uniqueId(base: string, taken: string[], fallback = 'provider') {
	const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback
	let id = slug
	for (let i = 2; taken.includes(id); i++) id = `${slug}-${i}`
	return id
}

/**
 * WP31 (owner follow-up): the left list is one unified "+ Add provider" list — model
 * providers, search providers, and MCP servers are all entries in it, each with its own
 * detail pane on the right. `Selected` disambiguates which kind of entry is open.
 */
type Selected = { kind: 'model'; id: string } | { kind: 'search'; id: SearchProviderId } | { kind: 'mcp'; id: string }

/** Env var / HTTP header names that plausibly hold a credential (mirrors
 * `shared/mcpConfig.ts`'s `SECRET_LIKE_NAME` — kept in sync by hand, both are small). A row
 * with one of these names defaults to the secret-store control, which can only ever produce
 * a `secret:<id>` ref; the server rejects a raw value under such a name either way. */
function isSecretLikeName(key: string) {
	return /auth|token|key|secret|password|credential/i.test(key)
}

/** Key/value rows for an MCP server's `env` or `headers`. Each row is either a secret
 * (`UiSecretInput`, saved as a `secret:<id>` ref) or free text (a plain value, or an
 * `env:NAME` ref read from the server's own environment). */
function KvEditor({ rows, onChange }: { rows: Record<string, string>; onChange: (rows: Record<string, string>) => void }) {
	const [modeOverride, setModeOverride] = useState<Record<string, 'secret' | 'text'>>({})
	const [keyDraft, setKeyDraft] = useState<Record<string, string>>({})
	const entries = Object.entries(rows)
	const modeFor = (key: string, value: string): 'secret' | 'text' =>
		modeOverride[key] ?? (isSecretLikeName(key) && !value.startsWith('env:') ? 'secret' : 'text')

	const setRow = (oldKey: string, newKey: string, value: string) => {
		const next: Record<string, string> = {}
		for (const [k, v] of Object.entries(rows)) {
			if (k === oldKey) continue
			next[k] = v
		}
		next[newKey || oldKey] = value
		onChange(next)
	}
	const removeRow = (key: string) => {
		const next = { ...rows }
		delete next[key]
		onChange(next)
	}
	const addRow = () => {
		let name = 'NAME'
		for (let i = 2; name in rows; i++) name = `NAME_${i}`
		onChange({ ...rows, [name]: '' })
	}

	return (
		<div className="ai-kv-editor">
			{entries.map(([key, value]) => {
				const mode = modeFor(key, value)
				return (
					<div className="ai-row ai-gap" key={key}>
						<UiTextInput
							className="ai-kv-key"
							value={keyDraft[key] ?? key}
							placeholder="NAME"
							onChange={(v) => setKeyDraft((d) => ({ ...d, [key]: v }))}
							onCommit={(newKey) => {
								setKeyDraft((d) => {
									const { [key]: _omit, ...rest } = d
									return rest
								})
								if (newKey && newKey !== key) setRow(key, newKey, value)
							}}
						/>
						{mode === 'secret' ? (
							<UiSecretInput value={value || undefined} onChange={(ref) => setRow(key, key, ref ?? '')} placeholder="Secret value" />
						) : (
							<UiTextInput value={value} placeholder="value, or env:NAME" onChange={(v) => setRow(key, key, v)} />
						)}
						<UiButton
							size="sm"
							variant="low"
							label={mode === 'secret' ? 'Use plain/env:' : 'Use secret'}
							onClick={() => setModeOverride((m) => ({ ...m, [key]: mode === 'secret' ? 'text' : 'secret' }))}
						/>
						<button className="ai-link ai-danger" title="Remove" onClick={() => removeRow(key)}>
							✕
						</button>
					</div>
				)
			})}
			<UiButton size="sm" variant="low" label="+ Add" onClick={addRow} />
		</div>
	)
}

export function AIProvidersDialog({ onClose }: { onClose(): void }) {
	const initial = $aiConfig.get()
	const [providers, setProviders] = useState<DraftProvider[]>(() => structuredClone(initial?.providers ?? []))
	const [models, setModels] = useState<ModelConfig[]>(() => structuredClone(initial?.models ?? []))
	const [defaults, setDefaults] = useState<AIDefaults>(() => ({ ...(initial?.defaults ?? {}) }))
	const [selected, setSelected] = useState<Selected | null>(providers[0] ? { kind: 'model', id: providers[0].id } : null)
	const [fetched, setFetched] = useState<{ id: string; label?: string; vision?: boolean }[] | null>(null)
	const [status, setStatus] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
	const [busy, setBusy] = useState(false)
	const [manualModel, setManualModel] = useState('')
	// WP31: search providers are now entries in the unified list (owner follow-up); each
	// provider's key is still saved immediately to data/search-config.json, same as before
	// (not gated behind this dialog's "Save", which only covers AI providers/models).
	const [searchEntries, setSearchEntries] = useState<SearchProviderId[]>([])
	const [searchKeys, setSearchKeys] = useState<SearchConfig>({})
	const [searchStatus, setSearchStatus] = useState<Record<string, string>>({})
	// WP31: MCP servers and skills, each saved/reloaded independently of the "Save" button,
	// same pattern as search providers above.
	const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([])
	const [mcpStatus, setMcpStatus] = useState<Record<string, string>>({})
	const [skills, setSkills] = useState<SkillInfo[] | null>(null)
	const [skillsBusy, setSkillsBusy] = useState(false)

	const provider = selected?.kind === 'model' ? (providers.find((p) => p.id === selected.id) ?? null) : null
	const providerModels = provider ? models.filter((m) => m.providerId === provider.id) : []
	const kindInfo = provider ? PROVIDER_KINDS[provider.kind] : null
	const searchId = selected?.kind === 'search' ? selected.id : null
	const mcpServer = selected?.kind === 'mcp' ? (mcpServers.find((s) => s.id === selected.id) ?? null) : null

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
		setSelected({ kind: 'model', id })
		setFetched(null)
		setStatus(null)
	}

	const removeProvider = () => {
		if (!provider) return
		setProviders((ps) => ps.filter((p) => p.id !== provider.id))
		setModels((ms) => ms.filter((m) => m.providerId !== provider.id))
		setSelected(null)
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

	useEffect(() => {
		refreshModelHealth(true)
	}, [])

	useEffect(() => {
		fetchSearchConfig()
			.then((config) => {
				setSearchKeys(config)
				// Existing saved keys always show up as their own list entry.
				setSearchEntries(Object.keys(config) as SearchProviderId[])
			})
			.catch(() => {})
	}, [])

	const addSearchEntry = (id: SearchProviderId) => {
		setSearchEntries((ids) => (ids.includes(id) ? ids : [...ids, id]))
		setSelected({ kind: 'search', id })
	}
	const setSearchKey = (id: SearchProviderId, keyRef: string | undefined) => {
		const next = { ...searchKeys, [id]: keyRef ? { keyRef } : undefined }
		setSearchKeys(next)
		setSearchStatus((s) => ({ ...s, [id]: '' }))
		saveSearchConfig(next)
			.then(() => setSearchStatus((s) => ({ ...s, [id]: 'Saved.' })))
			.catch((e) => setSearchStatus((s) => ({ ...s, [id]: `Save failed: ${(e as Error).message}` })))
	}
	const removeSearchEntry = () => {
		if (!searchId) return
		setSearchEntries((ids) => ids.filter((id) => id !== searchId))
		setSearchKey(searchId, undefined)
		setSelected(null)
	}
	const testSearch = async () => {
		if (!searchId) return
		setSearchStatus((s) => ({ ...s, [searchId]: 'Searching…' }))
		try {
			const count = await testSearchProvider(searchId, searchKeys[searchId]?.keyRef)
			setSearchStatus((s) => ({ ...s, [searchId]: `OK — got ${count} result(s) for a test query.` }))
		} catch (e) {
			setSearchStatus((s) => ({ ...s, [searchId]: `Failed: ${(e as Error).message}` }))
		}
	}

	useEffect(() => {
		fetchMcpConfig()
			.then(setMcpServers)
			.catch(() => {})
		fetchSkills().then(setSkills).catch(() => {})
	}, [])

	const persistMcpServers = (next: McpServerConfig[]) => {
		setMcpServers(next)
		saveMcpConfig(next).catch((e) => setMcpStatus((s) => ({ ...s, _save: `Save failed: ${(e as Error).message}` })))
	}
	const updateMcpServer = (patch: Partial<McpServerConfig>) => {
		if (!mcpServer) return
		persistMcpServers(mcpServers.map((s) => (s.id === mcpServer.id ? ({ ...s, ...patch } as McpServerConfig) : s)))
	}
	const addMcpServer = (transport: 'stdio' | 'http') => {
		const id = uniqueId(transport, mcpServers.map((s) => s.id), 'server')
		const next: McpServerConfig =
			transport === 'stdio'
				? { id, name: 'New MCP server', transport: 'stdio', command: '', args: [], env: {}, enabled: true }
				: { id, name: 'New MCP server', transport: 'http', url: '', headers: {}, enabled: true }
		persistMcpServers([...mcpServers, next])
		setSelected({ kind: 'mcp', id })
	}
	const removeMcpServer = () => {
		if (!mcpServer) return
		persistMcpServers(mcpServers.filter((s) => s.id !== mcpServer.id))
		setSelected(null)
	}
	const testMcp = async () => {
		if (!mcpServer) return
		setMcpStatus((s) => ({ ...s, [mcpServer.id]: 'Connecting…' }))
		try {
			const tools = await testMcpServer(mcpServer)
			setMcpStatus((s) => ({
				...s,
				[mcpServer.id]: tools.length ? `Found ${tools.length} tool(s): ${tools.map((t) => t.name).join(', ')}` : 'Connected, no tools found',
			}))
		} catch (e) {
			setMcpStatus((s) => ({ ...s, [mcpServer.id]: `Failed: ${(e as Error).message}` }))
		}
	}
	const rescanSkills = () => {
		setSkillsBusy(true)
		fetchSkills(true)
			.then(setSkills)
			.finally(() => setSkillsBusy(false))
	}

	const modelHealth = useValue('model health', () => $modelHealth.get(), [])

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
						{providers.length > 0 && <div className="ai-dialog__list-group">Models</div>}
						{providers.map((p) => (
							<button
								key={`model:${p.id}`}
								className={'ai-dialog__list-item' + (selected?.kind === 'model' && selected.id === p.id ? ' is-selected' : '')}
								onClick={() => {
									setSelected({ kind: 'model', id: p.id })
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
						{searchEntries.length > 0 && <div className="ai-dialog__list-group">Search</div>}
						{searchEntries.map((id) => (
							<button
								key={`search:${id}`}
								className={'ai-dialog__list-item' + (selected?.kind === 'search' && selected.id === id ? ' is-selected' : '')}
								onClick={() => setSelected({ kind: 'search', id })}
							>
								<span className={'ai-dot' + (searchKeys[id]?.keyRef ? ' is-on' : '')} />
								<span className="ai-dialog__list-name">{SEARCH_PROVIDER_LABELS[id]}</span>
								<span className="ai-dialog__list-kind">search</span>
							</button>
						))}
						{mcpServers.length > 0 && <div className="ai-dialog__list-group">MCP</div>}
						{mcpServers.map((s) => (
							<button
								key={`mcp:${s.id}`}
								className={'ai-dialog__list-item' + (selected?.kind === 'mcp' && selected.id === s.id ? ' is-selected' : '')}
								onClick={() => setSelected({ kind: 'mcp', id: s.id })}
							>
								<span className={'ai-dot' + (s.enabled ? ' is-on' : '')} />
								<span className="ai-dialog__list-name">{s.name}</span>
								<span className="ai-dialog__list-kind">{s.transport}</span>
							</button>
						))}
						<select
							className="ai-dialog__add"
							value=""
							onChange={(e) => {
								const value = e.target.value
								if (!value) return
								if (value.startsWith('model:')) addProvider(Number(value.slice('model:'.length)))
								else if (value.startsWith('search:')) addSearchEntry(value.slice('search:'.length) as SearchProviderId)
								else if (value.startsWith('mcp:')) addMcpServer(value.slice('mcp:'.length) as 'stdio' | 'http')
							}}
						>
							<option value="">+ Add provider…</option>
							<optgroup label="Models">
								{PROVIDER_PRESETS.map((p, i) => (
									<option key={p.label} value={`model:${i}`}>
										{p.label}
									</option>
								))}
							</optgroup>
							<optgroup label="Search">
								{SEARCH_PROVIDER_IDS.filter((id) => !searchEntries.includes(id)).map((id) => (
									<option key={id} value={`search:${id}`}>
										{SEARCH_PROVIDER_LABELS[id]}
									</option>
								))}
							</optgroup>
							<optgroup label="MCP server">
								<option value="mcp:stdio">MCP server (stdio command)</option>
								<option value="mcp:http">MCP server (HTTP)</option>
							</optgroup>
						</select>
					</div>

					<div className="ai-dialog__detail">
						{selected?.kind === 'search' && searchId ? (
							<>
								<div className="ai-grid">
									<label>Provider</label>
									<span>{SEARCH_PROVIDER_LABELS[searchId]}</span>
									<label>API key</label>
									<UiSecretInput
										value={searchKeys[searchId]?.keyRef}
										onChange={(keyRef) => setSearchKey(searchId, keyRef)}
										placeholder="API key"
									/>
								</div>
								<div className="ai-row ai-gap">
									<button className="ai-button" onClick={testSearch}>
										Test
									</button>
									<span className="ai-spacer" />
									<button className="ai-link ai-danger" onClick={removeSearchEntry}>
										Remove provider
									</button>
								</div>
								{searchStatus[searchId] && <div className="ai-status is-info">{searchStatus[searchId]}</div>}
								<span className="ai-muted">
									Used by the Web search card unless the card has its own key; by the canvas agent's own web-search
									action (only offered once a provider has a key here); and by the Agent card's search tools.
								</span>
							</>
						) : selected?.kind === 'mcp' && mcpServer ? (
							<>
								<div className="ai-grid">
									<label>Name</label>
									<input value={mcpServer.name} onChange={(e) => updateMcpServer({ name: e.target.value })} />
									<label>On</label>
									<input
										type="checkbox"
										checked={mcpServer.enabled}
										onChange={(e) => updateMcpServer({ enabled: e.target.checked })}
									/>
									{mcpServer.transport === 'stdio' ? (
										<>
											<label>Command</label>
											<input
												value={mcpServer.command}
												placeholder="node, uvx, npx…"
												onChange={(e) => updateMcpServer({ command: e.target.value })}
											/>
											<label>Args</label>
											<input
												value={(mcpServer.args ?? []).join(' ')}
												placeholder="space-separated"
												onChange={(e) => updateMcpServer({ args: e.target.value.split(/\s+/).filter(Boolean) })}
											/>
										</>
									) : (
										<>
											<label>URL</label>
											<input
												value={mcpServer.url}
												placeholder="https://…/mcp"
												onChange={(e) => updateMcpServer({ url: e.target.value })}
											/>
										</>
									)}
								</div>
								<div className="ai-defaults__title">{mcpServer.transport === 'stdio' ? 'Env vars' : 'Headers'}</div>
								<KvEditor
									rows={(mcpServer.transport === 'stdio' ? mcpServer.env : mcpServer.headers) ?? {}}
									onChange={(rows) =>
										updateMcpServer(mcpServer.transport === 'stdio' ? { env: rows } : { headers: rows })
									}
								/>
								<span className="ai-muted">
									A name containing "key", "token", "auth", "secret", "password" or "credential" must use the
									secret store or an env:NAME ref — the server refuses a raw value there.
								</span>
								<div className="ai-row ai-gap">
									<button className="ai-button" onClick={testMcp}>
										Test connection
									</button>
									<span className="ai-spacer" />
									<button className="ai-link ai-danger" onClick={removeMcpServer}>
										Remove server
									</button>
								</div>
								{mcpStatus[mcpServer.id] && <div className="ai-status is-info">{mcpStatus[mcpServer.id]}</div>}
							</>
						) : !provider ? (
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
									{provider.kind === 'cloudflare' ? (
										<>
											<label>Account ID</label>
											<UiField
												label=""
												hint="Token needs the Workers AI permission. Account ID is on the Cloudflare dashboard home page."
											>
												<UiTextInput
													value={provider.accountId ?? ''}
													placeholder="32 hex characters"
													mono
													onChange={(accountId) => updateProvider({ accountId })}
												/>
											</UiField>
										</>
									) : (
										<>
											<label>Base URL</label>
											<input
												value={provider.baseURL ?? ''}
												placeholder={kindInfo?.defaultBaseURL}
												onChange={(e) => updateProvider({ baseURL: e.target.value })}
											/>
										</>
									)}
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
						{MODEL_CAPABILITIES.map((cap) => {
							const health = modelHealth?.[cap]
							const dotTitle = !health
								? 'Not checked yet'
								: health.ok
									? `${health.model ?? 'Default'} answers`
									: `${health.model ?? 'Default'} failed: ${health.error ?? 'unknown error'}`
							return (
							<label key={cap} title={CAPABILITY_HELP[cap]}>
								<span className="ai-defaults__label">
									<span
										className={
											'ai-dot' + (health ? (health.ok ? ' is-ok' : ' is-error') : '')
										}
										title={dotTitle}
									/>
									{cap}
								</span>
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
							)
						})}
					</div>
				</div>

				<div className="ai-defaults">
					<div className="ai-defaults__title">Skills</div>
					<div className="ai-row ai-gap">
						<span className="ai-muted">Folder: data/skills/ (each skill = a folder with a SKILL.md).</span>
						<span className="ai-spacer" />
						<UiButton onClick={rescanSkills} disabled={skillsBusy} label={skillsBusy ? 'Scanning…' : 'Rescan'} />
					</div>
					{skills && skills.length === 0 && <UiEmpty text="No skills found yet." />}
					{skills && skills.length > 0 && (
						<div className="ai-fetched">
							{skills.map((s) => (
								<span key={s.id} className="ai-chip is-added" title={s.description}>
									{s.name}
								</span>
							))}
						</div>
					)}
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
