/**
 * WP27 Part A: the same scroll-arrow bars as `MenuScrollArrows` (kit.tsx), but for tldraw's own
 * menus — the right-click context menu and its submenus, and the toolbar/Insert dropdowns —
 * which render as `.tlui-menu` elements we don't control the React tree of. Those menus can only
 * be reached as plain DOM, so this watches for them appearing anywhere in the page and attaches
 * two sticky `<button>` bars (same `.MenuScrollArrow` CSS as the kit component) directly, using
 * the native DOM APIs instead of React. Defensive by design: anything going wrong here should
 * never break the menu itself, so every step is wrapped and failures are silently skipped.
 */

const INSTRUMENTED = new WeakSet<HTMLElement>()

function makeArrow(dir: 'up' | 'down', target: HTMLElement): HTMLButtonElement {
	const button = document.createElement('button')
	button.type = 'button'
	button.className = `MenuScrollArrow MenuScrollArrow_${dir}`
	button.setAttribute('aria-label', dir === 'up' ? 'Scroll up' : 'Scroll down')
	button.innerHTML =
		dir === 'up'
			? '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 10l4-4 4 4"/></svg>'
			: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6l4 4 4-4"/></svg>'
	let hoverTimer: number | null = null
	const stopHover = () => {
		if (hoverTimer != null) {
			window.clearInterval(hoverTimer)
			hoverTimer = null
		}
	}
	button.addEventListener('pointerdown', (e) => e.stopPropagation())
	button.addEventListener('mouseenter', () => {
		stopHover()
		hoverTimer = window.setInterval(() => target.scrollBy({ top: dir === 'up' ? -14 : 14 }), 16)
	})
	button.addEventListener('mouseleave', stopHover)
	button.addEventListener('click', () => {
		target.scrollBy({ top: (dir === 'up' ? -1 : 1) * target.clientHeight * 0.8, behavior: 'smooth' })
	})
	return button
}

function instrument(menu: HTMLElement) {
	if (INSTRUMENTED.has(menu)) return
	// Already owned by the kit's own `MenuScrollArrows` (React) — e.g. this `.tlui-menu` IS a
	// UiSelect/UiMultiSelect dropdown, which finds and instruments it itself. The marker (set
	// synchronously, before either side's arrows render) avoids a race against React's own
	// effect-driven overflow state. Don't double the arrows up.
	if (menu.querySelector('[data-menu-overflow-owned], .MenuScrollArrow')) return
	INSTRUMENTED.add(menu)
	try {
		const up = makeArrow('up', menu)
		const down = makeArrow('down', menu)
		// Added/removed outright (not just display:none) so a hidden arrow has no DOM presence
		// at all — the same "hidden at the ends" semantics as the kit's own React component.
		const update = () => {
			const { scrollTop, scrollHeight, clientHeight } = menu
			const showUp = scrollTop > 1
			const showDown = scrollTop + clientHeight < scrollHeight - 1
			if (showUp && !up.isConnected) menu.prepend(up)
			else if (!showUp && up.isConnected) up.remove()
			if (showDown && !down.isConnected) menu.append(down)
			else if (!showDown && down.isConnected) down.remove()
		}
		update()
		menu.addEventListener('scroll', update, { passive: true })
		const ro = new ResizeObserver(update)
		ro.observe(menu)
		const mo = new MutationObserver(update)
		mo.observe(menu, { childList: true, subtree: true })
	} catch {
		// Never let an instrumentation failure break the menu itself.
	}
}

function scan(root: ParentNode) {
	try {
		if (root instanceof HTMLElement && root.matches('.tlui-menu')) instrument(root)
		root.querySelectorAll?.('.tlui-menu').forEach((el) => instrument(el as HTMLElement))
	} catch {
		// ignore
	}
}

let started = false

/** Idempotent: safe to call from more than one mounted component. */
export function initNativeMenuScrollArrows() {
	if (started || typeof document === 'undefined') return
	started = true
	scan(document.body)
	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			mutation.addedNodes.forEach((node) => {
				if (node instanceof HTMLElement) scan(node)
			})
		}
	})
	observer.observe(document.body, { childList: true, subtree: true })
}
