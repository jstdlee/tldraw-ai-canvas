/**
 * WP14 Part C: health of each default model, fetched on app start and when
 * the AI providers dialog opens. The dialog reads `$modelHealth` for its
 * status dots; `ModelHealthToasts` (App.tsx) watches it for the one-per-session
 * broken-default toast.
 */
import { atom } from 'tldraw'
import { ModelsHealth } from '../../shared/aiConfig'

export const $modelHealth = atom<ModelsHealth | null>('model health', null)

let loading: Promise<void> | null = null

export function refreshModelHealth(force = false): Promise<void> {
	if (loading) return loading
	const result = fetch(`/api/models/health${force ? '?force=1' : ''}`)
		.then((res) => res.json())
		.then((data: ModelsHealth) => {
			$modelHealth.set(data)
		})
		.catch(() => {
			// Server unreachable: leave the last known health (or null) in place.
		})
		.finally(() => {
			loading = null
		})
	loading = result
	return result
}
