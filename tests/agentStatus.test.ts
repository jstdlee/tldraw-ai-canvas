import { describe, expect, it } from 'vitest'
import { agentStatusText } from '../shared/agentStatus'

// AI-08: this status row read "Not run yet" permanently unless `error` was set — even right
// after a clean finish or a Stop (docs/review/2026-10-18/ai.md).
describe('agentStatusText', () => {
	it('is "Not run yet" for a fresh card', () => {
		expect(agentStatusText({ error: null, lastOutput: null, lastStepsJson: null })).toBe('Not run yet')
	})
	it('is "Done" after a successful run', () => {
		expect(agentStatusText({ error: null, lastOutput: 'The answer', lastStepsJson: '[{"step":1}]' })).toBe('Done')
	})
	it('is "Stopped" after a Stop mid-run (steps recorded, no answer, no error)', () => {
		expect(agentStatusText({ error: null, lastOutput: null, lastStepsJson: '[{"step":1,"kind":"tool_call"}]' })).toBe('Stopped')
	})
	it('is not "Stopped" for an untouched empty steps array', () => {
		expect(agentStatusText({ error: null, lastOutput: null, lastStepsJson: '[]' })).toBe('Not run yet')
	})
	it('shows the error message, even if steps or an output are also present', () => {
		expect(agentStatusText({ error: 'No API key for provider: openai', lastOutput: null, lastStepsJson: '[]' })).toBe(
			'No API key for provider: openai'
		)
	})
})
