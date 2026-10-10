# Rework plan (October 2026)

Owner feedback after commit `2941f99`, mapped to work packages (WP). Each WP has its own guide in
this folder. A coding agent implements one WP at a time; the planner reviews, tests in the browser
and commits before the next WP starts. Read `RULES.md` before any WP.

| # | Owner feedback (short) | WP |
|---|---|---|
| 1 | Side panel collapse styling is poor | WP2 |
| 2 | New buttons, widgets and parameters do not look like tldraw | WP1 |
| 3 | A group should be a box with a thumbnail; double-click opens it, quit shows the box again | WP4 |
| 4 | A group must expose every input and output its inner nodes have | WP4 |
| 5 | Remove the SQLite import feature | WP5 |
| 6 | Add a database widget: upload a SQLite file and read it | WP5 |
| 7 | The table widget UI is confusing | WP5 |
| 8 | Default sizes of new components are wrong, often crowded | WP3 |
| 9 | Node AI must be specific to that node; selection AI must build what the goal needs (add, connect, fill), not only one node | WP7 |
| 10 | Run errors are not shown on the component | WP1 |
| 11 | The AI icon on the card looks bad | WP1 |
| 12 | Rename Table to DataPipe; CSV/TSV/XLS/XLSX in; one operation per pipe with only its own parameters; pipes chain | WP5 |
| 13 | "Shape with AI" UI is poor; it must use the selection (or nothing) to build the user's goal from all available widgets | WP7 |
| 14 | Use the JEV/LLM models the owner set up, incl. the Cloudflare **Clef** decision model | WP6 |

## Order

```
WP1 UI kit + card chrome + errors + AI icon   (foundation, everything else uses it)
WP2 Sidebar (node library) + panel collapse
WP3 Default sizes + placement of new nodes
WP4 Groups: box + open/close in place, all ports
WP5 Data: DataPipe (CSV/TSV/XLS/XLSX, per-op params), Database widget, remove SQLite import
WP6 Providers: Cloudflare Workers AI + Clef (JEV)
WP7 AI: node-specific assistant + "Build with AI" for selection / empty canvas
```

WP6 only touches server + provider settings + JEV node; it may run in parallel with WP2–WP5.

## Design decisions (apply everywhere)

1. **One look: tldraw's.** Every control inside a node or panel is built from the shared kit in
   `client/ui/` (WP1). The kit wraps tldraw UI components where they exist
   (`TldrawUiButton`, `TldrawUiButtonIcon`, `TldrawUiButtonLabel`, `TldrawUiDropdownMenu*`,
   `TldrawUiInput`, `TldrawUiSlider`, `TldrawUiPopover`, `TldrawUiKbd`) and uses only tldraw CSS
   variables otherwise (`--tl-color-*`, `--tl-space-*`, `--tl-radius-*`, `--tl-shadow-*`,
   `--tl-font-sans`, `--tl-font-mono`). No hex colours, no native `<select>`, no unstyled `<button>`.
2. **Errors are visible where they happen.** One error banner per card, driven by run state
   (`nodeRunState`) and `node.error`, for every node type, with Copy and "Fix with AI".
3. **New nodes never overlap and never start crowded.** Each node type declares a default size that
   fits its content at the default font; placement finds free space.
4. **Groups keep their inner graph intact.** Collapse/expand moves wires, never deletes data. Ports
   are computed live from the inner nodes, so they stay correct when inner nodes change.
5. **Data flows as text** (CSV/TSV) between data nodes, as today; Excel files are converted on
   input. One DataPipe node = one step.
6. **AI writes plans, the app validates them.** The model returns JSON; the app checks every node
   type, field, enum value and port against the catalogue, asks the model once more with the errors
   if needed, shows a preview, and applies only on the user's OK.

## Definition of done (every WP)

- `npm run typecheck` is clean; `npx vitest run` passes (84 tests today, more after each WP).
- New pure logic has unit tests under `tests/`.
- Old canvases still load (schema rules in `RULES.md`).
- The planner checks the feature in the browser (light and dark theme) before commit.
