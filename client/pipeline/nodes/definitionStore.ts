import { Editor, WeakCache } from 'tldraw'
import type { NodeDefinition, NodeDefinitionConstructor } from './types/shared'

/**
 * The leaf of the node-type dependency graph: holds the node definition classes and the
 * per-editor instance cache, with NO imports of any `types/*.tsx` file or of `registry.ts`.
 *
 * `registry.ts` is the only file that imports every `types/*.tsx` file (to build the class
 * map) and `registry.ts` hands that map to this module once, at module load, via
 * `setNodeDefinitionClasses`. Everything else — `nodeTypes.tsx`, `nodePorts.tsx`, `subgraph.ts`,
 * `execution/*`, individual node type files, etc. — looks up definitions through
 * `getNodeDefinition`/`getNodeDefinitions` here instead of through `registry.ts`. That keeps
 * those files out of the cycle `registry.ts -> types/*.tsx -> nodePorts.tsx -> nodeTypes.tsx ->
 * registry.ts`, which otherwise breaks Vite's hot reload with "Cannot access … before
 * initialization" whenever a single node type file is edited.
 */

type AnyConstructor = NodeDefinitionConstructor<any>

let definitionClasses: Record<string, AnyConstructor> | null = null

/** Called once by `registry.ts` at module load, with every node definition class (including removed ones). */
export function setNodeDefinitionClasses(classes: Record<string, AnyConstructor>) {
	definitionClasses = classes
}

const nodeDefinitionsCache = new WeakCache<Editor, Record<string, NodeDefinition<any>>>()

/** All node definitions, instantiated once per editor. */
export function getNodeDefinitions<N extends { type: string }>(
	editor: Editor
): Record<string, NodeDefinition<N>> {
	if (!definitionClasses) {
		throw new Error(
			'getNodeDefinitions called before registry.ts set the node definition classes — ' +
				'make sure registry.ts (imported by NodeShapeUtil.tsx) runs before any editor is created.'
		)
	}
	return nodeDefinitionsCache.get(editor, () => {
		const classes = definitionClasses!
		return Object.fromEntries(Object.values(classes).map((ctor) => [ctor.type, new ctor(editor)]))
	}) as Record<string, NodeDefinition<N>>
}

/** A single node definition, by node type id or by a node value with a `type` field. */
export function getNodeDefinition<N extends { type: string }>(
	editor: Editor,
	node: N | N['type']
): NodeDefinition<N> {
	return getNodeDefinitions<N>(editor)[typeof node === 'string' ? node : node.type]
}

/**
 * A node type's fields that the validator requires (not optional), with their default values.
 * `getDefault()` never touches the editor, so no editor is needed here. Cached per type.
 */
const requiredDefaultsCache = new Map<string, Record<string, unknown> | null>()

function requiredDefaults(type: string): Record<string, unknown> | null {
	if (requiredDefaultsCache.has(type)) return requiredDefaultsCache.get(type)!
	let result: Record<string, unknown> | null = null
	const ctor = definitionClasses?.[type]
	if (ctor) {
		try {
			const config = (ctor.validator as unknown as { config?: Record<string, { validate(v: unknown): unknown }> }).config
			const defaults = new ctor(null as unknown as Editor).getDefault() as Record<string, unknown>
			if (config) {
				result = {}
				for (const key of Object.keys(config)) {
					try {
						config[key].validate(undefined)
					} catch {
						if (key in defaults) result[key] = defaults[key]
					}
				}
			}
		} catch {
			result = null
		}
	}
	requiredDefaultsCache.set(type, result)
	return result
}

/**
 * A node saved by an older version can miss a field that is now required (e.g. a v0.2.0 Chart
 * has no `dualScale`), and tldraw then refuses the whole canvas. Fill only the missing
 * *required* fields from the type's defaults; optional fields stay absent, because "absent"
 * often keeps its own legacy meaning. Used by the node shape migration and by templates.
 */
export function withNodeDefaults<N extends { type: string }>(node: N): N {
	if (!node || typeof node !== 'object') return node
	const defaults = requiredDefaults(node.type)
	if (!defaults) return node
	let filled: Record<string, unknown> | null = null
	for (const key in defaults) {
		if ((node as Record<string, unknown>)[key] === undefined) {
			filled ??= { ...node }
			filled[key] = structuredClone(defaults[key])
		}
	}
	return (filled ?? node) as N
}
