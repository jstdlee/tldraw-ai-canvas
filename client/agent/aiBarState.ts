import { atom } from 'tldraw'
import type { AgentTaskRequest } from '../../shared/agentRouting'

export interface AiBarOpenOptions {
	/** Text to put in the bar's input (the input gets focus). */
	prefill?: string
	/** A request to run at once with the current selection as scope (menus, chips). */
	run?: AgentTaskRequest
}

/**
 * WP48: the one way into the AI bar (Ctrl+K, Ctrl+Shift+K, the right-click AI submenu, Fix on
 * a card error). The bar opens at the selection (or the canvas center), then clears this.
 * `nonce` makes two equal requests in a row both count.
 */
export const $aiBarRequest = atom<(AiBarOpenOptions & { nonce: number }) | null>('ai bar request', null)

let nonce = 0

export function openAiBar(options: AiBarOpenOptions = {}) {
	$aiBarRequest.set({ ...options, nonce: ++nonce })
}

/**
 * WP48 Adjust: the preview task the next message revises (the bar and the dock input both
 * honour it). Null when the next message is a new request.
 */
export const $adjustTarget = atom<string | null>('ai adjust target', null)
