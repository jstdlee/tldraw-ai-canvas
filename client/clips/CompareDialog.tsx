import { Fragment, useEffect, useMemo, useState } from 'react'
import { Editor, TLShape, useValue } from 'tldraw'
import { Cell, changeRanges, diffStats, DiffLang, guessLang, lineRows, lineTokens, markSegments, Row } from '../../shared/textDiff'
import type { Notify } from './canvasFeatures'
import { ClipModal } from './ClipModal'
import { $compare, compareLangHint, compareText, keepVariant, selectedVariant } from './rewrite'
import './compare.css'

type Mode = 'split' | 'unified'
type Tokens = { kind: string; text: string }[][]

const MODE_KEY = 'ai-canvas.compare.mode'
const LANGS: { id: 'auto' | DiffLang; label: string }[] = [
	{ id: 'auto', label: 'Auto' },
	{ id: 'text', label: 'Text' },
	{ id: 'ts', label: 'TypeScript' },
	{ id: 'js', label: 'JavaScript' },
	{ id: 'py', label: 'Python' },
	{ id: 'sql', label: 'SQL' },
	{ id: 'json', label: 'JSON' },
]

function shapeLabel(editor: Editor, shape: TLShape) {
	const node = shape.type === 'node' ? (shape.props as { node?: { title?: string; type?: string } }).node : undefined
	if (node) return node.title || node.type || 'Card'
	const first = compareText(editor, shape).trim().split('\n')[0]
	return first.length > 40 ? first.slice(0, 40) + '…' : first || shape.type
}

/** Mount once: shows the diff of the two shapes in $compare. */
export function CompareModal({ editor, notify }: { editor: Editor; notify: Notify }) {
	const target = useValue('compare', () => $compare.get(), [])
	if (!target) return null
	return <CompareDialog key={target.left + target.right} editor={editor} notify={notify} target={target} />
}

function CompareDialog({ editor, notify, target }: { editor: Editor; notify: Notify; target: NonNullable<ReturnType<typeof $compare.get>> }) {
	const [mode, setModeState] = useState<Mode>(() => {
		try {
			return localStorage.getItem(MODE_KEY) === 'unified' ? 'unified' : 'split'
		} catch {
			return 'split'
		}
	})
	const [swap, setSwap] = useState(false)
	const [all, setAll] = useState(false)
	const [langPick, setLangPick] = useState<'auto' | DiffLang>('auto')
	const [openGaps, setOpenGaps] = useState<Set<number>>(new Set())
	const close = () => $compare.set(null)

	// Live: edits to either shape update the diff while the dialog is open.
	const data = useValue(
		'compare data',
		() => {
			const l = editor.getShape(target.left)
			const r = editor.getShape(target.right)
			if (!l || !r) return null
			const left = { text: compareText(editor, l), label: shapeLabel(editor, l) }
			const right = { text: compareText(editor, r), label: shapeLabel(editor, r) }
			return { left, right, hint: compareLangHint(r) ?? compareLangHint(l) }
		},
		[editor, target]
	)
	useEffect(() => {
		if (!data) close()
	}, [data])

	const [a, b] = data ? (swap ? [data.right, data.left] : [data.left, data.right]) : [null, null]
	const lang: DiffLang = langPick !== 'auto' ? langPick : guessLang(b?.text ?? '', data?.hint)
	const rows = useMemo(() => (a && b ? lineRows(a.text, b.text, all) : []), [a?.text, b?.text, all])
	const lTok = useMemo(() => lineTokens(a?.text ?? '', lang), [a?.text, lang])
	const rTok = useMemo(() => lineTokens(b?.text ?? '', lang), [b?.text, lang])
	if (!data || !a || !b) return null

	const stats = diffStats(rows)
	const same = stats.added === 0 && stats.removed === 0
	const setMode = (m: Mode) => {
		setModeState(m)
		try {
			localStorage.setItem(MODE_KEY, m)
		} catch {}
	}
	const keep = () => {
		editor.select(target.right)
		if (selectedVariant(editor)) keepVariant(editor, notify)
		close()
	}
	const tags = target.variant ? (swap ? ['Variant', 'Original'] : ['Original', 'Variant']) : ['Left', 'Right']

	// Rows with open gaps expanded in place.
	const shown: (Row | { kind: 'gap'; hidden: Row[]; index: number })[] = []
	rows.forEach((row, index) => {
		if (row.kind === 'gap' && openGaps.has(index)) shown.push(...row.hidden)
		else shown.push(row.kind === 'gap' ? { ...row, index } : row)
	})

	return (
		<ClipModal editor={editor} label="Compare" className="cmp-dialog" onClose={close}>
			<div className="cmp-toolbar">
				<div className="cmp-seg" role="group" aria-label="View">
					<button className={'ai-button' + (mode === 'split' ? ' is-on' : '')} onClick={() => setMode('split')}>
						Split
					</button>
					<button className={'ai-button' + (mode === 'unified' ? ' is-on' : '')} onClick={() => setMode('unified')}>
						Unified
					</button>
				</div>
				<label className="cmp-field">
					Syntax
					<select value={langPick} onChange={(e) => setLangPick(e.target.value as 'auto' | DiffLang)}>
						{LANGS.map((l) => (
							<option key={l.id} value={l.id}>
								{l.id === 'auto' ? `Auto (${LANGS.find((x) => x.id === lang)?.label})` : l.label}
							</option>
						))}
					</select>
				</label>
				<label className="cmp-field">
					<input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
					All lines
				</label>
				<button className="ai-button" onClick={() => setSwap((s) => !s)} title="Swap left and right">
					⇄ Swap
				</button>
				<span className="ai-spacer" />
				<span className="cmp-stats">
					<span className="cmp-plus">+{stats.added}</span> <span className="cmp-minus">−{stats.removed}</span>
				</span>
			</div>

			<div className={`cmp-body ${lang === 'text' ? 'is-prose' : 'is-code'}`}>
				{mode === 'split' ? (
					<div className="cmp-grid cmp-split">
						<div className="cmp-head" title={a.label}>
							<b>{tags[0]}</b> {a.label}
						</div>
						<div className="cmp-head" title={b.label}>
							<b>{tags[1]}</b> {b.label}
						</div>
						{shown.map((row, i) =>
							row.kind === 'gap' ? (
								<GapRow key={i} count={row.hidden.length} onOpen={() => setOpenGaps(new Set(openGaps).add((row as { index: number }).index))} />
							) : (
								<SplitRow key={i} row={row} lTok={lTok} rTok={rTok} />
							)
						)}
					</div>
				) : (
					<div className="cmp-grid cmp-unified">
						<div className="cmp-head">
							<span className="cmp-minus">---</span> <b>{tags[0]}</b> {a.label}
							<br />
							<span className="cmp-plus">+++</span> <b>{tags[1]}</b> {b.label}
						</div>
						{shown.map((row, i) =>
							row.kind === 'gap' ? (
								<GapRow key={i} count={row.hidden.length} onOpen={() => setOpenGaps(new Set(openGaps).add((row as { index: number }).index))} />
							) : (
								<UnifiedRows key={i} row={row} lTok={lTok} rTok={rTok} />
							)
						)}
					</div>
				)}
				{same && <div className="cmp-same">The two texts are the same.</div>}
			</div>

			<div className="ai-dialog__footer">
				<span className="ai-muted">Edits on the canvas update this view.</span>
				<span className="ai-spacer" />
				<button className="ai-button" onClick={close}>
					Close
				</button>
				{target.variant && (
					<button className="ai-button is-primary" onClick={keep} title="Copy the variant into the original and remove the other variants">
						Use the variant
					</button>
				)}
			</div>
		</ClipModal>
	)
}

function GapRow({ count, onOpen }: { count: number; onOpen: () => void }) {
	return (
		<button className="cmp-gap" onClick={onOpen}>
			⋯ Show {count} unchanged line{count === 1 ? '' : 's'}
		</button>
	)
}

function Code({ cell, toks, ranges = [] }: { cell?: Cell; toks: Tokens; ranges?: [number, number][] }) {
	if (!cell) return null
	return (
		<>
			{markSegments(toks[cell.n - 1] ?? [], ranges).map((s, i) => (
				<span key={i} className={`tok-${s.kind}${s.mark ? ' cmp-mark' : ''}`}>
					{s.text}
				</span>
			))}
			{cell.text === '' && ' '}
		</>
	)
}

type DiffRow = Exclude<Row, { kind: 'gap' }>

function SplitRow({ row, lTok, rTok }: { row: DiffRow; lTok: Tokens; rTok: Tokens }) {
	const ranges = row.kind === 'change' ? changeRanges(row.left!.text, row.right!.text) : null
	const side = (cell: Cell | undefined, kind: 'del' | 'add') => (!cell ? 'is-empty' : row.kind === 'same' ? '' : `is-${kind}`)
	return (
		<>
			<div className={`cmp-num ${side(row.left, 'del')}`}>{row.left?.n}</div>
			<div className={`cmp-code ${side(row.left, 'del')}`}>
				<Code cell={row.left} toks={lTok} ranges={ranges?.left} />
			</div>
			<div className={`cmp-num cmp-rside ${side(row.right, 'add')}`}>{row.right?.n}</div>
			<div className={`cmp-code ${side(row.right, 'add')}`}>
				<Code cell={row.right} toks={rTok} ranges={ranges?.right} />
			</div>
		</>
	)
}

function UnifiedRows({ row, lTok, rTok }: { row: DiffRow; lTok: Tokens; rTok: Tokens }) {
	if (row.kind === 'same') {
		return (
			<>
				<div className="cmp-num">{row.left!.n}</div>
				<div className="cmp-num">{row.right!.n}</div>
				<div className="cmp-sign" />
				<div className="cmp-code">
					<Code cell={row.left} toks={lTok} />
				</div>
			</>
		)
	}
	const ranges = row.kind === 'change' ? changeRanges(row.left!.text, row.right!.text) : null
	return (
		<Fragment>
			{row.left && (
				<>
					<div className="cmp-num is-del">{row.left.n}</div>
					<div className="cmp-num is-del" />
					<div className="cmp-sign is-del">−</div>
					<div className="cmp-code is-del">
						<Code cell={row.left} toks={lTok} ranges={ranges?.left} />
					</div>
				</>
			)}
			{row.right && (
				<>
					<div className="cmp-num is-add" />
					<div className="cmp-num is-add">{row.right.n}</div>
					<div className="cmp-sign is-add">+</div>
					<div className="cmp-code is-add">
						<Code cell={row.right} toks={rTok} ranges={ranges?.right} />
					</div>
				</>
			)}
		</Fragment>
	)
}
