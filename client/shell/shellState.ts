import { atom, TLShapeId } from 'tldraw'

export const $paletteOpen = atom('command palette', false)
export const $mapOpen = atom('map view', false)
export const $historyOpen = atom('history open', false)
export const $featuresOpen = atom('feature list', false)
export const $libraryRail = atom('library rail', false)
export const $searchHits = atom<TLShapeId[]>('search hits', [])
export const $backup = atom<BackupSettings>('backup settings', { minutes: 0, target: 'folder' })

export interface BackupSettings {
	minutes: number
	target: 'folder' | 's3'
}

const BACKUP_KEY = 'oh-my-tldraw:backup'

export function loadBackup(): BackupSettings {
	try {
		const parsed = JSON.parse(localStorage.getItem(BACKUP_KEY) ?? '') as BackupSettings
		return { minutes: Number(parsed.minutes) || 0, target: parsed.target === 's3' ? 's3' : 'folder' }
	} catch {
		return { minutes: 0, target: 'folder' }
	}
}

export function saveBackup(settings: BackupSettings) {
	localStorage.setItem(BACKUP_KEY, JSON.stringify(settings))
	$backup.set(settings)
}
