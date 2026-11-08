import { atom } from 'tldraw'
import type { AgentTaskRequest } from '../../shared/agentRouting'

export type { AgentTaskRequest as AgentRequest } from '../../shared/agentRouting'

export interface AgentPanelOpenOptions {
	/** Text to put in the input (the input gets focus). */
	prefill?: string
	/** A request to run at once with the current selection as scope. */
	run?: AgentTaskRequest
	/** A sheet to open above the input. */
	sheet?: 'rewrite' | 'presets'
	/** Focus the input (Ctrl+Shift+K, the ✦ button on a card). */
	focus?: boolean
}

/**
 * WP44: the one way into the docked agent panel. App opens the dock when this is set; the
 * panel runs / prefills / opens the sheet, then clears it. `nonce` makes two equal requests
 * in a row both count.
 */
export const $agentPanelRequest = atom<(AgentPanelOpenOptions & { nonce: number }) | null>('agent panel request', null)

let nonce = 0

export function openAgentPanel(options: AgentPanelOpenOptions = {}) {
	$agentPanelRequest.set({ ...options, nonce: ++nonce })
}
