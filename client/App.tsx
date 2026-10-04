import { useCallback, useEffect, useMemo, useState } from 'react'
import {
	DefaultMainMenu,
	DefaultMainMenuContent,
	DefaultToolbar,
	DefaultToolbarContent,
	ToolbarItem,
	Editor,
	ErrorBoundary,
	TLComponents,
	TLShape,
	Tldraw,
	TldrawOptions,
	TldrawUiButton,
	TldrawUiButtonLabel,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	TldrawUiToastsProvider,
	TLUiOverrides,
	useEditor,
	useValue,
} from 'tldraw'
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import {
	$aiConfig,
	$aiConfigError,
	$providersDialogOpen,
	openProvidersDialog,
	refreshAIConfig,
} from './ai/aiConfig'
import { AIProvidersDialog } from './ai/AIProvidersDialog'
import { TldrawAgentApp } from './agent/TldrawAgentApp'
import {
	TldrawAgentAppContextProvider,
	TldrawAgentAppProvider,
} from './agent/TldrawAgentAppProvider'
import { ChatPanel } from './components/ChatPanel'
import { ChatPanelFallback } from './components/ChatPanelFallback'
import { CustomHelperButtons } from './components/CustomHelperButtons'
import { AgentHighlightOverlayUtil } from './overlays/AgentHighlightOverlayUtil'
import { ImagePipelineSidebar } from './pipeline/components/ImagePipelineSidebar'
import { OnCanvasNodePicker } from './pipeline/components/OnCanvasNodePicker'
import { PipelineRegions } from './pipeline/components/PipelineRegions'
import { TemplatePicker } from './pipeline/components/TemplatePicker'
import { overrides as pipelineOverrides } from './pipeline/components/PipelineToolbar'
import { ConnectionBindingUtil } from './pipeline/connection/ConnectionBindingUtil'
import { ConnectionCenterHandleOverlayUtil } from './pipeline/connection/ConnectionCenterHandleOverlayUtil'
import { ConnectionShapeUtil } from './pipeline/connection/ConnectionShapeUtil'
import { keepConnectionsAtBottom } from './pipeline/connection/keepConnectionsAtBottom'
import { disableTransparency } from './pipeline/disableTransparency'
import { NodeShapeUtil } from './pipeline/nodes/NodeShapeUtil'
import { PointingPort } from './pipeline/ports/PointingPort'
import { isPacked, watchPackedNodes } from './pipeline/subgraph'
import { TargetAreaTool } from './tools/TargetAreaTool'
import { TargetShapeTool } from './tools/TargetShapeTool'
import { canvasActionOverrides, CanvasContextMenu, CanvasToolsMenuGroup, MarkdownIcon, MermaidIcon } from './clips/CanvasMenus'
import { registerClipHandlers } from './clips/canvasFeatures'
import { clipShapeUtils, clipTools } from './clips/ClipShapes'
import { FindBar } from './clips/FindBar'
import { ImageEditorModal } from './clips/ImageEditor'
import { RatioImageShapeUtil } from './clips/shapeOptions'

// Every tldraw asset (fonts, icons, translations) is bundled, so the app works offline.
const assetUrls = getAssetUrlsByImport()

// Pipeline nodes + wires (image pipeline / branching chat kits)
// RatioImageShapeUtil replaces tldraw's image util (adds the keep-ratio switch).
const shapeUtils = [NodeShapeUtil, ConnectionShapeUtil, ...clipShapeUtils, RatioImageShapeUtil]
const bindingUtils = [ConnectionBindingUtil]
// Agent highlight overlay + "insert node" handle on wires
const overlayUtils = [ConnectionCenterHandleOverlayUtil, AgentHighlightOverlayUtil]
// Agent context pickers
const tools = [TargetShapeTool, TargetAreaTool, ...clipTools]

// Shapes packed into a group node stay in the document but are hidden.
// Must be a stable function: a new one each render would rebuild the editor.
const getShapeVisibility = (shape: TLShape) => (isPacked(shape) ? 'hidden' : 'inherit') as 'hidden' | 'inherit'

const options: Partial<TldrawOptions> = {
	actionShortcutsLocation: 'menu',
}

const PANEL_KEY = 'tldraw-ai-canvas:panels'

function loadPanels(): { library: boolean; chat: boolean } {
	// On a narrow window start with only the agent panel, so the canvas has room.
	const defaults = { library: window.innerWidth >= 1100, chat: true }
	try {
		return { ...defaults, ...JSON.parse(localStorage.getItem(PANEL_KEY) ?? '{}') }
	} catch {
		return defaults
	}
}

function App() {
	const [app, setApp] = useState<TldrawAgentApp | null>(null)
	const [editor, setEditor] = useState<Editor | null>(null)
	const [panels, setPanels] = useState(loadPanels)

	useEffect(() => {
		refreshAIConfig()
	}, [])

	useEffect(() => {
		try {
			localStorage.setItem(PANEL_KEY, JSON.stringify(panels))
		} catch {
			// Private mode: panel state just isn't remembered.
		}
	}, [panels])

	const togglePanel = useCallback(
		(panel: 'library' | 'chat') => setPanels((p) => ({ ...p, [panel]: !p[panel] })),
		[]
	)

	const handleUnmount = useCallback(() => setApp(null), [])

	// Dev only: lets scripts and tests drive the agent and the node library.
	useEffect(() => {
		if (!import.meta.env.DEV) return
		;(window as any).agentApp = app
		import('./pipeline/customNodes').then((m) => ((window as any).customNodes = m))
		import('./pipeline/subgraph').then((m) => ((window as any).subgraph = m))
	}, [app])

	const overrides: TLUiOverrides = useMemo(
		() => ({
			tools: (editor, tools, helpers) => {
				const withNodes = pipelineOverrides.tools!(editor, tools, helpers)
				return {
					...withNodes,
					'target-area': {
						id: 'target-area',
						label: 'Pick Area',
						kbd: 'c',
						icon: 'tool-frame',
						onSelect() {
							editor.setCurrentTool('target-area')
						},
					},
					markdown: {
						id: 'markdown',
						label: 'Markdown clip',
						icon: MarkdownIcon,
						kbd: '?m',
						onSelect() {
							editor.setCurrentTool('markdown')
						},
					},
					mermaid: {
						id: 'mermaid',
						label: 'Mermaid diagram',
						icon: MermaidIcon,
						kbd: '?g',
						onSelect() {
							editor.setCurrentTool('mermaid')
						},
					},
					'target-shape': {
						id: 'target-shape',
						label: 'Pick Shape',
						kbd: 's',
						icon: 'tool-frame',
						onSelect() {
							editor.setCurrentTool('target-shape')
						},
					},
				}
			},
			actions: (editor, actions, helpers) => ({
				...actions,
				...canvasActionOverrides(editor, helpers),
				'ai-providers': {
					id: 'ai-providers',
					label: 'AI providers…',
					icon: 'external-link',
					onSelect() {
						openProvidersDialog()
					},
				},
				'toggle-node-library': {
					id: 'toggle-node-library',
					label: 'Node library',
					kbd: 'shift+n',
					onSelect() {
						togglePanel('library')
					},
				},
				'toggle-agent-chat': {
					id: 'toggle-agent-chat',
					label: 'Agent chat',
					kbd: 'shift+a',
					onSelect() {
						togglePanel('chat')
					},
				},
			}),
		}),
		[togglePanel]
	)

	const components: TLComponents = useMemo(
		() => ({
			InFrontOfTheCanvas: () => (
				<>
					<OnCanvasNodePicker />
					<PipelineRegions />
					<FindBarHost />
					<SetupBanner />
				</>
			),
			MainMenu: () => (
				<DefaultMainMenu>
					<TldrawUiMenuGroup id="ai">
						<CanvasToolsMenuGroup />
						<TldrawUiMenuItem
							id="ai-providers"
							label="AI providers…"
							onSelect={() => openProvidersDialog()}
						/>
						<TldrawUiMenuItem
							id="toggle-node-library"
							label="Show/hide node library"
							kbd="shift+n"
							onSelect={() => togglePanel('library')}
						/>
						<TldrawUiMenuItem
							id="toggle-agent-chat"
							label="Show/hide agent chat"
							kbd="shift+a"
							onSelect={() => togglePanel('chat')}
						/>
					</TldrawUiMenuGroup>
					<DefaultMainMenuContent />
				</DefaultMainMenu>
			),
			// All default tldraw tools, plus the node-template picker.
			Toolbar: () => (
				<DefaultToolbar>
					<DefaultToolbarContent />
					<ToolbarItem tool="markdown" />
					<ToolbarItem tool="mermaid" />
					<TemplatePicker />
				</DefaultToolbar>
			),
			ContextMenu: CanvasContextMenu,
			SharePanel: () => <PanelToggles panels={panels} toggle={togglePanel} />,
			HelperButtons: () =>
				app && (
					<TldrawAgentAppContextProvider app={app}>
						<CustomHelperButtons />
					</TldrawAgentAppContextProvider>
				),
		}),
		[app, panels, togglePanel]
	)

	return (
		<TldrawUiToastsProvider>
			<div
				className={
					'app-layout' +
					(panels.library ? '' : ' is-library-hidden') +
					(panels.chat ? '' : ' is-chat-hidden')
				}
			>
				<div className="image-pipeline-sidebar">
					{editor ? <ImagePipelineSidebar editor={editor} /> : <div />}
				</div>
				<div className="app-canvas">
					<Tldraw
						persistenceKey="tldraw-ai-canvas"
						getShapeVisibility={getShapeVisibility}
						assetUrls={assetUrls}
						options={options}
						overrides={overrides}
						shapeUtils={shapeUtils}
						bindingUtils={bindingUtils}
						overlayUtils={overlayUtils}
						tools={tools}
						components={components}
						onMount={(editor) => {
							;(window as any).editor = editor
							setEditor(editor)
							const select = editor.getStateDescendant('select')!
							if (!select.children?.[PointingPort.id]) select.addChild(PointingPort)
							keepConnectionsAtBottom(editor)
							disableTransparency(editor, ['connection'])
							registerClipHandlers(editor)
							watchPackedNodes(editor)
						}}
					>
						<TldrawAgentAppProvider onMount={setApp} onUnmount={handleUnmount} />
					</Tldraw>
				</div>
				<ProvidersModal editor={editor} />
				<ImageEditorModal editor={editor} />
				<div className="chat-panel-wrapper">
					<ErrorBoundary fallback={ChatPanelFallback}>
						{app && (
							<TldrawAgentAppContextProvider app={app}>
								<ChatPanel />
							</TldrawAgentAppContextProvider>
						)}
					</ErrorBoundary>
				</div>
			</div>
		</TldrawUiToastsProvider>
	)
}

function FindBarHost() {
	const editor = useEditor()
	return <FindBar editor={editor} />
}

/** The AI providers dialog, over the whole window (not just the canvas column). */
function ProvidersModal({ editor }: { editor: Editor | null }) {
	const open = useValue('providers dialog open', () => $providersDialogOpen.get(), [])
	const isDark = useValue('dark mode', () => editor?.user.getIsDarkMode() ?? false, [editor])
	const close = useCallback(() => $providersDialogOpen.set(false), [])
	if (!open) return null
	return (
		<div
			className={`ai-modal-backdrop tl-container ${isDark ? 'tl-theme__dark' : 'tl-theme__light'}`}
			onPointerDown={(e) => e.target === e.currentTarget && close()}
		>
			<AIProvidersDialog onClose={close} />
		</div>
	)
}

/** Shown until at least one model is set up, or when the server is down. */
function SetupBanner() {
	const editor = useEditor()
	const config = useValue('ai config', () => $aiConfig.get(), [])
	const error = useValue('ai config error', () => $aiConfigError.get(), [])
	const isReadonly = useValue('readonly', () => editor.getIsReadonly(), [editor])
	const [dismissed, setDismissed] = useState(false)
	if (dismissed || isReadonly) return null
	if (error) {
		return (
			<div className="app-banner">
				<span>{error}. Start it with “npm run dev”.</span>
				<TldrawUiButton type="normal" onClick={() => refreshAIConfig()}>
					<TldrawUiButtonLabel>Retry</TldrawUiButtonLabel>
				</TldrawUiButton>
			</div>
		)
	}
	if (!config || config.models.length > 0) return null
	return (
		<div className="app-banner">
			<span>No AI models yet. Drawing works now; add a provider for AI features.</span>
			<TldrawUiButton type="primary" onClick={() => openProvidersDialog()}>
				<TldrawUiButtonLabel>Set up AI providers</TldrawUiButtonLabel>
			</TldrawUiButton>
			<TldrawUiButton type="icon" title="Hide" onClick={() => setDismissed(true)}>
				<TldrawUiButtonLabel>×</TldrawUiButtonLabel>
			</TldrawUiButton>
		</div>
	)
}

function PanelToggles({
	panels,
	toggle,
}: {
	panels: { library: boolean; chat: boolean }
	toggle(panel: 'library' | 'chat'): void
}) {
	return (
		<div className="app-panel-toggles tlui-style-panel__wrapper">
			<TldrawUiButton
				type="normal"
				isActive={panels.library}
				title="Show/hide node library (Shift+N)"
				onClick={() => toggle('library')}
			>
				<TldrawUiButtonLabel>Nodes</TldrawUiButtonLabel>
			</TldrawUiButton>
			<TldrawUiButton
				type="normal"
				isActive={panels.chat}
				title="Show/hide agent chat (Shift+A)"
				onClick={() => toggle('chat')}
			>
				<TldrawUiButtonLabel>Agent</TldrawUiButtonLabel>
			</TldrawUiButton>
		</div>
	)
}

export default App
