# WP43 — Zip wires

Read `docs/rework/RULES.md` first. tldraw is now 5.6.0.

## Goal

The user selects a messy set of wires (pipeline connections) and/or arrows and runs **Zip wires**.
The lines do **not** merge into one trunk. Each line keeps its own start and end, but the middle
parts are pulled **close together and parallel**, in an order with no crossings, like the teeth of
a zip. The change plays as a zip animation: the lines snap into place one after another, from one
side of the bundle to the other, as if a zip slider runs along them.

**Unzip wires** restores the original shape of the lines.

## What counts as the target

`zipTargets(editor)`:

- Selected `connection` shapes and selected tldraw `arrow` shapes.
- Plus connections and arrows with at least one end bound to a selected shape (so the user can
  select two groups of cards and zip the wires between them).
- Skip locked shapes, derived links (`meta.derived`), and arrows with no binding at both ends that
  are shorter than 40 px.

Fewer than 2 targets: show a toast "Select at least two wires or arrows" and do nothing.

## Bundles (pure logic, `shared/zipWires.ts`)

Input: `{ id, start: {x,y}, end: {x,y} }[]` in **page** space (the current terminals).
Output: bundles, each `{ ids: string[] (in lane order), axis: unit vector, lanes: Record<id, offset> }`.

1. Direction of a line = `end - start`, normalised. Two lines go in the same bundle when the angle
   between their directions is ≤ 35° **and** their middle points are within
   `max(160, 0.6 × shorter length)` of each other along the normal. Use simple greedy grouping;
   a bundle has at least 2 lines. Lines not in any bundle are left as they are.
2. Bundle axis = mean direction. Normal = axis turned 90°.
3. Lane order: sort the lines by `(start · normal + end · normal) / 2` (average sideways position),
   so lines do not cross in the middle.
4. Lane offsets: `offset_i = (i - (n-1)/2) × gap` with `gap = 10` (page units, a named constant
   `ZIP_GAP`). The centre of the bundle is the mean of the lines' natural middle points projected
   on the normal.
5. Export `zipLanePoint(line, bundleCentre, axis, offset)`: the page point the line passes through in
   the middle (its own middle along the axis, the bundle centre + offset along the normal).

Unit tests in `tests/zipWires.test.ts`: two crossing wires get swapped lanes (no crossing), three
parallel wires get offsets −10/0/+10, a wire at 90° to the others is left out, lane points lie
between start and end along the axis, and the function is deterministic.

## Connections (pipeline wires)

Store the zip in the shape's **meta** (no schema change):
`meta.zip = { bundle: string, offset: number } | null`.

- `bundle` = a random id shared by the lines zipped together. The bundle centre is **not** stored:
  compute it live from the current natural middle points of all connections with the same
  `bundle` id on the page, so the bundle stays tidy when cards move.
- Path with a zip: two cubic segments, `start → lane point → end`. At the lane point the tangent is
  the bundle axis; the out/in tangents at the terminals stay horizontal as today
  (`getConnectionControlPoints`). Put the path maths in `shared/zipWires.ts`
  (`zippedConnectionPath(start, end, lane, axis)` returning the SVG `d` and the bezier control points)
  and test it.
- `ConnectionShapeUtil`: `getGeometry`, `getIndicatorPath`, the rendered `<path>` and
  `getConnectionPageCenter` (the insert-node handle) must all use the same path, so selection,
  hit testing and the + handle follow the zipped line. Use a `Group2d` of two `CubicBezier2d` for
  the geometry.
- Without `meta.zip` the wire is drawn exactly as before.

## Arrows (tldraw arrows)

tldraw draws arrows; we only set props.

- Arc arrows (`kind: 'arc'`): set `bend` so the arc's middle point lands on the lane point. Keep the
  old value in `meta.zip = { bundle, offset, bend: <old bend> }`. Verify the sign of `bend` with
  `editor.getArrowInfo(shape)` (its `middle` point) in a test: after zipping, each arrow's middle is
  within 2 px of its lane point.
- Elbow arrows (`kind: 'elbow'`): set `elbowMidPoint` so the middle segment runs on the lane; keep the
  old value in `meta.zip.elbowMidPoint`. If that is not possible for a given arrow, leave it out of
  the bundle.
- Arrows do not follow later card moves (tldraw owns them). Running Zip again re-tidies them.

## Animation

- Duration 450 ms total, ease-out. Lines move **one after another** in lane order with a stagger of
  `min(60, 300 / n)` ms; each line tweens from its old middle to its lane point (connections: tween
  an animated offset factor from 0 to 1 in a client-only atom keyed by shape id; arrows: tween `bend`
  / `elbowMidPoint`).
- A short zip slider: a small pill (8 × 14 px, `--tl-color-selected`) moves along the bundle axis at
  the bundle centre during the animation, then fades out (120 ms). Draw it in an overlay
  (`InFrontOfTheCanvas` or an overlay util), not as a shape.
- Intermediate frames must not create undo steps: `editor.markHistoryStoppingPoint('zip-wires')`
  once, then apply the **final** values in one `editor.run`. Arrow tween frames use
  `editor.run(fn, { history: 'ignore' })` and the final write is normal.
- `prefers-reduced-motion: reduce`: no animation, jump to the result.
- One Ctrl+Z undoes the whole zip.

## Unzip

Clears `meta.zip` (set to `null`), restores arrow `bend` / `elbowMidPoint` from meta, with the same
animation reversed. Undoable in one step.

## Where the user finds it

- Context menu, Arrange group: **Zip wires** (shown when `zipTargets` would return ≥ 2) and
  **Unzip wires** (shown when any target has `meta.zip`).
- Shortcut: **Alt+Z** for Zip (check tldraw and `canvasActionOverrides` for a clash first; if taken,
  use Alt+Shift+Z and say so). Add both actions to the Ctrl+P command list if actions show up there.
- Add a row to `shared/featureList.ts`.

## Tests

- Unit: `tests/zipWires.test.ts` (above).
- E2E `tests/e2e/zip-wires.spec.ts`: three cards on the left wired to three cards on the right with
  crossing wires; select all; Zip wires → every connection has `meta.zip`, lane order has no
  crossings (the middle points' order along the normal matches the lane order), the middle points of
  the three wires are 10 ± 1 px apart; Ctrl+Z restores all; Unzip clears meta; two crossing arc
  arrows get zipped (middle points within 2 px of lane points); moving a card keeps the zipped wires
  together (lane points recomputed).

## Done means

`npx tsc --noEmit -p .` clean, `npx vitest run` green. Do not run the e2e suite (the reviewer does);
you may run your own new spec with
`CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=2000 E2E_WEB_PORT=5201 E2E_API_PORT=8801 npx playwright test tests/e2e/zip-wires.spec.ts`.
Do not commit.
