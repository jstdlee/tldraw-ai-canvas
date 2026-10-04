import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigError, DATA_DIR } from './config'

/** Saved custom nodes (packed groups with a name), one JSON file each. */
export const CUSTOM_NODE_DIR = join(DATA_DIR, 'custom-nodes')

export interface CustomNodeFile {
	id: string
	name: string
	description: string
	savedAt: string
	/** The packed group: inner shapes, their bindings and the outer ports. */
	template: unknown
}

function slug(name: string) {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 60) || 'node'
	)
}

export function listCustomNodes(): Omit<CustomNodeFile, 'template'>[] {
	if (!existsSync(CUSTOM_NODE_DIR)) return []
	return readdirSync(CUSTOM_NODE_DIR)
		.filter((f) => f.endsWith('.json'))
		.map((f) => {
			try {
				const { template: _t, ...meta } = JSON.parse(readFileSync(join(CUSTOM_NODE_DIR, f), 'utf8')) as CustomNodeFile
				return meta
			} catch {
				return null
			}
		})
		.filter((x): x is Omit<CustomNodeFile, 'template'> => !!x)
		.sort((a, b) => a.name.localeCompare(b.name))
}

export function readCustomNode(id: string): CustomNodeFile {
	if (!/^[a-z0-9-]{1,80}$/.test(id)) throw new ConfigError('Bad node id')
	const path = join(CUSTOM_NODE_DIR, `${id}.json`)
	if (!existsSync(path)) throw new ConfigError(`No saved node "${id}"`)
	return JSON.parse(readFileSync(path, 'utf8'))
}

export function saveCustomNode(input: { name: string; description?: string; template: unknown }): CustomNodeFile {
	const name = (input.name ?? '').trim()
	if (!name) throw new ConfigError('Give the node a name')
	if (!input.template || typeof input.template !== 'object') throw new ConfigError('Missing node template')
	mkdirSync(CUSTOM_NODE_DIR, { recursive: true })
	const file: CustomNodeFile = {
		id: slug(name),
		name,
		description: input.description ?? '',
		savedAt: new Date().toISOString(),
		template: input.template,
	}
	writeFileSync(join(CUSTOM_NODE_DIR, `${file.id}.json`), JSON.stringify(file, null, '\t'))
	return file
}

export function deleteCustomNode(id: string) {
	if (!/^[a-z0-9-]{1,80}$/.test(id)) throw new ConfigError('Bad node id')
	rmSync(join(CUSTOM_NODE_DIR, `${id}.json`), { force: true })
}
