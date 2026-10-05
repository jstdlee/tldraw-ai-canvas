import { Editor, TLRecord, TLShapeId } from 'tldraw'

const MAX = 100
interface Op {
	t: number
	kind: 'add' | 'update' | 'delete'
	shapeId: string
	label: string
	record: TLRecord
}

let memory: Op[] = []
let guard = false

export function historyMemory() {
	return memory
}

export function watchHistory(editor: Editor) {
	return editor.store.listen(
		(entry) => {
			if (guard) return
			const changes = entry.changes
			const ops: Op[] = []
			for (const record of Object.values(changes.added)) {
				if (record.typeName !== 'shape') continue
				ops.push({ t: Date.now(), kind: 'add', shapeId: record.id, label: record.type, record })
			}
			for (const [, to] of Object.values(changes.updated)) {
				if (to.typeName !== 'shape') continue
				ops.push({ t: Date.now(), kind: 'update', shapeId: to.id, label: to.type, record: to })
			}
			for (const record of Object.values(changes.removed)) {
				if (record.typeName !== 'shape') continue
				ops.push({ t: Date.now(), kind: 'delete', shapeId: record.id, label: `${record.type} deleted`, record })
			}
			if (!ops.length) return
			memory = [...memory, ...ops]
			while (memory.length > MAX) {
				const old = memory.shift()
				if (old) {
					void fetch('/api/history', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(old),
					})
				}
			}
		},
		{ source: 'user', scope: 'document' }
	)
}

export function restoreOp(editor: Editor, record: TLRecord) {
	guard = true
	try {
		editor.store.put([record])
		if (record.typeName === 'shape') editor.select(record.id as TLShapeId)
	} finally {
		guard = false
	}
}

export async function searchDisk(query: string): Promise<Op[]> {
	const response = await fetch(`/api/history?q=${encodeURIComponent(query)}`)
	if (!response.ok) return []
	const payload = (await response.json()) as { ops?: Op[] }
	return payload.ops ?? []
}
