/**
 * Model lists from live APIs.
 * Price, modality and the reasoning flag come from the payload.
 * A band is a price third inside the filter. It is not an IQ score.
 */

export interface HubModel {
	id: string
	name: string
	promptPrice: number | null
	completionPrice: number | null
	input: string[]
	output: string[]
	reasoning: boolean
	free: boolean
	source: string
}

export interface ModelPick {
	id: string
	name: string
	reason: string
	promptPrice: number | null
	reasoning: boolean
}

function num(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
	return null
}

function list(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((item) => String(item).toLowerCase())
	if (typeof value === 'string') return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
	return []
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function modelFromRecord(raw: unknown, source: string): HubModel | null {
	const row = asRecord(raw)
	if (!row) return null
	const id = typeof row.id === 'string' ? row.id : ''
	if (!id) return null
	const pricing = asRecord(row.pricing)
	const architecture = asRecord(row.architecture)
	const promptPrice = num(pricing?.prompt ?? row.promptPrice ?? row.cost)
	const completionPrice = num(pricing?.completion ?? row.completionPrice)
	const modality = list(architecture?.input_modalities ?? architecture?.modality ?? row.input_modalities)
	const output = list(architecture?.output_modalities ?? row.output_modalities)
	const parameters = list(row.supported_parameters)
	const name = typeof row.name === 'string' ? row.name : id
	const reasoning =
		parameters.includes('reasoning') ||
		parameters.includes('include_reasoning') ||
		row.reasoning === true
	const free =
		promptPrice === 0 ||
		/:free$/i.test(id) ||
		/\bfree\b/i.test(name)
	return {
		id,
		name,
		promptPrice,
		completionPrice,
		input: modality,
		output,
		reasoning,
		free,
		source,
	}
}

export function modelsFromPayload(payload: unknown, source: string): HubModel[] {
	const root = asRecord(payload)
	const rows = Array.isArray(payload)
		? payload
		: Array.isArray(root?.data)
			? root.data
			: Array.isArray(root?.models)
				? root.models
				: []
	const models: HubModel[] = []
	for (const row of rows) {
		const model = modelFromRecord(row, source)
		if (model) models.push(model)
	}
	return models
}

export function freeModels(models: HubModel[]): HubModel[] {
	return models.filter((model) => model.free)
}

function taskMatch(model: HubModel, task: string): boolean {
	const blob = `${model.id} ${model.name}`.toLowerCase()
	if (task === 'vision') return model.input.some((item) => /image|vision/.test(item)) || /vision/.test(blob)
	if (task === 'think') return model.reasoning
	if (task === 'coding') return /code|coder|devstral|codestral/.test(blob)
	if (task === 'daily' || task === 'chat') return model.input.length === 0 || model.input.includes('text')
	return true
}

function priceOf(model: HubModel): number {
	return model.promptPrice ?? Number.POSITIVE_INFINITY
}

/** Pick up to five models. Band is cheap, middle, or costly inside the task filter. */
export function pickCandidates(models: HubModel[], task: string, band: string): ModelPick[] {
	const matched = models.filter((model) => taskMatch(model, task))
	const pool = matched.length ? matched : models
	const sorted = [...pool].sort((a, b) => priceOf(a) - priceOf(b))
	const third = Math.max(1, Math.ceil(sorted.length / 3))
	const slice =
		band === 'high' ? sorted.slice(-third) : band === 'medium' ? sorted.slice(third, third * 2) : sorted.slice(0, third)
	const chosen = (slice.length ? slice : sorted).slice(0, 5)
	return chosen.map((model) => {
		const price = model.promptPrice == null ? 'price not listed' : model.promptPrice === 0 ? 'free' : `$${model.promptPrice}/token`
		const kind = [
			task === 'coding' ? 'name matches code' : null,
			task === 'vision' ? 'image input' : null,
			model.reasoning ? 'reasoning flag' : null,
			`${band || 'low'} price third`,
		]
			.filter(Boolean)
			.join(', ')
		return {
			id: model.id,
			name: model.name,
			promptPrice: model.promptPrice,
			reasoning: model.reasoning,
			reason: `${kind}. Source: ${model.source}. Not an IQ score.`,
		}
	})
}
