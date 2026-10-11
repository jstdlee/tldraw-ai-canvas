# WP25 — Performance with many cards

Read `RULES.md` first. Owner: "quite lagging when more components are on the canvas". Measure first,
then fix the real causes, then measure again.

## 1. Benchmark (Playwright, `tests/perf/` — local only, not part of `test:e2e`)

`npm run test:perf`: a canvas with 30, 80 and 150 cards (a realistic mix: DataPipe with preview,
Chart, AI text with result, Prompt, JEV, If, Database, wired in chains). Measure with
`performance.now()` + `requestAnimationFrame` sampling and the Chrome trace (CDP `Tracing`) /
React Profiler:
- pan the camera for 3 s (frame times: p50, p95, longest);
- drag one card for 3 s;
- type 20 characters in a Prompt;
- run one chain of 5 cards;
- select-all + deselect.
Also count React commits per card during each action (React Profiler `onRender` or a dev-only
render counter) and the number of `getNodePorts` / `getNodeTypePorts` evaluations per frame.
Write the numbers to `tests/perf/results.md` (before / after table).

## 2. Suspects to confirm or rule out (from the code)

- `client/pipeline/ports/fieldAnchors.ts`: anchors live in one atom for all shapes. Any anchor
  update (ResizeObserver, every camera zoom) may invalidate every card's ports and re-render every
  card. → per-shape atoms (`AtomMap` keyed by shape id), and skip writes when the value is unchanged
  (round to 0.5 px).
- `nodeRunState` (`execution/nodeRunState.ts`): one record for all cards; every status change
  re-renders every card that reads it. → per-shape atoms.
- Dev-only anchor warnings and their `setTimeout`s in `getNodeTypePorts` (WP17/WP21): make sure they
  cost nothing in production and little in dev (run once per shape after mount, not per evaluation).
- `useValue` computations in `NodeShapeUtil` / card components that walk all shapes or bindings
  (e.g. `getNodeInputPortValues`, picker / search docs built per render, `getCardDocs`).
- ResizeObservers per row (WP17): one observer per card instead of per row, batched in rAF.
- Off-screen cards: tldraw culls shapes, but our HTMLContainer content may still render React
  trees; for culled cards render a light placeholder (header only) — check tldraw's
  `isShapeCulled` / `editor.getCulledShapes()`.
- Charts and tables: ECharts instances or big `UiTable`s re-created on every render; cap preview
  rows rendered (virtualize or 50 rows max) and keep chart instances alive.
- Connection shapes: wire path computations on every frame while dragging.
- CSS: expensive `box-shadow`/`filter`/`backdrop-filter` on every card; `will-change` misuse.

## 3. Fix

Fix the measured top causes. Keep behaviour identical (all unit + e2e tests stay green). Target at
150 cards: pan p95 < 20 ms, card drag p95 < 25 ms, typing has no dropped frames.

## Report

The before / after table, what each fix changed, and what is still slow.
