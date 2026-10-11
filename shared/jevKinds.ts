/**
 * The three JEV decision kinds. Labels match the node's own dropdown text exactly
 * (client/pipeline/nodes/types/JevNode.tsx). The card search deep entries
 * ("JEV · Yes / no", …) are built from this list instead of a hand list.
 */
export const JEV_KINDS = [
	{ id: 'noul', label: 'Yes / no' },
	{ id: 'choice', label: 'Choose one option' },
	{ id: 'score', label: 'Score on a scale' },
] as const
