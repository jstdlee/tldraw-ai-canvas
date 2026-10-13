import { describe, expect, it } from 'vitest'
import { createAgentErrorHistoryItem, getAgentErrorMessage } from '../shared/format/agentError'

// WP28 Part A: when a request fails before the model produces any action (a dead model id,
// a provider refusal, an empty/non-JSON reply), the chat used to show nothing after the
// user's own message. These failures are now turned into a chat history item instead of
// being swallowed into a toast — see TldrawAgent.ts's `requestAgentActions`.
describe('agent error history item', () => {
	it('uses an Error message', () => {
		const item = createAgentErrorHistoryItem(new Error('mimo-v2.6-flash-free did not return canvas actions.'))
		expect(item).toEqual({ type: 'error', message: 'mimo-v2.6-flash-free did not return canvas actions.' })
	})

	it('uses a plain string reason', () => {
		expect(getAgentErrorMessage('OpenAI: insufficient_quota')).toBe('OpenAI: insufficient_quota')
	})

	it('falls back to a generic message for anything else (empty error, non-Error throw)', () => {
		expect(getAgentErrorMessage(new Error(''))).not.toBe('')
		expect(getAgentErrorMessage(undefined)).toMatch(/could not reply/i)
		expect(getAgentErrorMessage({ weird: true })).toMatch(/could not reply/i)
	})
})
