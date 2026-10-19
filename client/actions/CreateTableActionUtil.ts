import { TLShapeId } from 'tldraw'
import { CreateTableAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { makeColumn, makeRow, withTableDefaults, type TableData } from '../../shared/table/canvasTableOps'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

/** WP40: lets the canvas agent build a table from a prompt ("make a PR list table with these 5
 * PRs") — columns are names, rows are parallel arrays of cell text. See
 * tests/agentCreateTableAction.test.ts for the schema/sanitize coverage. */
export const CreateTableActionUtil = registerActionUtil(
	class CreateTableActionUtil extends AgentActionUtil<CreateTableAction> {
		static override type = 'create-table' as const

		override getInfo(action: Streaming<CreateTableAction>) {
			return {
				icon: 'note' as const,
				description: action.intent ?? '',
			}
		}

		override sanitizeAction(action: Streaming<CreateTableAction>, helpers: AgentHelpers) {
			if (!action.columns) return action
			action.shapeId = helpers.ensureShapeIdIsUnique(action.shapeId)
			action.x = helpers.ensureValueIsNumber(action.x) ?? 0
			action.y = helpers.ensureValueIsNumber(action.y) ?? 0
			action.columns = (action.columns ?? []).filter((c): c is string => typeof c === 'string')
			action.rows = (action.rows ?? []).filter((r): r is string[] => Array.isArray(r))
			return action
		}

		override applyAction(action: Streaming<CreateTableAction>, helpers: AgentHelpers) {
			if (!action.complete) return
			if (!action.shapeId || !action.columns?.length) return
			const shapeId = `shape:${action.shapeId}` as TLShapeId

			const columns = action.columns.map((name) => makeColumn({ name: name || 'Column' }))
			const rows = (action.rows ?? []).map((cells) =>
				makeRow(columns, { cells: Object.fromEntries(columns.map((c, i) => [c.id, cells[i] ?? ''])) })
			)
			const table: TableData = withTableDefaults({ columns, rows, headerRow: true })

			const point = helpers.removeOffsetFromVec({ x: action.x ?? 0, y: action.y ?? 0 })

			this.editor.createShape({
				id: shapeId,
				type: 'table',
				x: point.x,
				y: point.y,
				props: { table, color: 'black', size: 'm', dash: 'solid' },
			})
		}
	}
)
