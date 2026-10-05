import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ContentKind, detectContentKind } from '../../shared/contentKind'
import { renderMermaid } from '../clips/ClipShapes'
import { FieldMax, ImageZoom, LargeEditor } from './editors/LargeEditor'

const stop = (e: React.SyntheticEvent) => e.stopPropagation()

/** Shows any node value: text, image, Markdown, Mermaid, JSON or a link card. */
export function ValuePreview({ value, kind = 'auto' }: { value: string; kind?: ContentKind | 'auto' }) {
	const k = kind === 'auto' ? detectContentKind(value) : kind
	const [open, setOpen] = useState(false)
	const title = k === 'image' ? 'Image' : k === 'mermaid' ? 'Mermaid' : k === 'json' ? 'JSON' : k === 'markdown' ? 'Markdown' : 'Output'
	return (
		<div className={`ValuePreview ValuePreview_${k}`} onPointerDown={stop} onWheel={stop}>
			<FieldMax title={`Open ${title}`} onClick={() => setOpen(true)} />
			{open && k === 'image' && <ImageZoom src={value.trim()} onClose={() => setOpen(false)} />}
			{open && k !== 'image' && (
				<LargeEditor title={title} value={k === 'json' ? prettyJson(value) : value} lang={k === 'json' ? 'json' : 'text'} readOnly onChange={() => {}} onClose={() => setOpen(false)} />
			)}
			{k === 'image' && <img className="ValuePreview-image" src={value.trim()} alt="" draggable={false} />}
			{k === 'url' && <LinkPreview url={value.trim()} />}
			{k === 'mermaid' && <MermaidPreview code={value} />}
			{k === 'markdown' && (
				<div className="ValuePreview-markdown clip-markdown">
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}
					>
						{value}
					</ReactMarkdown>
				</div>
			)}
			{k === 'json' && <pre className="ValuePreview-text is-mono">{prettyJson(value)}</pre>}
			{k === 'text' && <pre className="ValuePreview-text">{value}</pre>}
		</div>
	)
}

function prettyJson(v: string) {
	try {
		return JSON.stringify(JSON.parse(v), null, 2)
	} catch {
		return v
	}
}

function MermaidPreview({ code }: { code: string }) {
	const [svg, setSvg] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	useEffect(() => {
		let cancelled = false
		renderMermaid(code.replace(/^```mermaid\s*|```\s*$/g, ''))
			.then((s) => !cancelled && setSvg(s))
			.catch((e) => !cancelled && setError(String(e?.message ?? e).split('\n')[0]))
		return () => {
			cancelled = true
		}
	}, [code])
	if (error) return <pre className="ValuePreview-text clip-error">{error}</pre>
	return svg ? <div className="ValuePreview-mermaid" dangerouslySetInnerHTML={{ __html: svg }} /> : null
}

const unfurlCache = new Map<string, Promise<{ title: string; description: string; image: string; favicon: string }>>()

function LinkPreview({ url }: { url: string }) {
	const [meta, setMeta] = useState<{ title: string; description: string; image: string; favicon: string } | null>(null)
	useEffect(() => {
		let cancelled = false
		if (!unfurlCache.has(url)) {
			unfurlCache.set(
				url,
				fetch(`/api/unfurl?url=${encodeURIComponent(url)}`).then((r) => (r.ok ? r.json() : Promise.reject()))
			)
		}
		unfurlCache
			.get(url)!
			.then((m) => !cancelled && setMeta(m))
			.catch(() => !cancelled && setMeta({ title: url, description: '', image: '', favicon: '' }))
		return () => {
			cancelled = true
		}
	}, [url])
	return (
		<a className="ValuePreview-link" href={url} target="_blank" rel="noreferrer" title="Open link">
			{meta?.image && <img src={meta.image} alt="" draggable={false} />}
			<span className="ValuePreview-link-body">
				<span className="ValuePreview-link-title">
					{meta?.favicon && <img src={meta.favicon} alt="" width={14} height={14} />}
					{meta?.title || url}
				</span>
				{meta?.description && <span className="ValuePreview-link-desc">{meta.description}</span>}
				<span className="ValuePreview-link-url">↗ {new URL(url).hostname}</span>
			</span>
		</a>
	)
}
