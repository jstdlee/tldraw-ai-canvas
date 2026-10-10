import { atom, TLShapeId } from 'tldraw'

export const $paletteOpen = atom('command palette', false)
export const $mapOpen = atom('map view', false)
export const $historyOpen = atom('history open', false)
export const $featuresOpen = atom('feature list', false)
export const LIBRARY_RAIL_KEY = 'oh-my-tldraw:library-rail'

/** Stored choice, or rail mode on a narrow window when nothing is stored. */
export function readLibraryRail(): boolean {
	try {
		const stored = localStorage.getItem(LIBRARY_RAIL_KEY)
		if (stored === 'true') return true
		if (stored === 'false') return false
	} catch {
		// Private mode, or no localStorage.
	}
	if (typeof window !== 'undefined' && window.innerWidth < 900) return true
	return false
}

export function writeLibraryRail(rail: boolean) {
	try {
		localStorage.setItem(LIBRARY_RAIL_KEY, rail ? 'true' : 'false')
	} catch {
		// Private mode: the choice just isn't remembered.
	}
}

export const $libraryRail = atom('library rail', readLibraryRail())
export const $searchHits = atom<TLShapeId[]>('search hits', [])
/** The shape the search just jumped to, blinking until this timestamp (ms). */
export const $searchBlink = atom<{ id: TLShapeId; until: number } | null>('search blink', null)

/** Blink a shape on the canvas for about a second (search jump feedback). */
export function blinkSearchHit(id: TLShapeId) {
	$searchBlink.set({ id, until: Date.now() + 1200 })
}
export const $backup = atom<BackupSettings>('backup settings', { minutes: 0, target: 'folder' })
/** Show every node note at once. */
export const $notesAll = atom('show all notes', false)
/** Nodes whose note editor is open (corner icon or right-click). */
export const $notesOpen = atom<TLShapeId[]>('open notes', [])
/** Bumped whenever the operation history changes, so the panel redraws. */
export const $historyRev = atom('history revision', 0)

export function toggleNoteOpen(id: TLShapeId, open?: boolean) {
	const current = $notesOpen.get()
	const isOpen = current.includes(id)
	const next = open ?? !isOpen
	if (next === isOpen) return
	$notesOpen.set(next ? [...current, id] : current.filter((other) => other !== id))
}

export interface BackupSettings {
	minutes: number
	target: 'folder'
}

const BACKUP_KEY = 'oh-my-tldraw:backup'

export function loadBackup(): BackupSettings {
	try {
		const parsed = JSON.parse(localStorage.getItem(BACKUP_KEY) ?? '') as { minutes?: number }
		return { minutes: Number(parsed.minutes) || 0, target: 'folder' }
	} catch {
		return { minutes: 0, target: 'folder' }
	}
}

export function saveBackup(settings: BackupSettings) {
	localStorage.setItem(BACKUP_KEY, JSON.stringify(settings))
	$backup.set(settings)
}
