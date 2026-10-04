import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
	BaseBoxShapeTool,
	BaseBoxShapeUtil,
	Editor,
	HTMLContainer,
	RecordProps,
	T,
	TLShape,
	useEditor,
	useIsEditing,
	useValue,
} from 'tldraw'

/**
 * "Clips": rich cards that live on the canvas next to drawings.
 *  - markdown: rendered Markdown (GFM tables, clickable checklists, links open in a new tab)
 *  - mermaid:  a Mermaid diagram rendered locally (no internet needed)
 * Double-click a clip to edit its source; click outside to finish.
 */

const MARKDOWN = 'markdown' as const
const MERMAID = 'mermaid' as const

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[MARKDOWN]: { w: number; h: number; md: string }
		[MERMAID]: { w: number; h: number; code: string }
	}
}

export type MarkdownShape = TLShape<typeof MARKDOWN>
export type MermaidShape = TLShape<typeof MERMAID>

import { toggleTask } from '../../shared/clipText'

const stop = (e: React.SyntheticEvent) => e.stopPropagation()

function ClipEditor({
	editor,
	value,
	onChange,
	placeholder,
	mono,
}: {
	editor: Editor
	value: string
	onChange(value: string): void
	placeholder: string
	mono?: boolean
}) {
	const ref = useRef<HTMLTextAreaElement>(null)
	useEffect(() => {
		ref.current?.focus()
	}, [])
	return (
		<textarea
			ref={ref}
			className={'clip-editor' + (mono ? ' is-mono' : '')}
			value={value}
			placeholder={placeholder}
			spellCheck={!mono}
			onPointerDown={stop}
			onWheel={stop}
			onKeyDown={(e) => {
				e.stopPropagation()
				if (e.key === 'Escape') editor.complete()
			}}
			onChange={(e) => onChange(e.target.value)}
		/>
	)
}

// --- Markdown ----------------------------------------------------------------

export class MarkdownShapeUtil extends BaseBoxShapeUtil<MarkdownShape> {
	static override type = MARKDOWN
	static override props: RecordProps<MarkdownShape> = { w: T.number, h: T.number, md: T.string }

	getDefaultProps(): MarkdownShape['props'] {
		return {
			w: 360,
			h: 260,
			md: '# Note\n\nDouble-click to edit.\n\n- [ ] a task\n- [x] a done task\n\n| A | B |\n|---|---|\n| 1 | 2 |',
		}
	}
	override canEdit() {
		return true
	}
	override canScroll() {
		return true
	}

	component(shape: MarkdownShape) {
		return <MarkdownClip shape={shape} />
	}

	getIndicatorPath(shape: MarkdownShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}

	override toSvg(shape: MarkdownShape) {
		// Export as a simple card with the plain text (rich HTML can't go into SVG).
		const lines = shape.props.md.split('\n').slice(0, 40)
		return (
			<g>
				<rect width={shape.props.w} height={shape.props.h} rx={8} fill="white" stroke="#ccc" />
				<text x={12} y={22} fontSize={13} fontFamily="Inter, sans-serif" fill="#222">
					{lines.map((l, i) => (
						<tspan key={i} x={12} dy={i === 0 ? 0 : 17}>
							{l}
						</tspan>
					))}
				</text>
			</g>
		)
	}
}

function MarkdownClip({ shape }: { shape: MarkdownShape }) {
	const editor = useEditor()
	const isEditing = useIsEditing(shape.id)
	const update = (md: string) => editor.updateShape<MarkdownShape>({ id: shape.id, type: MARKDOWN, props: { md } })
	let taskIndex = -1

	return (
		<HTMLContainer className={'clip clip-markdown' + (isEditing ? ' is-editing' : '')}>
			{isEditing ? (
				<ClipEditor editor={editor} value={shape.props.md} onChange={update} placeholder="Markdown…" />
			) : (
				<div className="clip-scroll" onWheel={(e) => e.currentTarget.scrollHeight > e.currentTarget.clientHeight && stop(e)}>
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						components={{
							a: ({ href, children }) => (
								<a href={href} target="_blank" rel="noreferrer" onPointerDown={stop}>
									{children}
								</a>
							),
							input: ({ checked, type }) => {
								if (type !== 'checkbox') return <input type={type} />
								const index = ++taskIndex
								return (
									<input
										type="checkbox"
										checked={!!checked}
										onPointerDown={stop}
										onChange={() => update(toggleTask(shape.props.md, index))}
									/>
								)
							},
						}}
					>
						{shape.props.md}
					</ReactMarkdown>
				</div>
			)}
		</HTMLContainer>
	)
}

export class MarkdownTool extends BaseBoxShapeTool {
	static override id = MARKDOWN
	static override initial = 'idle'
	override shapeType = MARKDOWN as typeof MARKDOWN
}

// --- Mermaid -----------------------------------------------------------------

let mermaidReady: Promise<typeof import('mermaid').default> | null = null
let renderCount = 0

function getMermaid(dark: boolean) {
	mermaidReady ??= import('mermaid').then((m) => m.default)
	return mermaidReady.then((mermaid) => {
		mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' })
		return mermaid
	})
}

export async function renderMermaid(code: string, dark = false): Promise<string> {
	const mermaid = await getMermaid(dark)
	const { svg } = await mermaid.render(`mermaid-clip-${++renderCount}`, code)
	return svg
}

export class MermaidShapeUtil extends BaseBoxShapeUtil<MermaidShape> {
	static override type = MERMAID
	static override props: RecordProps<MermaidShape> = { w: T.number, h: T.number, code: T.string }

	getDefaultProps(): MermaidShape['props'] {
		return {
			w: 420,
			h: 300,
			code: 'flowchart LR\n  Idea --> Sketch --> Workflow\n  Workflow -->|run| Result\n  Result -.->|feedback| Idea',
		}
	}
	override canEdit() {
		return true
	}

	component(shape: MermaidShape) {
		return <MermaidClip shape={shape} />
	}

	getIndicatorPath(shape: MermaidShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}

	override async toSvg(shape: MermaidShape) {
		try {
			const svg = await renderMermaid(shape.props.code)
			const href = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
			return <image href={href} width={shape.props.w} height={shape.props.h} preserveAspectRatio="xMidYMid meet" />
		} catch {
			return <rect width={shape.props.w} height={shape.props.h} fill="#fee" />
		}
	}
}

function MermaidClip({ shape }: { shape: MermaidShape }) {
	const editor = useEditor()
	const isEditing = useIsEditing(shape.id)
	const dark = useValue('dark', () => editor.user.getIsDarkMode(), [editor])
	const [svg, setSvg] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const code = useMemo(() => shape.props.code.replace(/^```mermaid\s*|```\s*$/g, ''), [shape.props.code])

	useEffect(() => {
		let cancelled = false
		const t = setTimeout(() => {
			renderMermaid(code, dark)
				.then((s) => !cancelled && (setSvg(s), setError(null)))
				.catch((e) => !cancelled && setError(String(e?.message ?? e).split('\n').slice(0, 3).join('\n')))
		}, 250)
		return () => {
			cancelled = true
			clearTimeout(t)
		}
	}, [code, dark])

	return (
		<HTMLContainer className={'clip clip-mermaid' + (isEditing ? ' is-editing' : '')}>
			{isEditing && (
				<ClipEditor
					editor={editor}
					mono
					value={shape.props.code}
					placeholder="flowchart LR&#10;  A --> B"
					onChange={(code) => editor.updateShape<MermaidShape>({ id: shape.id, type: MERMAID, props: { code } })}
				/>
			)}
			<div className="clip-mermaid-view">
				{error ? (
					<pre className="clip-error">{error}</pre>
				) : svg ? (
					<div className="clip-mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
				) : (
					<span className="clip-muted">Rendering…</span>
				)}
			</div>
		</HTMLContainer>
	)
}

export class MermaidTool extends BaseBoxShapeTool {
	static override id = MERMAID
	static override initial = 'idle'
	override shapeType = MERMAID as typeof MERMAID
}

export const clipShapeUtils = [MarkdownShapeUtil, MermaidShapeUtil]
export const clipTools = [MarkdownTool, MermaidTool]
