import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isValidElement, type ReactNode } from 'react'

export interface SelectOption {
	value: string
	label: string
	disabled?: boolean
	group?: string
}

/** Read `<option>` / `<optgroup>` children so existing menus can switch over. */
export function optionsFromChildren(children: ReactNode): SelectOption[] {
	const options: SelectOption[] = []
	const visit = (node: ReactNode, group?: string) => {
		if (node == null || typeof node === 'boolean') return
		if (Array.isArray(node)) {
			for (const child of node) visit(child, group)
			return
		}
		if (!isValidElement(node)) return
		const props = node.props as { value?: string; label?: string; disabled?: boolean; children?: ReactNode }
		if (node.type === 'optgroup') {
			visit(props.children, props.label ?? group)
			return
		}
		if (node.type === 'option') {
			options.push({
				value: props.value ?? '',
				label: textOf(props.children) || (props.value ?? ''),
				disabled: !!props.disabled,
				group,
			})
		}
	}
	visit(children)
	return options
}

/** The menu is portaled to body, so it must carry the canvas theme itself. */
function themeName(anchor: HTMLElement | null): string {
	const node = anchor?.closest('.tl-theme__dark, .tl-theme__light')
	if (node?.classList.contains('tl-theme__dark')) return 'tl-theme__dark'
	if (document.querySelector('.tl-theme__dark') && !document.querySelector('.tl-theme__light')) return 'tl-theme__dark'
	return 'tl-theme__light'
}

function textOf(node: ReactNode): string {
	if (node == null || typeof node === 'boolean') return ''
	if (typeof node === 'string' || typeof node === 'number') return String(node)
	if (Array.isArray(node)) return node.map(textOf).join('')
	if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
	return ''
}

/**
 * Menu styled like a tldraw control. The list is portaled, so a node underneath
 * cannot open it, and the list is not the browser's native popup.
 */
export function NodeSelect({
	value,
	onChange,
	disabled,
	title,
	children,
	className,
	onPointerDown,
	onFocus,
}: {
	value: string
	onChange: (event: { target: { value: string }; currentTarget: { value: string } }) => void
	disabled?: boolean
	title?: string
	children: ReactNode
	className?: string
	onPointerDown?: (event: React.PointerEvent) => void
	onFocus?: () => void
}) {
	const options = optionsFromChildren(children)
	return (
		<OptionMenu
			value={value}
			options={options}
			disabled={disabled}
			title={title}
			className={className}
			onPointerDown={onPointerDown}
			onFocus={onFocus}
			onPick={(next) => onChange({ target: { value: next }, currentTarget: { value: next } })}
		/>
	)
}

export function NodeMultiSelect({
	values,
	options,
	onChange,
	disabled,
	title,
	emptyLabel = 'Choose',
}: {
	values: string[]
	options: SelectOption[]
	onChange: (values: string[]) => void
	disabled?: boolean
	title?: string
	emptyLabel?: string
}) {
	const label = values.length ? values.join(', ') : emptyLabel
	return (
		<OptionMenu
			value=""
			options={options}
			disabled={disabled}
			title={title}
			label={label}
			multiple
			selected={values}
			onPick={(next) => {
				const has = values.includes(next)
				onChange(has ? values.filter((item) => item !== next) : [...values, next])
			}}
		/>
	)
}

function OptionMenu({
	value,
	options,
	disabled,
	title,
	className,
	label,
	multiple,
	selected,
	onPick,
	onPointerDown,
	onFocus,
}: {
	value: string
	options: SelectOption[]
	disabled?: boolean
	title?: string
	className?: string
	label?: string
	multiple?: boolean
	selected?: string[]
	onPick: (value: string) => void
	onPointerDown?: (event: React.PointerEvent) => void
	onFocus?: () => void
}) {
	const [open, setOpen] = useState(false)
	const buttonRef = useRef<HTMLButtonElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null)
	const listId = useId()
	const current = options.find((option) => option.value === value)
	const shown = label ?? current?.label ?? value ?? 'Choose'

	useLayoutEffect(() => {
		if (!open || !buttonRef.current) return
		const rect = buttonRef.current.getBoundingClientRect()
		const width = Math.max(rect.width, 160)
		const left = Math.min(rect.left, window.innerWidth - width - 8)
		const menuHeight = Math.min(280, options.length * 32 + 8)
		const below = rect.bottom + 4
		const top = below + menuHeight > window.innerHeight - 8 ? Math.max(8, rect.top - menuHeight - 4) : below
		setBox({ top, left: Math.max(8, left), width })
	}, [open, options.length])

	useEffect(() => {
		if (!open) return
		const close = (event: PointerEvent) => {
			const target = event.target as Node | null
			if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
			setOpen(false)
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false)
		}
		window.addEventListener('pointerdown', close, true)
		window.addEventListener('keydown', onKey)
		return () => {
			window.removeEventListener('pointerdown', close, true)
			window.removeEventListener('keydown', onKey)
		}
	}, [open])

	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				className={'TlSelect' + (className ? ` ${className}` : '')}
				title={title ?? shown}
				disabled={disabled}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={listId}
				onPointerDown={(event) => {
					event.stopPropagation()
					onPointerDown?.(event)
				}}
				onClick={() => {
					if (disabled) return
					onFocus?.()
					setOpen((was) => !was)
				}}
				onKeyDown={(event) => event.stopPropagation()}
			>
				<span className="TlSelect-label">{shown}</span>
				<span className="TlSelect-caret" aria-hidden />
			</button>
			{open &&
				box &&
				createPortal(
					<div
						ref={menuRef}
						id={listId}
						className={'TlSelect-menu tl-container ' + themeName(buttonRef.current)}
						role="listbox"
						aria-multiselectable={multiple || undefined}
						style={{ top: box.top, left: box.left, width: box.width }}
						onPointerDown={(event) => event.stopPropagation()}
						onWheel={(event) => event.stopPropagation()}
					>
						{options.map((option, index) => {
							const showGroup = option.group && option.group !== options[index - 1]?.group
							const isOn = multiple ? selected?.includes(option.value) : option.value === value
							return (
								<div key={`${option.group ?? ''}:${option.value}:${index}`}>
									{showGroup && <div className="TlSelect-group">{option.group}</div>}
									<button
										type="button"
										role="option"
										aria-selected={!!isOn}
										className={'TlSelect-item' + (isOn ? ' is-on' : '')}
										disabled={option.disabled}
										onClick={() => {
											if (option.disabled) return
											onPick(option.value)
											if (!multiple) setOpen(false)
										}}
									>
										{multiple && <span className="TlSelect-mark">{isOn ? '✓' : ''}</span>}
										{option.label}
									</button>
								</div>
							)
						})}
						{options.length === 0 && <div className="TlSelect-empty">No choices</div>}
					</div>,
					document.body
				)}
		</>
	)
}
