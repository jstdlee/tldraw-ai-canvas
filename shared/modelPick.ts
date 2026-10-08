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
