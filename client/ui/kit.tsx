import classNames from 'classnames'
import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode, Ref } from 'react'
import { createPortal } from 'react-dom'
import { useContainerIfExists } from '@tldraw/editor'
import {
	TldrawUiButton,
	TldrawUiButtonCheck,
	TldrawUiButtonLabel,
	TldrawUiDropdownMenuContent,
	TldrawUiDropdownMenuGroup,
	TldrawUiDropdownMenuItem,
	TldrawUiDropdownMenuRoot,
	TldrawUiDropdownMenuTrigger,
	TldrawUiSlider,
} from 'tldraw'
import { clipCell, isNumericCell, tableWindow } from '../../shared/clipCell'
import {
	IconAlert,
	IconCheck,
	IconChevronDown,
	IconChevronRight,
	IconClose,
	IconCopy,
	IconSparkle,
} from './icons'

function stopPointer(event: PointerEvent) {
	event.stopPropagation()
}

function stopKey(event: KeyboardEvent) {
	event.stopPropagation()
}

export interface UiButtonProps {
	variant?: 'primary' | 'normal' | 'low' | 'danger'
	icon?: ReactNode
	label?: ReactNode
	onClick?: () => void
	disabled?: boolean
	title?: string
	size?: 'sm' | 'md'
	active?: boolean
	className?: string
}

/** Tldraw button. `sm` fits inside a node. `md` is the panel size. */
export const UiButton = forwardRef<HTMLButtonElement, UiButtonProps>(function UiButton(
	{ variant = 'normal', icon, label, onClick, disabled, title, size = 'md', active, className },
	ref
) {
	const type = variant === 'primary' ? 'primary' : variant === 'normal' ? 'normal' : 'low'
	return (
		<TldrawUiButton
			ref={ref}
			type={type}
			title={title}
			disabled={disabled}
			isActive={active}
			className={classNames('UiButton', `UiButton_${size}`, variant === 'danger' && 'UiButton_danger', className)}
			onPointerDown={stopPointer}
			onKeyDown={stopKey}
			onClick={onClick}
		>
			{icon && <span className="UiButton-icon">{icon}</span>}
			{label != null && label !== '' && <TldrawUiButtonLabel>{label}</TldrawUiButtonLabel>}
		</TldrawUiButton>
	)
})

export interface UiIconButtonProps {
	icon: ReactNode
	title: string
	onClick?: () => void
	active?: boolean
	disabled?: boolean
	/** When this becomes true, the button shows success for 900 ms. */
	done?: boolean
	className?: string
}

/** Square icon button. Owns the success flash timer. */
export const UiIconButton = forwardRef<HTMLButtonElement, UiIconButtonProps>(function UiIconButton(
	{ icon, title, onClick, active, disabled, done, className, ...rest },
	ref
) {
	const [flash, setFlash] = useState(false)
	const extra = rest as {
		className?: string
		onClick?: (event: unknown) => void
		onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void
		onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void
	}
	useEffect(() => {
		if (!done) return
		setFlash(true)
		const timer = window.setTimeout(() => setFlash(false), 900)
		return () => window.clearTimeout(timer)
	}, [done])
	return (
		<TldrawUiButton
			{...rest}
			ref={ref}
			type="icon"
			title={title}
			disabled={disabled}
			isActive={active}
			className={classNames('UiIconButton', active && 'is-active', flash && 'is-done', className, extra.className)}
			onPointerDown={(event) => {
				stopPointer(event)
				extra.onPointerDown?.(event)
			}}
			onKeyDown={(event) => {
				stopKey(event)
				extra.onKeyDown?.(event)
			}}
			onClick={(event) => {
				onClick?.()
				extra.onClick?.(event)
			}}
		>
			{flash ? <IconCheck /> : icon}
		</TldrawUiButton>
	)
})

export interface UiSelectOption<T extends string = string> {
	value: T
	label: string
	hint?: string
	group?: string
	disabled?: boolean
}

interface SelectBaseProps<T extends string> {
	options: UiSelectOption<T>[]
	onChange: (value: T) => void
	placeholder?: string
	title?: string
	disabled?: boolean
	className?: string
	onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void
	onFocus?: () => void
}

function optionGroups<T extends string>(options: UiSelectOption<T>[]) {
	const groups: { group?: string; items: UiSelectOption<T>[] }[] = []
	for (const option of options) {
		const last = groups[groups.length - 1]
		if (last && last.group === option.group) last.items.push(option)
		else groups.push({ group: option.group, items: [option] })
	}
	return groups
}

function SelectItems<T extends string>({
	options,
	isOn,
	onPick,
	stayOpen,
}: {
	options: UiSelectOption<T>[]
	isOn: (option: UiSelectOption<T>) => boolean
	onPick: (value: T) => void
	stayOpen?: boolean
}) {
	if (options.length === 0) return <div className="UiSelect-empty">No choices</div>
	return (
		<>
			{optionGroups(options).map((group, index) => (
				<TldrawUiDropdownMenuGroup key={`${group.group ?? ''}:${index}`}>
					{group.group && <div className="UiSelect-group">{group.group}</div>}
					{group.items.map((option) => (
						<TldrawUiDropdownMenuItem key={option.value} noClose={stayOpen}>
							<TldrawUiButton
								type="menu"
								disabled={option.disabled}
								onPointerDown={stopPointer}
								onClick={() => {
									if (option.disabled) return
									onPick(option.value)
								}}
							>
								<TldrawUiButtonCheck checked={isOn(option)} />
								<TldrawUiButtonLabel>
									{option.label}
									{option.hint && <span className="UiSelect-hint">{option.hint}</span>}
								</TldrawUiButtonLabel>
							</TldrawUiButton>
						</TldrawUiDropdownMenuItem>
					))}
				</TldrawUiDropdownMenuGroup>
			))}
		</>
	)
}

function SelectTrigger({
	shown,
	title,
	disabled,
	className,
	onPointerDown,
	onFocus,
	buttonRef,
}: {
	shown: string
	title?: string
	disabled?: boolean
	className?: string
	onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void
	onFocus?: () => void
	buttonRef?: Ref<HTMLButtonElement>
}) {
	return (
		<TldrawUiButton
			ref={buttonRef}
			type="normal"
			className={classNames('UiSelect-trigger', className)}
			title={title ?? shown}
			disabled={disabled}
			onPointerDown={(event) => {
				stopPointer(event)
				onPointerDown?.(event)
				onFocus?.()
			}}
			onKeyDown={stopKey}
		>
			<span className="UiSelect-label">{shown}</span>
			<IconChevronDown size={14} />
		</TldrawUiButton>
	)
}

function themeClass(anchor: HTMLElement | null): string {
	const node = anchor?.closest('.tl-theme__dark, .tl-theme__light')
	if (node?.classList.contains('tl-theme__dark')) return 'tl-theme__dark'
	if (document.querySelector('.tl-theme__dark') && !document.querySelector('.tl-theme__light')) return 'tl-theme__dark'
	return 'tl-theme__light'
}

/** Same menu, portaled to the body, for UI that sits outside the tldraw container. */
function FallbackMenu({
	shown,
	title,
	disabled,
	className,
	options,
	isOn,
	onPick,
	stayOpen,
	onPointerDown,
	onFocus,
}: {
	shown: string
	title?: string
	disabled?: boolean
	className?: string
	options: UiSelectOption<string>[]
	isOn: (option: UiSelectOption<string>) => boolean
	onPick: (value: string) => void
	stayOpen?: boolean
	onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void
	onFocus?: () => void
}) {
	const [open, setOpen] = useState(false)
	const buttonRef = useRef<HTMLButtonElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null)
	const listId = useId()

	useLayoutEffect(() => {
		if (!open || !buttonRef.current) return
		const rect = buttonRef.current.getBoundingClientRect()
		const width = Math.max(rect.width, 160)
		const left = Math.min(rect.left, window.innerWidth - width - 8)
		const menuHeight = Math.min(280, Math.max(1, options.length) * 36 + 8)
		const below = rect.bottom + 4
		const top = below + menuHeight > window.innerHeight - 8 ? Math.max(8, rect.top - menuHeight - 4) : below
		setBox({ top, left: Math.max(8, left), width })
	}, [open, options.length])

	useEffect(() => {
		if (!open) return
		const close = (event: globalThis.PointerEvent) => {
			const target = event.target as Node | null
			if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
			setOpen(false)
		}
		const onKey = (event: globalThis.KeyboardEvent) => {
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
		<div className={classNames('UiSelect', className)}>
			<TldrawUiButton
				ref={buttonRef}
				type="normal"
				className="UiSelect-trigger"
				title={title ?? shown}
				disabled={disabled}
				aria-expanded={open}
				aria-controls={listId}
				onPointerDown={(event) => {
					stopPointer(event)
					onPointerDown?.(event)
				}}
				onKeyDown={stopKey}
				onClick={() => {
					if (disabled) return
					onFocus?.()
					setOpen((was) => !was)
				}}
			>
				<span className="UiSelect-label">{shown}</span>
				<IconChevronDown size={14} />
			</TldrawUiButton>
			{open &&
				box &&
				createPortal(
					<div
						ref={menuRef}
						id={listId}
						className={'UiMenu tl-container ' + themeClass(buttonRef.current)}
						style={{ top: box.top, left: box.left, width: box.width }}
						onPointerDown={stopPointer}
						onWheel={(event) => event.stopPropagation()}
					>
						{options.length === 0 && <div className="UiSelect-empty">No choices</div>}
						{optionGroups(options).map((group, index) => (
							<div key={`${group.group ?? ''}:${index}`} className="UiMenu-group">
								{group.group && <div className="UiSelect-group">{group.group}</div>}
								{group.items.map((option) => {
									const on = isOn(option)
									return (
										<button
											key={option.value}
											type="button"
											className={'UiMenu-item' + (on ? ' is-on' : '')}
											disabled={option.disabled}
											onClick={() => {
												if (option.disabled) return
												onPick(option.value)
												if (!stayOpen) setOpen(false)
											}}
										>
											<span className="UiMenu-mark">{on ? <IconCheck size={14} /> : null}</span>
											<span>{option.label}</span>
											{option.hint && <span className="UiSelect-hint">{option.hint}</span>}
										</button>
									)
								})}
							</div>
						))}
					</div>,
					document.body
				)}
		</div>
	)
}

export function UiSelect<T extends string>({
	value,
	options,
	onChange,
	placeholder,
	title,
	disabled,
	className,
	onPointerDown,
	onFocus,
}: SelectBaseProps<T> & { value: T }) {
	const id = useId()
	const container = useContainerIfExists()
	const current = options.find((option) => option.value === value)
	const shown = current?.label || placeholder || value || 'Choose'
	if (!container) {
		return (
			<FallbackMenu
				shown={shown}
				title={title}
				disabled={disabled}
				className={className}
				options={options}
				isOn={(option) => option.value === value}
				onPick={(next) => onChange(next as T)}
				onPointerDown={onPointerDown}
				onFocus={onFocus}
			/>
		)
	}
	return (
		<div className={classNames('UiSelect', className)}>
			<TldrawUiDropdownMenuRoot id={id}>
				<TldrawUiDropdownMenuTrigger>
					<SelectTrigger
						shown={shown}
						title={title}
						disabled={disabled}
						onPointerDown={onPointerDown}
						onFocus={onFocus}
					/>
				</TldrawUiDropdownMenuTrigger>
				<TldrawUiDropdownMenuContent side="bottom" align="start" sideOffset={4} alignOffset={0}>
					<div onPointerDown={stopPointer} onWheel={(event) => event.stopPropagation()}>
						<SelectItems options={options} isOn={(option) => option.value === value} onPick={onChange} />
					</div>
				</TldrawUiDropdownMenuContent>
			</TldrawUiDropdownMenuRoot>
		</div>
	)
}

export function UiMultiSelect<T extends string>({
	values,
	options,
	onChange,
	placeholder,
	title,
	disabled,
	className,
	onPointerDown,
	onFocus,
}: Omit<SelectBaseProps<T>, 'onChange'> & { values: T[]; onChange: (values: T[]) => void }) {
	const id = useId()
	const container = useContainerIfExists()
	const shown = values.length
		? values.map((item) => options.find((option) => option.value === item)?.label ?? item).join(', ')
		: placeholder || 'Choose'
	const toggle = (next: T) => {
		onChange(values.includes(next) ? values.filter((item) => item !== next) : [...values, next])
	}
	if (!container) {
		return (
			<FallbackMenu
				shown={shown}
				title={title}
				disabled={disabled}
				className={className}
				options={options}
				isOn={(option) => values.includes(option.value as T)}
				onPick={(next) => toggle(next as T)}
				stayOpen
				onPointerDown={onPointerDown}
				onFocus={onFocus}
			/>
		)
	}
	return (
		<div className={classNames('UiSelect', className)}>
			<TldrawUiDropdownMenuRoot id={id}>
				<TldrawUiDropdownMenuTrigger>
					<SelectTrigger shown={shown} title={title} disabled={disabled} onPointerDown={onPointerDown} onFocus={onFocus} />
				</TldrawUiDropdownMenuTrigger>
				<TldrawUiDropdownMenuContent side="bottom" align="start" sideOffset={4} alignOffset={0}>
					<div onPointerDown={stopPointer} onWheel={(event) => event.stopPropagation()}>
						<SelectItems
							options={options}
							isOn={(option) => values.includes(option.value)}
							onPick={toggle}
							stayOpen
						/>
					</div>
				</TldrawUiDropdownMenuContent>
			</TldrawUiDropdownMenuRoot>
		</div>
	)
}

export interface UiTextInputProps {
	value: string
	onChange: (value: string) => void
	placeholder?: string
	mono?: boolean
	onCommit?: (value: string) => void
	className?: string
	disabled?: boolean
	title?: string
	type?: string
	autoFocus?: boolean
	autoComplete?: string
	inputMode?: 'decimal' | 'text' | 'numeric'
	onBlur?: () => void
	onFocus?: () => void
	onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
	onPointerDown?: (event: PointerEvent<HTMLInputElement>) => void
}

export const UiTextInput = forwardRef<HTMLInputElement, UiTextInputProps>(function UiTextInput(
	{
		value,
		onChange,
		placeholder,
		mono,
		onCommit,
		className,
		disabled,
		title,
		type = 'text',
		autoFocus,
		autoComplete,
		inputMode,
		onBlur,
		onFocus,
		onKeyDown,
		onPointerDown,
	},
	ref
) {
	return (
		<input
			ref={ref}
			className={classNames('UiInput', mono && 'UiInput_mono', className)}
			type={type}
			value={value}
			placeholder={placeholder}
			disabled={disabled}
			title={title}
			autoFocus={autoFocus}
			autoComplete={autoComplete}
			inputMode={inputMode}
			onPointerDown={(event) => {
				stopPointer(event)
				onPointerDown?.(event)
			}}
			onKeyDown={(event) => {
				stopKey(event)
				onKeyDown?.(event)
				if (event.key === 'Enter') event.currentTarget.blur()
			}}
			onChange={(event) => onChange(event.target.value)}
			onBlur={(event) => {
				onCommit?.(event.currentTarget.value)
				onBlur?.()
			}}
			onFocus={onFocus}
		/>
	)
})

export function UiTextArea({
	value,
	onChange,
	placeholder,
	mono,
	rows,
	grow,
	className,
	disabled,
	title,
	autoFocus,
	style,
	onKeyDown,
	onPointerDown,
	onSubmit,
	submitOn,
}: {
	value: string
	onChange: (value: string) => void
	placeholder?: string
	mono?: boolean
	rows?: number
	grow?: boolean
	className?: string
	disabled?: boolean
	title?: string
	autoFocus?: boolean
	style?: CSSProperties
	onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
	onPointerDown?: (event: PointerEvent<HTMLTextAreaElement>) => void
	/** Called when the field should run (Enter, or Ctrl/Cmd+Enter when `submitOn` is 'mod-enter'). */
	onSubmit?: () => void
	/** 'enter': Enter runs, Shift+Enter is a newline. 'mod-enter': only Ctrl/Cmd+Enter runs. */
	submitOn?: 'enter' | 'mod-enter'
}) {
	return (
		<textarea
			className={classNames('UiTextArea', mono && 'UiTextArea_mono', grow && 'UiTextArea_grow', className)}
			value={value}
			placeholder={placeholder}
			rows={rows}
			disabled={disabled}
			title={title}
			autoFocus={autoFocus}
			style={style}
			onPointerDown={(event) => {
				stopPointer(event)
				onPointerDown?.(event)
			}}
			onKeyDown={(event) => {
				stopKey(event)
				onKeyDown?.(event)
				if (event.defaultPrevented || !onSubmit) return
				// An IME composing a CJK/Japanese/Korean character also fires "Enter" to confirm it.
				if (event.nativeEvent.isComposing) return
				if (event.key !== 'Enter') return
				if (submitOn === 'mod-enter') {
					if (event.ctrlKey || event.metaKey) {
						event.preventDefault()
						onSubmit()
					}
					return
				}
				if (event.shiftKey) return
				event.preventDefault()
				onSubmit()
			}}
			onChange={(event) => onChange(event.target.value)}
		/>
	)
}

export interface UiSecretInputProps {
	/** The saved ref (`secret:<id>`), or undefined/empty if no key is saved. */
	value: string | undefined
	onChange: (ref: string | undefined) => void
	placeholder?: string
	className?: string
}

async function postSecret(value: string): Promise<string | undefined> {
	try {
		const res = await fetch('/api/secrets', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ value }),
		})
		if (!res.ok) return undefined
		const data = (await res.json()) as { ref?: string }
		return data.ref
	} catch {
		return undefined
	}
}

function deleteSecretRef(ref: string | undefined) {
	const id = ref && /^secret:([A-Za-z0-9_-]+)$/.exec(ref)?.[1]
	if (!id) return
	fetch(`/api/secrets/${id}`, { method: 'DELETE' }).catch(() => {})
}

/**
 * A key field whose value never stays on the canvas: typing a key and leaving
 * the field posts it to the server's secret store and keeps only a `secret:<id>`
 * reference. Once saved, shows "Key saved ••••" with Replace / Remove.
 */
export function UiSecretInput({ value, onChange, placeholder = 'API key (optional)', className }: UiSecretInputProps) {
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState('')
	const hasRef = !!value && !editing
	const save = async () => {
		const text = draft.trim()
		const previous = value
		setDraft('')
		setEditing(false)
		if (!text) return
		const ref = await postSecret(text)
		if (ref) {
			onChange(ref)
			if (previous && previous !== ref) deleteSecretRef(previous)
		}
	}
	if (hasRef) {
		return (
			<div className={classNames('UiSecretInput', className)}>
				<span className="UiSecretInput-saved">Key saved ••••</span>
				<UiButton size="sm" variant="low" label="Replace" onClick={() => setEditing(true)} />
				<UiButton
					size="sm"
					variant="low"
					label="Remove"
					onClick={() => {
						deleteSecretRef(value)
						onChange(undefined)
					}}
				/>
			</div>
		)
	}
	return (
		<div className={classNames('UiSecretInput', className)}>
			<input
				className="UiInput"
				type="password"
				autoComplete="off"
				placeholder={placeholder}
				value={draft}
				onPointerDown={stopPointer}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					stopKey(event)
					if (event.key === 'Enter') event.currentTarget.blur()
				}}
				onBlur={() => void save()}
			/>
			{editing && (
				<UiButton size="sm" variant="low" label="Cancel" onClick={() => setEditing(false)} />
			)}
		</div>
	)
}

export function UiNumberInput({
	value,
	onChange,
	min,
	max,
	step,
	disabled,
	title,
	placeholder,
	className,
}: {
	value: number | null
	onChange: (value: number | null) => void
	min?: number
	max?: number
	step?: number
	disabled?: boolean
	title?: string
	placeholder?: string
	className?: string
}) {
	return (
		<input
			className={classNames('UiInput', 'UiNumber', className)}
			type="number"
			value={value ?? ''}
			min={min}
			max={max}
			step={step}
			disabled={disabled}
			title={title}
			placeholder={placeholder}
			onPointerDown={stopPointer}
			onKeyDown={stopKey}
			onChange={(event) => {
				const next = event.target.value
				if (next === '') {
					onChange(null)
					return
				}
				const number = Number(next)
				if (Number.isNaN(number)) return
				onChange(number)
			}}
		/>
	)
}

export function UiCheckbox({
	checked,
	onChange,
	label,
	disabled,
	title,
}: {
	checked: boolean
	onChange: (checked: boolean) => void
	label?: ReactNode
	disabled?: boolean
	title?: string
}) {
	return (
		<label className="UiCheckbox" title={title} onPointerDown={stopPointer}>
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(event) => onChange(event.target.checked)}
				onKeyDown={stopKey}
			/>
			<span className="UiCheckbox-box" aria-hidden>
				{checked && <IconCheck size={12} />}
			</span>
			{label != null && <span className="UiCheckbox-label">{label}</span>}
		</label>
	)
}

/** Map a real range onto TldrawUiSlider, which only moves in whole steps. */
export function UiSlider({
	value,
	min,
	max,
	step = 1,
	onChange,
	label,
}: {
	value: number
	min: number
	max: number
	step?: number
	onChange: (value: number) => void
	label: string
}) {
	const safeStep = step > 0 ? step : 1
	const steps = Math.max(1, Math.round((max - min) / safeStep))
	const raw = Math.round((value - min) / safeStep)
	const index = Math.max(0, Math.min(steps, Number.isFinite(raw) ? raw : 0))
	const places = (String(safeStep).split('.')[1] ?? '').length
	return (
		<div className="UiSlider" onPointerDown={stopPointer} onKeyDown={stopKey}>
			<TldrawUiSlider
				label={label}
				title={label}
				min={0}
				steps={steps}
				value={index}
				onValueChange={(next) => onChange(Number((min + next * safeStep).toFixed(places)))}
			/>
		</div>
	)
}

export function UiSegmented<T extends string>({
	value,
	options,
	onChange,
}: {
	value: T
	options: { value: T; label: string }[]
	onChange: (value: T) => void
}) {
	return (
		<div className="UiSegmented" role="group" onPointerDown={stopPointer}>
			{options.map((option) => (
				<TldrawUiButton
					key={option.value}
					type="normal"
					isActive={option.value === value}
					className={classNames('UiSegmented-item', option.value === value && 'is-on')}
					onPointerDown={stopPointer}
					onKeyDown={stopKey}
					onClick={() => onChange(option.value)}
				>
					<TldrawUiButtonLabel>{option.label}</TldrawUiButtonLabel>
				</TldrawUiButton>
			))}
		</div>
	)
}

export function UiField({
	label,
	hint,
	children,
	inline,
}: {
	label: ReactNode
	hint?: ReactNode
	children: ReactNode
	inline?: boolean
}) {
	return (
		<label className={classNames('UiField', inline && 'UiField_inline')} onPointerDown={stopPointer}>
			<span className="UiField-label">{label}</span>
			<div className="UiField-control">{children}</div>
			{hint != null && hint !== '' && <span className="UiField-hint">{hint}</span>}
		</label>
	)
}

export function UiSection({
	title,
	children,
	collapsible,
	defaultOpen = true,
}: {
	title: string
	children: ReactNode
	collapsible?: boolean
	defaultOpen?: boolean
}) {
	const [open, setOpen] = useState(defaultOpen)
	const shown = !collapsible || open
	return (
		<section className="UiSection">
			{collapsible ? (
				<button type="button" className="UiSection-title" onPointerDown={stopPointer} onClick={() => setOpen((was) => !was)}>
					{open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
					{title}
				</button>
			) : (
				<div className="UiSection-title">{title}</div>
			)}
			{shown && <div className="UiSection-body">{children}</div>}
		</section>
	)
}

export function UiChip({
	label,
	icon,
	onClick,
	active,
}: {
	label: string
	icon?: ReactNode
	onClick?: () => void
	active?: boolean
}) {
	const className = classNames('UiChip', active && 'is-on')
	if (!onClick) {
		return (
			<span className={className}>
				{icon}
				{label}
			</span>
		)
	}
	return (
		<button type="button" className={className} onPointerDown={stopPointer} onClick={onClick}>
			{icon}
			{label}
		</button>
	)
}

export function UiEmpty({ icon, text }: { icon?: ReactNode; text: string }) {
	return (
		<div className="UiEmpty">
			{icon && <span className="UiEmpty-icon">{icon}</span>}
			<span>{text}</span>
		</div>
	)
}

export function UiTable({
	columns,
	rows,
	maxRows,
}: {
	columns: string[]
	rows: string[][]
	maxRows?: number
}) {
	const windowed = tableWindow(rows.length, maxRows)
	const shown = rows.slice(0, windowed.count)
	return (
		<div className="UiTable" onPointerDown={stopPointer} onWheel={(event) => event.stopPropagation()}>
			<table>
				<thead>
					<tr>
						{columns.map((column, index) => (
							<th key={`${column}:${index}`}>{column}</th>
						))}
					</tr>
				</thead>
				<tbody>
					{shown.map((row, rowIndex) => (
						<tr key={rowIndex}>
							{columns.map((_, columnIndex) => {
								const value = row[columnIndex] ?? ''
								return (
									<td key={columnIndex} className={isNumericCell(value) ? 'is-num' : undefined} title={value}>
										{clipCell(value)}
									</td>
								)
							})}
						</tr>
					))}
				</tbody>
			</table>
			{windowed.more > 0 && <div className="UiTable-more">+{windowed.more} more rows</div>}
		</div>
	)
}

export function UiErrorBanner({
	message,
	title = 'Run failed',
	onCopy,
	onFix,
	onDismiss,
}: {
	message: string
	title?: string
	onCopy?: () => void
	onFix?: () => void
	onDismiss?: () => void
}) {
	return (
		<div className="UiErrorBanner" role="alert" onPointerDown={stopPointer} onKeyDown={stopKey}>
			<IconAlert />
			<div className="UiErrorBanner-body">
				<div className="UiErrorBanner-title">{title}</div>
				<div className="UiErrorBanner-message">{message}</div>
			</div>
			<div className="UiErrorBanner-actions">
				{onCopy && <UiButton size="sm" variant="low" icon={<IconCopy />} label="Copy" title="Copy the error" onClick={onCopy} />}
				{onFix && (
					<UiButton size="sm" variant="low" icon={<IconSparkle />} label="Fix with AI" title="Ask AI to fix this error" onClick={onFix} />
				)}
				{onDismiss && <UiIconButton icon={<IconClose />} title="Dismiss" onClick={onDismiss} />}
			</div>
		</div>
	)
}
