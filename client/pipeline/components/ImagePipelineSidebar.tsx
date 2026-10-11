import { cloneElement, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { ContainerProvider, tlmenus } from '@tldraw/editor'
import {
	Editor,
	getPointerInfo,
	onDragFromToolbarToCreateShape,
	TldrawUiPopover,
	TldrawUiPopoverContent,
	TldrawUiPopoverTrigger,
	TLUiIconJsx,
	useValue,
	Vec,
} from 'tldraw'
import { filterLibrary } from '../../../shared/libraryFilter'
import { NODE_GROUP_LABELS, NODE_GROUP_ORDER } from '../../../shared/nodeGroups'
import { $libraryRail } from '../../shell/shellState'
import {
	IconChevronDown,
	IconChevronRight,
	IconGroup,
	IconPlay,
	IconSidebarCollapse,
	IconSidebarExpand,
	IconSparkle,
	IconTable,
	IconTrash,
	UiEmpty,
	UiIconButton,
	UiTextInput,
} from '../../ui'
import { $customNodes, addCustomNodeToCanvas, deleteCustomNode, refreshCustomNodes, type CustomNodeMeta } from '../customNodes'
import { getNodeDefinitions, NodeType } from '../nodes/nodeTypes'
import { createNodeAt } from '../placeNode'

const DRAG_DISTANCE_SQ = 36 // 6px
const GROUPS_KEY = 'oh-my-tldraw:library-groups'

/** Kit icons that read better than the first node's icon. Other groups use that icon. */
const GROUP_ICONS: Record<string, (props: { size?: number }) => ReactElement> = {
	my: IconGroup,
	llm: IconSparkle,
	data: IconTable,
	media: IconPlay,
}

type LibraryDef = ReturnType<typeof getNodeDefinitions>[keyof ReturnType<typeof getNodeDefinitions>]

interface LibraryRow {
	type: string
	title: string
	category: string
	def: LibraryDef
}

function readClosedGroups(): string[] {
	try {
		const parsed = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]') as unknown
		if (!Array.isArray(parsed)) return []
		return parsed.filter((id): id is string => typeof id === 'string')
	} catch {
		return []
	}
}

function writeClosedGroups(ids: string[]) {
	try {
		localStorage.setItem(GROUPS_KEY, JSON.stringify(ids))
	} catch {
		// Private mode: which groups are closed is not remembered.
	}
}

function groupIcon(id: string, fallback: TLUiIconJsx) {
	const Icon = GROUP_ICONS[id]
	if (Icon) return <Icon size={18} />
	// The same icon element is also the row icon. Clone it so both can show.
	return cloneElement(fallback)
}

function createNodeAtCenter(editor: Editor, node: NodeType) {
	createNodeAt(editor, node, { near: 'viewport' })
}

function matchesCustom(node: CustomNodeMeta, query: string) {
	const q = query.trim().toLowerCase()
	if (!q) return true
	if ('my nodes'.includes(q)) return true
	return node.name.toLowerCase().includes(q) || node.description.toLowerCase().includes(q)
}

function SidebarItem({
	editor,
	title,
	icon,
	getDefault,
	onUsed,
}: {
	editor: Editor
	title: string
	icon: TLUiIconJsx
	getDefault: () => NodeType
	onUsed?: () => void
}) {
	const stateRef = useRef<
		| { name: 'idle' }
		| { name: 'pointing'; start: { x: number; y: number } }
		| { name: 'dragging' }
		| { name: 'dragged' }
	>({ name: 'idle' })

	return (
		<button
			type="button"
			className="ImagePipelineSidebar-item"
			onPointerDown={(e) => {
				stateRef.current = {
					name: 'pointing',
					start: { x: e.clientX, y: e.clientY },
				}
				e.currentTarget.setPointerCapture(e.pointerId)
			}}
			onPointerMove={(e) => {
				if (stateRef.current.name === 'pointing') {
					const dist = Vec.Dist2(stateRef.current.start, {
						x: e.clientX,
						y: e.clientY,
					})
					if (dist > DRAG_DISTANCE_SQ) {
						const start = stateRef.current.start
						stateRef.current = { name: 'dragging' }

						editor.run(() => {
							editor.setCurrentTool('select')
							editor.dispatch({
								type: 'pointer',
								target: 'canvas',
								name: 'pointer_down',
								...getPointerInfo(editor, e.nativeEvent),
								point: start,
							})
							editor.selectNone()
							onDragFromToolbarToCreateShape(
								editor,
								{
									type: 'pointer',
									target: 'canvas',
									name: 'pointer_move',
									...getPointerInfo(editor, e.nativeEvent),
									point: start,
								},
								{
									createShape: (id) => {
										editor.createShape({
											id,
											type: 'node',
											props: { node: getDefault() },
										})
									},
								}
							)
							editor.getContainer().focus()
						})
					}
				}
			}}
			onPointerUp={(e) => {
				e.currentTarget.releasePointerCapture(e.pointerId)
				if (stateRef.current.name === 'dragging') {
					editor.dispatch({
						type: 'pointer',
						target: 'canvas',
						name: 'pointer_up',
						...getPointerInfo(editor, e.nativeEvent),
					})
					stateRef.current = { name: 'dragged' }
					onUsed?.()
					return
				}
				stateRef.current = { name: 'idle' }
			}}
			onClick={() => {
				if (stateRef.current.name === 'dragged') {
					stateRef.current = { name: 'idle' }
					return
				}
				stateRef.current = { name: 'idle' }
				createNodeAtCenter(editor, getDefault())
				onUsed?.()
			}}
		>
			<span className="ImagePipelineSidebar-item-icon">{icon}</span>
			<span className="ImagePipelineSidebar-item-title">{title}</span>
		</button>
	)
}

function MyNodeRow({
	editor,
	node,
	onUsed,
}: {
	editor: Editor
	node: CustomNodeMeta
	onUsed?: () => void
}) {
	return (
		<div className="ImagePipelineSidebar-mynode">
			<button
				type="button"
				className="ImagePipelineSidebar-item"
				title={node.description || `Saved ${node.savedAt.slice(0, 10)}`}
				onClick={() => {
					void addCustomNodeToCanvas(editor, node.id)
					onUsed?.()
				}}
			>
				<span className="ImagePipelineSidebar-item-icon">
					<IconGroup size={18} />
				</span>
				<span className="ImagePipelineSidebar-item-title">{node.name}</span>
			</button>
			<UiIconButton
				className="ImagePipelineSidebar-delete"
				icon={<IconTrash />}
				title="Delete from My nodes"
				onClick={() => window.confirm(`Delete "${node.name}" from My nodes?`) && void deleteCustomNode(node.id)}
			/>
		</div>
	)
}

function GroupHeader({
	id,
	label,
	closed,
	onToggle,
}: {
	id: string
	label: string
	closed: boolean
	onToggle: (id: string) => void
}) {
	return (
		<button
			type="button"
			className="ImagePipelineSidebar-category"
			aria-expanded={!closed}
			onClick={() => onToggle(id)}
		>
			<span className="ImagePipelineSidebar-chevron">
				{closed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
			</span>
			{label}
		</button>
	)
}

function GroupFlyout({
	id,
	label,
	icon,
	open,
	ready,
	onOpenChange,
	children,
}: {
	id: string
	label: string
	icon: ReactElement
	open: boolean
	ready: boolean
	onOpenChange: (open: boolean) => void
	children: ReactElement | ReactElement[]
}) {
	// Popover content calls useContainer(). On the first paint the host div does not
	// exist yet, and rendering the content outside <Tldraw /> throws.
	if (!ready) {
		return <UiIconButton className="ImagePipelineSidebar-railButton" icon={icon} title={label} />
	}
	return (
		<TldrawUiPopover id={id} open={open} onOpenChange={onOpenChange}>
			<TldrawUiPopoverTrigger>
				<UiIconButton className="ImagePipelineSidebar-railButton" icon={icon} title={label} active={open} />
			</TldrawUiPopoverTrigger>
			<TldrawUiPopoverContent
				side="right"
				align="start"
				sideOffset={8}
				collisionPadding={8}
				autoFocusFirstButton={false}
			>
				<div className="ImagePipelineSidebar-flyout">
					<div className="ImagePipelineSidebar-flyout-label">{label}</div>
					{children}
				</div>
			</TldrawUiPopoverContent>
		</TldrawUiPopover>
	)
}

function useFlyoutRoot(themeClass: string) {
	const [container, setContainer] = useState<HTMLDivElement | null>(null)
	useEffect(() => {
		const el = document.createElement('div')
		el.className = `tl-container LibraryFlyoutRoot ${themeClass}`
		document.body.appendChild(el)
		setContainer(el)
		return () => {
			el.remove()
			setContainer(null)
		}
	}, [])
	useEffect(() => {
		if (!container) return
		container.className = `tl-container LibraryFlyoutRoot ${themeClass}`
	}, [container, themeClass])
	return container
}

export function ImagePipelineSidebar({ editor }: { editor: Editor }) {
	const defs = getNodeDefinitions(editor)
	const rail = useValue('library rail', () => $libraryRail.get(), [])
	const customNodes = useValue('custom nodes', () => $customNodes.get(), [])
	const isDark = useValue('dark mode', () => editor.user.getIsDarkMode(), [editor])
	const themeClass = isDark ? 'tl-theme__dark' : 'tl-theme__light'
	const flyoutRoot = useFlyoutRoot(themeClass)
	const flyoutsReady = flyoutRoot !== null
	const [query, setQuery] = useState('')
	const [closed, setClosed] = useState<string[]>(readClosedGroups)
	const [openGroup, setOpenGroup] = useState<string | null>(null)

	useEffect(() => {
		void refreshCustomNodes()
	}, [])

	useEffect(() => {
		if (rail || !openGroup) return
		tlmenus.deleteOpenMenu(openGroup)
		setOpenGroup(null)
	}, [rail, openGroup])

	const visible = Object.values(defs).filter((def) => !def.hidden)
	const grouped = new Map<string, LibraryDef[]>()
	for (const def of visible) {
		const list = grouped.get(def.category) ?? []
		list.push(def)
		grouped.set(def.category, list)
	}
	const rows: LibraryRow[] = []
	for (const cat of NODE_GROUP_ORDER) {
		for (const def of grouped.get(cat) ?? []) {
			rows.push({ type: def.type, title: def.title, category: cat, def })
		}
	}
	const searching = query.trim().length > 0
	const matches = filterLibrary(rows, query)
	const customMatches = customNodes.filter((node) => matchesCustom(node, query))

	const toggleGroup = (id: string) => {
		setClosed((current) => {
			const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
			writeClosedGroups(next)
			return next
		})
	}

	const closeGroup = (id: string) => {
		tlmenus.deleteOpenMenu(id)
		setOpenGroup((current) => (current === id ? null : current))
	}

	const onGroupOpen = (id: string, next: boolean) => {
		if (next) {
			if (openGroup && openGroup !== id) tlmenus.deleteOpenMenu(openGroup)
			setOpenGroup(id)
			return
		}
		setOpenGroup((current) => (current === id ? null : current))
	}

	const addFirstMatch = () => {
		if (!searching) return
		const custom = customMatches[0]
		if (custom) {
			void addCustomNodeToCanvas(editor, custom.id)
			return
		}
		const first = matches[0]
		if (first) createNodeAtCenter(editor, first.def.getDefault())
	}

	const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		if (event.nativeEvent.isComposing) return
		if (event.key === 'Escape') {
			setQuery('')
			return
		}
		if (event.key === 'Enter' && !event.repeat) addFirstMatch()
	}

	const defItem = (row: LibraryRow, onUsed?: () => void) => (
		<SidebarItem
			key={row.type}
			editor={editor}
			title={row.title}
			icon={row.def.icon}
			getDefault={() => row.def.getDefault()}
			onUsed={onUsed}
		/>
	)

	const tree = (
		<div className={`ImagePipelineSidebar tl-container ${themeClass}`}>
			{rail ? (
				<>
					<div className="ImagePipelineSidebar-railTop">
						<UiIconButton
							className="ImagePipelineSidebar-railButton"
							icon={<IconSidebarExpand />}
							title="Expand (Shift+B)"
							onClick={() => $libraryRail.set(false)}
						/>
					</div>
					<div className="ImagePipelineSidebar-rail">
						{customNodes.length > 0 && (
							<GroupFlyout
								id="library-group-my"
								label="My nodes"
								icon={groupIcon('my', <IconGroup />)}
								open={openGroup === 'library-group-my'}
								ready={flyoutsReady}
								onOpenChange={(next) => onGroupOpen('library-group-my', next)}
							>
								{customNodes.map((node) => (
									<MyNodeRow
										key={node.id}
										editor={editor}
										node={node}
										onUsed={() => closeGroup('library-group-my')}
									/>
								))}
							</GroupFlyout>
						)}
						{NODE_GROUP_ORDER.map((cat) => {
							const items = grouped.get(cat)
							if (!items?.length) return null
							const id = `library-group-${cat}`
							return (
								<GroupFlyout
									key={cat}
									id={id}
									label={NODE_GROUP_LABELS[cat] ?? cat}
									icon={groupIcon(cat, items[0].icon)}
									open={openGroup === id}
									ready={flyoutsReady}
									onOpenChange={(next) => onGroupOpen(id, next)}
								>
									{items.map((def) =>
										defItem(
											{ type: def.type, title: def.title, category: cat, def },
											() => closeGroup(id)
										)
									)}
								</GroupFlyout>
							)
						})}
					</div>
				</>
			) : (
				<>
					<div className="ImagePipelineSidebar-header">
						<span>Nodes</span>
						<UiIconButton
							icon={<IconSidebarCollapse />}
							title="Collapse (Shift+B)"
							onClick={() => $libraryRail.set(true)}
						/>
					</div>
					<div className="ImagePipelineSidebar-search">
						<UiTextInput
							value={query}
							onChange={setQuery}
							placeholder="Search nodes…"
							title="Search nodes"
							onKeyDown={onSearchKey}
						/>
					</div>
					<div className="ImagePipelineSidebar-list">
						{searching ? (
							customMatches.length === 0 && matches.length === 0 ? (
								<UiEmpty text="No nodes match." />
							) : (
								<>
									{customMatches.map((node) => (
										<MyNodeRow key={node.id} editor={editor} node={node} />
									))}
									{matches.map((row) => defItem(row))}
								</>
							)
						) : (
							<>
								<div className="ImagePipelineSidebar-group">
									<GroupHeader
										id="my"
										label="My nodes"
										closed={closed.includes('my')}
										onToggle={toggleGroup}
									/>
									{!closed.includes('my') &&
										(customNodes.length === 0 ? (
											<div className="ImagePipelineSidebar-empty">
												<UiEmpty
													icon={<IconGroup />}
													text="Select cards, right-click → “Group as box”, then “Save as my node”."
												/>
											</div>
										) : (
											customNodes.map((node) => <MyNodeRow key={node.id} editor={editor} node={node} />)
										))}
								</div>
								{NODE_GROUP_ORDER.map((cat) => {
									const items = grouped.get(cat)
									if (!items?.length) return null
									const isClosed = closed.includes(cat)
									return (
										<div key={cat} className="ImagePipelineSidebar-group">
											<GroupHeader
												id={cat}
												label={NODE_GROUP_LABELS[cat] ?? cat}
												closed={isClosed}
												onToggle={toggleGroup}
											/>
											{!isClosed &&
												items.map((def) =>
													defItem({ type: def.type, title: def.title, category: cat, def })
												)}
										</div>
									)
								})}
							</>
						)}
					</div>
				</>
			)}
		</div>
	)

	// The popover portals into this element, which carries the theme variables.
	// The sidebar sits outside <Tldraw />, so it has no container of its own.
	if (!flyoutRoot) return tree
	return <ContainerProvider container={flyoutRoot}>{tree}</ContainerProvider>
}
