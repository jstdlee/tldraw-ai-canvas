import { isValidElement, type PointerEvent, type ReactNode } from 'react'
import { UiMultiSelect, UiSelect, type UiSelectOption } from '../../../ui'

export interface SelectOption {
	value: string
	label: string
	disabled?: boolean
	group?: string
	hint?: string
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
			const label = textOf(props.children) || (props.value ?? '')
			// A native option with no value attribute uses its text.
			options.push({
				value: props.value ?? label,
				label: label || (props.value ?? ''),
				disabled: !!props.disabled,
				group,
			})
		}
	}
	visit(children)
	return options
}

function textOf(node: ReactNode): string {
	if (node == null || typeof node === 'boolean') return ''
	if (typeof node === 'string' || typeof node === 'number') return String(node)
	if (Array.isArray(node)) return node.map(textOf).join('')
	if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
	return ''
}

/**
 * Menu styled like a tldraw control. Keeps the old `<option>` children API.
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
	onPointerDown?: (event: PointerEvent) => void
	onFocus?: () => void
}) {
	return (
		<UiSelect
			className={className}
			value={value}
			options={optionsFromChildren(children)}
			disabled={disabled}
			title={title}
			placeholder="Choose"
			onPointerDown={onPointerDown}
			onFocus={onFocus}
			onChange={(next) => onChange({ target: { value: next }, currentTarget: { value: next } })}
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
	const items: UiSelectOption[] = options
	return (
		<UiMultiSelect
			values={values}
			options={items}
			disabled={disabled}
			title={title}
			placeholder={emptyLabel}
			onChange={onChange}
		/>
	)
}
