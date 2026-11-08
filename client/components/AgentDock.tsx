import { useCallback, useRef, useState } from 'react'
import { ErrorBoundary } from 'tldraw'
import { TldrawAgentApp } from '../agent/TldrawAgentApp'
import { TldrawAgentAppContextProvider } from '../agent/TldrawAgentAppProvider'
import { ChatPanel, ChatPanelHeader } from './ChatPanel'
import { ChatPanelFallback } from './ChatPanelFallback'

const WIDTH_KEY = 'oh-my-tldraw:agent-dock-width'
export const DOCK_DEFAULT_WIDTH = 380
export const DOCK_MIN_WIDTH = 300
export const DOCK_MAX_WIDTH = 640

function clampWidth(width: number): number {
	return Math.round(Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, width)))
}

function loadWidth(): number {
	try {
		const raw = Number(localStorage.getItem(WIDTH_KEY))
		return raw ? clampWidth(raw) : DOCK_DEFAULT_WIDTH
	} catch {
		return DOCK_DEFAULT_WIDTH
	}
}

function saveWidth(width: number) {
	try {
		localStorage.setItem(WIDTH_KEY, String(width))
	} catch {
		// Private mode: the width just is not remembered.
	}
}

/**
 * WP44: the agent panel, docked as the layout's right column (the canvas column gets
 * narrower; tldraw follows its container's size). Drag the left edge to resize (300–640 px,
 * remembered); double-click it to go back to 380 px. Rendered outside <Tldraw>, like the
 * node library, so it needs its own `tl-theme__*` class for tldraw's colour variables.
 */
export function AgentDock({
	app,
	open,
	isDark,
	onClose,
}: {
	app: TldrawAgentApp | null
	open: boolean
	isDark: boolean
	onClose: () => void
}) {
	const [width, setWidth] = useState(loadWidth)
	const [resizing, setResizing] = useState(false)
	const [sheet, setSheet] = useState<'rewrite' | 'presets' | null>(null)
	const drag = useRef<{ startX: number; startWidth: number } | null>(null)

	const onPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) return
			event.preventDefault()
			event.currentTarget.setPointerCapture(event.pointerId)
			drag.current = { startX: event.clientX, startWidth: width }
			setResizing(true)
		},
		[width]
	)
	const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		if (!drag.current) return
		// The handle is on the left edge: dragging left makes the dock wider.
		setWidth(clampWidth(drag.current.startWidth + drag.current.startX - event.clientX))
	}, [])
	const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		if (!drag.current) return
		drag.current = null
		setResizing(false)
		event.currentTarget.releasePointerCapture(event.pointerId)
		setWidth((w) => {
			saveWidth(w)
			return w
		})
	}, [])

	return (
		<aside
			className={
				`agent-dock ${isDark ? 'tl-theme__dark' : 'tl-theme__light'}` +
				(open ? ' is-open' : '') +
				(resizing ? ' is-resizing' : '')
			}
			aria-label="Agent"
			aria-hidden={!open}
			style={{ width: open ? width : 0 }}
		>
			{open && app && (
				<>
					<div
						className="agent-dock-resize"
						role="separator"
						aria-orientation="vertical"
						aria-label="Resize the agent panel"
						title="Drag to resize, double-click to reset"
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
						onPointerCancel={onPointerUp}
						onDoubleClick={() => {
							setWidth(DOCK_DEFAULT_WIDTH)
							saveWidth(DOCK_DEFAULT_WIDTH)
						}}
					/>
					<div className="agent-dock-inner tl-container" style={{ width }}>
						<TldrawAgentAppContextProvider app={app}>
							<ChatPanelHeader onClose={onClose} onOpenSheet={setSheet} />
							<ErrorBoundary fallback={ChatPanelFallback}>
								<ChatPanel sheet={sheet} setSheet={setSheet} />
							</ErrorBoundary>
						</TldrawAgentAppContextProvider>
					</div>
				</>
			)}
		</aside>
	)
}
