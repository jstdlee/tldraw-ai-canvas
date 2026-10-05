/** Wheel moves the canvas. Alt+wheel scrolls the field under the pointer. */

let installed = false

function scrollTarget(event: Event): HTMLElement | null {
	const node = event.target
	if (!(node instanceof Element)) return null
	return node.closest<HTMLElement>('textarea, .NodeScroll, .CodeArea-input, .clip-editor')
}

function forwardToCanvas(event: WheelEvent) {
	const canvas = document.querySelector('.tl-canvas')
	if (!canvas) return
	const forwarded = new WheelEvent('wheel', {
		bubbles: true,
		cancelable: true,
		deltaX: event.deltaX,
		deltaY: event.deltaY,
		deltaMode: event.deltaMode,
		clientX: event.clientX,
		clientY: event.clientY,
		ctrlKey: event.ctrlKey,
		shiftKey: event.shiftKey,
	})
	;(forwarded as WheelEvent & { __canvasWheel?: boolean }).__canvasWheel = true
	canvas.dispatchEvent(forwarded)
}

export function installAltScroll() {
	if (installed || typeof document === 'undefined') return
	installed = true
	document.addEventListener(
		'wheel',
		(event) => {
			if ((event as WheelEvent & { __canvasWheel?: boolean }).__canvasWheel) return
			if (event.ctrlKey || event.metaKey) return
			const area = scrollTarget(event)
			if (!area) return
			event.preventDefault()
			event.stopPropagation()
			if (!event.altKey) {
				forwardToCanvas(event)
				return
			}
			area.scrollTop += event.deltaY
			area.scrollLeft += event.deltaX
		},
		{ capture: true, passive: false }
	)
}
