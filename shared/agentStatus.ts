/**
 * AI-08: the Agent card's status row used to read "Not run yet" permanently unless `error` was
 * set — even right after a clean finish or a Stop (see docs/review/2026-10-18/ai.md). Derived
 * from the fields the card already saves, so no schema change/migration is needed. Pure, no
 * tldraw import.
 */
export interface AgentStatusNode {
	error: string | null
	lastOutput: string | null
	lastStepsJson: string | null
}

export function agentStatusText(node: AgentStatusNode): string {
	if (node.error) return node.error
	if (node.lastOutput) return 'Done'
	if (node.lastStepsJson && node.lastStepsJson !== '[]') return 'Stopped'
	return 'Not run yet'
}
