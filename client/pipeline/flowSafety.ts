import { atom, Editor, TLShapeId } from 'tldraw'
import { AskAnswerType, AskReply, readVariables } from '../../shared/flowSafety'
import { EditorAtom } from './utils'

/**
 * WP49: the browser-side state of the flow safety cards. Card `execute()` code runs outside
 * React, so it cannot call `useToasts()`: it queues a toast here and `FlowToasts`
 * (components/FlowToasts.tsx, mounted inside <Tldraw>) shows it.
 */

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export interface FlowToast {
	/** Same key again replaces nothing; `dismissFlowToast(key)` removes it. */
	key: string
	title: string
	description?: string
	severity?: 'info' | 'success' | 'warning' | 'error'
	keepOpen?: boolean
	/** A "Go to card" action that zooms to this card and selects it. */
	shapeId?: TLShapeId
}

export const $flowToasts = new EditorAtom<{ queue: FlowToast[]; dismissed: string[] }>('flow toasts', () => ({
	queue: [],
	dismissed: [],
}))

let toastCounter = 0

export function queueFlowToast(editor: Editor, toast: Omit<FlowToast, 'key'> & { key?: string }): string {
	const key = toast.key ?? `flow-toast-${++toastCounter}`
	$flowToasts.update(editor, (state) => ({ ...state, queue: [...state.queue, { ...toast, key }] }))
	return key
}

export function dismissFlowToast(editor: Editor, key: string) {
	$flowToasts.update(editor, (state) => ({ ...state, dismissed: [...state.dismissed, key] }))
}

/** Zoom to a card and select it (the toasts' "Go to card"). */
export function goToCard(editor: Editor, shapeId: TLShapeId) {
	const bounds = editor.getShapePageBounds(shapeId)
	if (!bounds) return
	editor.select(shapeId)
	editor.zoomToBounds(bounds, { targetZoom: Math.min(1, editor.getZoomLevel() < 0.5 ? 1 : editor.getZoomLevel()), animation: { duration: 200 } })
}

// ---------------------------------------------------------------------------
// Ask user: one open question per card
// ---------------------------------------------------------------------------

export interface PendingAsk {
	question: string
	answerType: AskAnswerType
	options: string[]
	/** When it gives up (ms since epoch), or null to wait forever. */
	deadline: number | null
	toastKey: string
	answer: (reply: AskReply) => void
}

/** Few questions are ever open at once, so one map for all cards is fine. */
export const $pendingAsks = new EditorAtom<Record<string, PendingAsk>>('pending asks', () => ({}))

export function getPendingAsk(editor: Editor, shapeId: TLShapeId): PendingAsk | undefined {
	return $pendingAsks.get(editor)[shapeId]
}

export function setPendingAsk(editor: Editor, shapeId: TLShapeId, ask: PendingAsk | null) {
	$pendingAsks.update(editor, (state) => {
		const next = { ...state }
		if (ask) next[shapeId] = ask
		else delete next[shapeId]
		return next
	})
}

/** Answer an open question (from the card's buttons, or the toast). */
export function answerAsk(editor: Editor, shapeId: TLShapeId, reply: AskReply) {
	getPendingAsk(editor, shapeId)?.answer(reply)
}

// ---------------------------------------------------------------------------
// Variables: stored in the document's meta, so they save with the canvas and undo with it
// ---------------------------------------------------------------------------

export function getCanvasVariables(editor: Editor): Record<string, string> {
	return readVariables(editor.getDocumentSettings().meta)
}

export function setCanvasVariable(editor: Editor, name: string, value: string) {
	const meta = editor.getDocumentSettings().meta ?? {}
	const variables = { ...readVariables(meta), [name]: value }
	editor.updateDocumentSettings({ meta: { ...meta, variables } })
}

export function deleteCanvasVariable(editor: Editor, name: string) {
	const meta = editor.getDocumentSettings().meta ?? {}
	const variables = { ...readVariables(meta) }
	delete variables[name]
	editor.updateDocumentSettings({ meta: { ...meta, variables } })
}

/** The Variables list dialog (main menu → Variables…). */
export const $variablesOpen = atom('variables dialog open', false)

// ---------------------------------------------------------------------------
// Notify: desktop notification (Electron shows the same Web Notification natively)
// ---------------------------------------------------------------------------

const ASKED_KEY = 'oh-my-tldraw:notify-permission-asked'

function askedBefore(): boolean {
	try {
		return localStorage.getItem(ASKED_KEY) === '1'
	} catch {
		return false
	}
}

function rememberAsked() {
	try {
		localStorage.setItem(ASKED_KEY, '1')
	} catch {
		// Private mode: we may ask again next session.
	}
}

/** Show a desktop notification. Asks for permission once; returns whether one was shown. */
export async function showDesktopNotification(title: string, body: string, sound: boolean): Promise<boolean> {
	if (typeof window === 'undefined' || !('Notification' in window)) return false
	try {
		let permission = Notification.permission
		if (permission === 'default' && !askedBefore()) {
			rememberAsked()
			permission = await Notification.requestPermission()
		}
		if (permission !== 'granted') return false
		new Notification(title, { body, silent: !sound })
		return true
	} catch {
		return false
	}
}

/** A short soft beep (the in-app sound; a desktop notification may also play its own). */
export function playNotifySound() {
	try {
		const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
		if (!Ctx) return
		const ctx = new Ctx()
		const osc = ctx.createOscillator()
		const gain = ctx.createGain()
		osc.type = 'sine'
		osc.frequency.value = 880
		gain.gain.setValueAtTime(0.0001, ctx.currentTime)
		gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02)
		gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
		osc.connect(gain).connect(ctx.destination)
		osc.start()
		osc.stop(ctx.currentTime + 0.4)
		osc.onended = () => void ctx.close()
	} catch {
		// No audio (e.g. blocked autoplay): the toast and notification still show.
	}
}
