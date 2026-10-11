import classNames from 'classnames'
import { ReactNode, useEffect, useRef, useState } from 'react'

/**
 * WP22 B1: a tldraw-styled floating panel (used by Build with AI and the per-node AI chat
 * card) that can be dragged by its header and resized from a bottom-right handle, with its
 * position/size remembered per panel (localStorage, keyed by `storageKey`) and clamped to the
 * viewport. Esc closes it when focus is inside. Visuals (tl-color-panel, tl-shadow-3, radius)
 * stay with the caller's own className — this component only owns position/size/drag/resize.
 */

interface Rect {
	x: number
	y: number
	w: number
	h: number
}

const STORAGE_PREFIX = 'oh-my-tldraw:panel:'

function clampRect(rect: Rect, minWidth: number, minHeight: number): Rect {
	const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
	const vh = typeof window !== 'undefined' ? window.innerHeight : 800
	const w = Math.max(minWidth, Math.min(rect.w, vw - 16))
	const h = Math.max(minHeight, Math.min(rect.h, vh - 16))
	const x = Math.min(Math.max(rect.x, 8), Math.max(8, vw - w - 8))
	const y = Math.min(Math.max(rect.y, 8), Math.max(8, vh - h - 8))
	return { x, y, w, h }
}

function loadRect(storageKey: string, fallback: Rect, minWidth: number, minHeight: number): Rect {
	try {
		const raw = localStorage.getItem(STORAGE_PREFIX + storageKey)
		if (raw) {
			const parsed = JSON.parse(raw)
			if (
				parsed &&
				typeof parsed.x === 'number' &&
				typeof parsed.y === 'number' &&
				typeof parsed.w === 'number' &&
				typeof parsed.h === 'number'
			) {
				return clampRect(parsed, minWidth, minHeight)
			}
		}
	} catch {
		// Private browsing or a full quota: fall back to the default position.
	}
	return clampRect(fallback, minWidth, minHeight)
}

function saveRect(storageKey: string, rect: Rect) {
	try {
		localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(rect))
	} catch {
		// Private browsing or a full quota: the position just doesn't persist.
	}
}

export interface FloatingPanelProps {
	/** Unique per panel kind (e.g. "build", "fill-chat"); its position/size persists under this key. */
	storageKey: string
	ariaLabel: string
	className?: string
	/** Used only the first time (or once nothing valid is saved); defaults to roughly centered-right. */
	defaultRect: { x?: number; y?: number; w: number; h: number }
	minWidth?: number
	minHeight?: number
	/** Rendered inside the draggable header bar. */
	header: ReactNode
	children: ReactNode
	onClose: () => void
}

/** A tldraw-styled floating panel: draggable by its header, resizable from the bottom-right
 * corner, remembers its rect per `storageKey`, and closes on Esc while focus is inside it. */
export function FloatingPanel({
	storageKey,
	ariaLabel,
	className,
	defaultRect,
	minWidth = 280,
	minHeight = 160,
	header,
	children,
	onClose,
}: FloatingPanelProps) {
	const rootRef = useRef<HTMLDivElement>(null)
	const [rect, setRect] = useState<Rect>(() =>
		loadRect(
			storageKey,
			{
				x: defaultRect.x ?? (typeof window !== 'undefined' ? window.innerWidth - defaultRect.w - 12 : 12),
				y: defaultRect.y ?? 56,
				w: defaultRect.w,
				h: defaultRect.h,
			},
			minWidth,
			minHeight
		)
	)
	const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
	const resizeRef = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null)

	// Re-clamp (and persist) whenever the rect settles — covers both drag/resize end and a
	// viewport that shrank since the saved rect was written.
	useEffect(() => {
		saveRect(storageKey, rect)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [storageKey, rect])

	useEffect(() => {
		const onResize = () => setRect((r) => clampRect(r, minWidth, minHeight))
		window.addEventListener('resize', onResize)
		return () => window.removeEventListener('resize', onResize)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [minWidth, minHeight])

	const onHeaderPointerDown = (e: React.PointerEvent) => {
		if (e.button !== 0) return
		// Let close/other header controls (which stop propagation themselves) take the click.
		if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return
		e.stopPropagation()
		dragRef.current = { startX: e.clientX, startY: e.clientY, originX: rect.x, originY: rect.y }
		const onMove = (ev: PointerEvent) => {
			if (!dragRef.current) return
			const dx = ev.clientX - dragRef.current.startX
			const dy = ev.clientY - dragRef.current.startY
			setRect((r) => clampRect({ ...r, x: dragRef.current!.originX + dx, y: dragRef.current!.originY + dy }, minWidth, minHeight))
		}
		const onUp = () => {
			dragRef.current = null
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
		}
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp)
	}

	const onResizeHandlePointerDown = (e: React.PointerEvent) => {
		if (e.button !== 0) return
		e.stopPropagation()
		e.preventDefault()
		resizeRef.current = { startX: e.clientX, startY: e.clientY, originW: rect.w, originH: rect.h }
		const onMove = (ev: PointerEvent) => {
			if (!resizeRef.current) return
			const dx = ev.clientX - resizeRef.current.startX
			const dy = ev.clientY - resizeRef.current.startY
			setRect((r) => clampRect({ ...r, w: resizeRef.current!.originW + dx, h: resizeRef.current!.originH + dy }, minWidth, minHeight))
		}
		const onUp = () => {
			resizeRef.current = null
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
		}
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp)
	}

	const onKeyDownCapture = (e: React.KeyboardEvent) => {
		if (e.key !== 'Escape') return
		if (rootRef.current && rootRef.current.contains(document.activeElement)) {
			e.stopPropagation()
			onClose()
		}
	}

	return (
		<div
			ref={rootRef}
			role="dialog"
			aria-label={ariaLabel}
			className={classNames('FloatingPanel', className)}
			style={{ position: 'fixed', left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
			onPointerDown={(e) => e.stopPropagation()}
			onKeyDownCapture={onKeyDownCapture}
		>
			<div className="FloatingPanel-header" onPointerDown={onHeaderPointerDown}>
				{header}
			</div>
			<div className="FloatingPanel-body">{children}</div>
			<div
				className="FloatingPanel-resize"
				title="Resize"
				onPointerDown={onResizeHandlePointerDown}
			/>
		</div>
	)
}
