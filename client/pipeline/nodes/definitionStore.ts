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
