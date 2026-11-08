import { useEffect } from 'react'
import { useEditor, useValue } from 'tldraw'
import { $searchBlink } from '../../shell/shellState'

/**
 * Canvas overlays mounted inside <Tldraw>: the search blink. WP44: the card AI ("fill") panel,
 * the Build with AI panel and the AI answer dialog are gone — all of them run in the docked
 * agent panel now (client/components/ChatPanel.tsx).
 */
export function CanvasExtras() {
	return <SearchBlink />
}

/** A dashed outline that blinks around the shape a search just jumped to. */
function SearchBlink() {
	const editor = useEditor()
	const blink = useValue('blink', () => $searchBlink.get(), [])
	// Clear the blink when its time is up so it does not linger.
	useEffect(() => {
		if (!blink) return
		const left = Math.max(0, blink.until - Date.now())
		const timer = setTimeout(() => $searchBlink.set(null), left)
		return () => clearTimeout(timer)
	}, [blink])
	const bounds = useValue('blink bounds', () => (blink ? editor.getShapePageBounds(blink.id) : undefined), [editor, blink])
	if (!blink || !bounds) return null
	const topLeft = editor.pageToViewport({ x: bounds.minX, y: bounds.minY })
	const zoom = editor.getZoomLevel()
	return (
		<div
			className="SearchBlink"
			style={{
				transform: `translate(${topLeft.x}px, ${topLeft.y}px)`,
				width: bounds.width * zoom,
				height: bounds.height * zoom,
			}}
		/>
	)
}
