import { atom } from 'tldraw'

export type { AgentTaskRequest as AgentRequest } from '../../shared/agentRouting'

export interface AgentPanelOpenOptions {
	/** Text to put in the input (the input gets focus). */
	prefill?: string
	/** A sheet to open above the input. */
	sheet?: 'rewrite' | 'presets'
	/** Focus the input (Adjust on a preview). */
	focus?: boolean
}

/**
 * WP44/WP48: opens the docked agent panel (the thread). App opens the dock when this is set;
 * the panel prefills / focuses / opens the sheet, then clears it. AI requests start in the AI
 * bar (aiBarState.ts); the dock only shows them. `nonce` makes two equal requests both count.
 */
export const $agentPanelRequest = atom<(AgentPanelOpenOptions & { nonce: number }) | null>('agent panel request', null)

let nonce = 0

export function openAgentPanel(options: AgentPanelOpenOptions = {}) {
	$agentPanelRequest.set({ ...options, nonce: ++nonce })
}
