# WP4 — Groups as boxes: open in place, close back, all ports

Feedback items: #3 (group shows as a box with a thumbnail; double-click opens it; quit returns to
the box), #4 (a group exposes every needed input and output of its inner nodes).
Read `RULES.md` first. WP1–WP3 are done: use the kit (`client/ui/`) and `client/pipeline/placeNode.ts`.

## Words

- **Box** = the packed node (`node.type === 'subgraph'`, file
  `client/pipeline/nodes/types/SubgraphNode.tsx`). In the UI call it **"Group box"** (title) and
  the action **"Group as box"** (today "Pack"). Keep the type id `subgraph`.
- **Members** = the shapes inside the box (`node.innerIds`, hidden with `meta.packedIn = boxId`).
- **Open group** = members visible on the canvas, wrapped in a native tldraw `group` shape that
  remembers its box (`group.meta.boxOf = boxId`). The box itself is hidden while open.

## Today (read these first)

- `client/pipeline/subgraph.ts`: `packSelection` (creates box, computes ports, rewires, thumbnail
  once), `unpack` (destroys the box), `isPacked`, `watchPackedNodes`.
  Port rules today: boundary wires become ports; then unwired inner ports, **capped at 8 per side**;
  ids `in0, in1…` / `output, out1…`.
- `SubgraphNode.tsx`: rows = `max(inputs, outputs - 1)` → output rows do not line up with port
  dots (bug). Double-click on thumbnail = unpack. Width 300.
- `client/pipeline/nodes/NodeShapeUtil.tsx` ~L109: `onDoubleClick` → `unpack` for subgraph.
- `client/pipeline/groups/KeepGroupShapeUtil.tsx`: patches tldraw's `GroupShapeUtil` (outline +
  label, double-click focuses the group).
- `client/App.tsx` ~L86: `getShapeVisibility` (stable, module level) hides packed shapes.
- `client/clips/CanvasMenus.tsx` ~L183–230: context menu Pack / Unpack.
- `client/pipeline/customNodes.ts`: saved boxes ("My nodes"); `saveCustomNode` silently
  overwrites an existing name.

## Part A — Port model (feedback #4)

Create pure logic in `shared/groupPorts.ts` (no tldraw import) and use it from `subgraph.ts`:

```ts
export interface InnerPort { nodeId: string; nodeLabel: string; portId: string; terminal: 'start'|'end'; dataType: string }
export interface InnerWire { fromNode: string; fromPort: string; toNode: string; toPort: string }
export interface GroupPort { id: string; label: string; dataType: string; nodeId: string; portId: string }
/** members: node ids inside; ports: all ports of member nodes; wires: all wires touching members. */
export function computeGroupPorts(members: string[], ports: InnerPort[], wires: InnerWire[]): { inputs: GroupPort[]; outputs: GroupPort[] }
```

Rules:
1. An **input** of the box = every member input port (`terminal 'end'`) that is **not** fed by
   another member. (Wired from outside or not wired at all — both stay usable.)
2. An **output** of the box = every member output port (`terminal 'start'`) that is wired to a
   non-member **or** is not wired to any member (a "final" output). An output that only feeds other
   members is internal and hidden.
3. **No cap.** Order: by member node position (top-to-bottom, then left-to-right — pass members
   sorted that way), then port order.
4. Stable ids: inputs `i:<nodeId-suffix>:<portId>`, outputs `o:<nodeId-suffix>:<portId>` where
   suffix = the part after `shape:`. Same members → same ids, so wires survive close/open cycles.
5. Label: `<node label or type title> · <port label>`; when the node has only one input (or one
   output), just `<node label>`.

Tests: `tests/groupPorts.test.ts` — chain A→B→C: inputs = A's inputs (+ B/C inputs not fed by
members), outputs = C's output only; a branch with an extra outside wire from B exposes B's output;
13 unwired inputs all appear (no cap); ids are stable across calls.

Old boxes keep their saved `inputs/outputs` until they are opened and closed once (then recomputed).

## Part B — Box card (feedback #3)

Rewrite `SubgraphNodeComponent` / sizes in `SubgraphNode.tsx`:

```
┌───────────────────────────────────────┐
│ [▣] Summarise PDF            Group box│  header (rename works as today, store in node.title)
├───────────────────────────────────────┤
│ ● PDF text           Summary ●        │  port rows: input i on the left, output i on the right,
│ ● Style              Keywords ●       │  SAME row index → dots line up with labels
├───────────────────────────────────────┤
│ ┌───────────────────────────────────┐ │
│ │        thumbnail (16:10)          │ │  click = nothing, double-click = open
│ │                                   │ │  hover hint: "Double-click to open"
│ └───────────────────────────────────┘ │
│  4 nodes inside · [Open]              │
└───────────────────────────────────────┘
```

- Width 360. Rows = `max(inputs.length, outputs.length, 1)`; port y = row centre for both sides.
  Fix `getPorts` and the component to use the same row index (output i in row i).
- Port label rows use `NodePortLabel` coloured by data type; long labels ellipsis + `title`.
- Thumbnail area: 16:10 of the inner width, `object-fit: contain`, background `--tl-color-low`,
  radius `--tl-radius-2`. No thumbnail → `UiEmpty` with `IconGroup` and "N nodes inside".
- Footer line: "N nodes inside" and `UiButton size="sm"` **Open**.
- Errors: keep `node.error`; WP1's banner shows it (remove the old inline `NodeStatus` span).

## Part C — Open and close in place

In `client/pipeline/subgraph.ts` add:

`openGroup(editor, boxId)`:
1. Read the box; members = `innerIds` that still exist.
2. Move members so the top-left of their page bounds equals the box's top-left (one translate for
   all; keep relative layout).
3. Unhide members (`meta.packedIn: null`) — same as `unpack` does.
4. Rebind every wire on the box's ports to its inner target (`nodeId`/`portId`) — same as `unpack`.
5. Group the member shapes **except `connection` shapes** with `editor.groupShapes(ids)`; set the
   new group's `meta = { label: node.title, boxOf: boxId }`.
6. Hide the box: `meta.boxOpen = groupId`. Update the stable `getShapeVisibility` in `App.tsx` to
   hide shapes where `isPacked(shape) || typeof shape.meta?.boxOpen === 'string'`.
7. Select the group, zoom to it if it is mostly off screen.

`closeGroup(editor, groupId)`:
1. Read `boxOf`; if the box is gone, just leave the group as a normal group (remove `boxOf`).
2. Members = current descendants of the group (the user may have added or removed shapes while it
   was open), plus connections whose both ends are members.
3. `editor.ungroupShapes([groupId])` (keep members' page positions).
4. Recompute ports with `computeGroupPorts`; rewire boundary wires to the box's new port ids
   (outside→member input → box input; member output→outside → box output); wires to ports that no
   longer exist are left on the member (and the member stays hidden — so instead **delete** such
   wires and toast "N wires removed").
5. Hide members (`meta.packedIn = boxId`), update `innerIds`, `inputs`, `outputs`; move the box to
   the members' former top-left; clear `meta.boxOpen` (set to `null`).
6. Refresh the thumbnail (`editor.toImage` of members **before** hiding them, scale 0.5, as in
   `packSelection`), mark the box out of date.

Refactor `packSelection` to: create the box at the selection's top-left, then reuse the same
"collapse members into box" code as `closeGroup` (one function `collapseIntoBox(editor, boxId,
memberIds)`). Keep `unpack` as **"Ungroup box"** (dissolve: members stay visible, box deleted).

### UI hooks

- Double-click on the box (anywhere on the card except inputs/buttons) → `openGroup`. Change
  `NodeShapeUtil.onDoubleClick` (it calls `unpack` today).
- The open group's label (patched `GroupShapeUtil.component` in `KeepGroupShapeUtil.tsx`): when
  `meta.boxOf` is set, render the label as a small pill: `IconGroup` + title + a
  `UiButton size="sm"` **"Close to box"** (`IconCollapse`). It must receive pointer events
  (`pointer-events: all`, stop propagation). Also use a dashed outline in `--tl-color-selected`
  for box groups (class `GroupOutline_box`).
- Context menu (`CanvasMenus.tsx`): on a box → "Open group", "Ungroup box"; on an open box group or
  any of its members → "Close to box"; on a selection of nodes → "Group as box" (old Pack).
  Keep existing shortcuts if any.
- No keyboard shortcut for close (Escape belongs to tldraw).

## Part D — Execution correctness

- Running "Run all" (or any multi-node run) must not run a box while it is open (it is hidden
  and its members run directly), and must not run hidden members of a closed box directly (the
  box runs them). Check `client/pipeline/execution/ExecutionGraph.tsx` / `executionState.ts` /
  `loop.ts` for how the node set is chosen and filter accordingly with `isPacked` and
  `meta.boxOpen`. Add a short comment there.
- The box `execute` keeps using overrides `${nodeId}|${portId}`; with the new port ids it still
  maps via `p.nodeId`/`p.portId`.

## Part E — My nodes

- `saveCustomNode` (`client/pipeline/customNodes.ts`): if a node with the same name exists, ask
  with `window.confirm('Replace "<name>" in My nodes?')` (or the tldraw dialog if easy) before
  overwriting; cancel = do nothing.
- Saving a box that is open: close it first.

## How the planner will check

1. Select 3 chained nodes (+ one with two unwired inputs) → "Group as box": the box shows all
   free inputs on the left, final outputs on the right, dots aligned with labels, thumbnail.
2. Wire something into the box and from it; run it — works.
3. Double-click → members appear in place inside a dashed group with "Close to box"; outside wires
   now go to the inner nodes. Add a new node into the group, wire it, click "Close to box": the box
   comes back with an updated thumbnail and ports, outside wires still connected.
4. Reload the page: state persists (open or closed).
5. An old canvas with an old box still loads and runs.
