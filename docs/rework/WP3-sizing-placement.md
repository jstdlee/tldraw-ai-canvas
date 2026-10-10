# WP3 — Default size of new nodes, and where they appear

Feedback item: #8 (new components are often crowded). Read `RULES.md` first. WP1 and WP2 are done.

## Today

- `client/pipeline/constants.tsx`: `NODE_WIDTH_PX = 260`, header 40, footer 40, row 44,
  `DEFAULT_NODE_SPACING_PX = 60`. The node font is 20 px (`client/pipeline/index.css` ~L42,
  `DEFAULT_NODE_FONT_PX` in `NodeShapeUtil.tsx`). 20 px text in a 260 px card is crowded.
- Each `NodeDefinition` has `getWidthPx()` (default 260) and `getBodyHeightPx()`. Many
  `getBodyHeightPx()` values are smaller than what the `Component` actually renders, so rows
  overlap or the result area is squeezed.
- The CSS repeats 40/44 px as literals.
- Placement: sidebar click → viewport centre with **no overlap check**
  (`ImagePipelineSidebar.tsx` `createNodeAtCenter`); port drag → `bounds.right + 60`
  (`client/pipeline/ports/PointingPort.tsx` ~L103); `insertNodeWithinConnection`; AI plans place
  at viewport centre + x/y (`client/pipeline/assist.ts` `applyPlan`).

## Part A — Size contract per node type

1. Add an optional static-like size hint on `NodeDefinition` (`client/pipeline/nodes/types/shared.tsx`):
   `readonly defaultWidthPx?: number`. `getWidthPx` default returns `this.defaultWidthPx ?? NODE_WIDTH_PX`.
2. Raise `NODE_WIDTH_PX` to **320**.
3. Set `defaultWidthPx` by kind:
   - simple value nodes (number, random, toggle-like inputs): 280
   - text editing / prompt / AI text / chat / summarize / code / JSON / HTTP / web: 380
   - data (Table/DataPipe, Chart, Postgres, Database): 440
   - image nodes: keep their current special widths if larger than 320, else 320
   - subgraph: leave as is (WP4 changes it)
   A node with a user-set `props.w` keeps it (saved canvases must not change size).
4. **Audit every node type** in `client/pipeline/nodes/types/*.tsx`: count the rows/areas its
   `Component` renders in the default state and make `getBodyHeightPx` equal
   `rows × NODE_ROW_HEIGHT_PX + result area`. Result/preview areas: at least 4 rows of text
   (~120 px) for text-producing nodes; 168 px for image previews; 200 px for table previews.
   When a field is shown conditionally (e.g. only for one mode), height must follow the same
   condition (the function receives `node`).
   Write the audit as a table in your final report (type, rows before → after, width before → after).
5. Replace literal `40px`/`44px` in `client/pipeline/index.css` and `client/shell/shell.css` for
   node header/footer/row with CSS variables set once on `.NodeShape`:
   `--node-header-h`, `--node-footer-h`, `--node-row-h` (values from `constants.tsx`).
6. Long values never push layout: labels ellipsis, text areas scroll inside (check `.NodeRow`,
   `.NodeField-*`).

## Part B — Free-spot placement

Create `shared/placement.ts` (pure, no tldraw import):

```ts
export interface Box { x: number; y: number; w: number; h: number }
/** First free spot for a box of size w×h near `want`, avoiding `taken` with `gap` margin.
 *  Search order: want itself, then a spiral of candidate positions on a grid of step (w+gap)/2
 *  and (h+gap)/2, up to `maxRings` rings (default 12). Returns the closest free candidate. */
export function findFreeSpot(want: {x:number;y:number}, size: {w:number;h:number}, taken: Box[], gap?: number, maxRings?: number): {x:number;y:number}
/** Place to the right of `anchor`: try anchor.right+gap at the anchor's y, then step down. */
export function placeRightOf(anchor: Box, size: {w:number;h:number}, taken: Box[], gap?: number): {x:number;y:number}
```

Default `gap` = 48. Add `client/pipeline/placeNode.ts` with
`createNodeAt(editor, node, opts: { near?: Vec | 'viewport'; rightOf?: TLShapeId; select?: boolean })`:
creates the shape, reads its real bounds, collects page bounds of all other visible shapes on the
current page (skip `connection` shapes and hidden/packed shapes), uses the helpers above, moves it,
selects it, and returns the id.

Use it in:
- `ImagePipelineSidebar.tsx` click-to-add (replace `createNodeAtCenter`).
- `PointingPort.tsx` drop-to-create (use `placeRightOf` the source node instead of a fixed +60).
- `addCustomNodeToCanvas` in `client/pipeline/customNodes.ts` if it places at the centre.
- Leave `assist.ts` alone (WP7 rewrites it) but export the helpers so WP7 can use them.

## Tests

`tests/placement.test.ts`: empty canvas returns `want`; one blocking box moves the new box to a
free spot that does not intersect (with gap); `placeRightOf` with a box already on the right steps
down; result is deterministic.

## How the planner will check

- Add each node type from the library at default font: no text overlaps, no squeezed result box,
  no horizontal scroll inside a card.
- Click the same library item 5 times: 5 nodes, none overlapping.
- Old canvas with resized nodes keeps its sizes.
