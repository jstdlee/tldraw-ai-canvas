/**
 * Agent model names are user-defined model keys (`providerId/model`) from the
 * AI config. An empty string means "use the server's default agent model".
 */
export type AgentModelName = string

export const DEFAULT_MODEL_NAME: AgentModelName = ''

/**
 * Check if a value can be used as a model name. Whether the model still
 * exists is checked on the server, which falls back to the default.
 */
export function isValidModelName(value: unknown): value is AgentModelName {
	return typeof value === 'string'
}
