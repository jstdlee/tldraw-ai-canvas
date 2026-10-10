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

### Second round of feedback (2026-10-10)

| Owner feedback (short) | WP |
|---|---|
| Output also spilled as a canvas label when the card already shows it | WP8 |
| Resize/selection shows an extra rectangle | WP8 |
| Text areas do not fill the card | WP8 |
| Expand ("max") icon and its modal look bad | WP8 |
| Ctrl+E delete; Ctrl+B → C → colour (G, K/default, B, R, Y) | WP8 |
| Search when dropping a wire; rank by name, description, JEV, recent use | WP8 |
| File in + URL in → one "Read from" (upload, URL); no server file read | WP9 |
| Images take a URL input; pasted image link previews and resizes | WP9 |
| Image generation card (Google, OpenAI, OpenRouter, custom URL), N images grid, enlarge | WP9 |
| Model provider card: custom OpenAI-compatible `/v1/models`, pick one, output it | WP10 |
| Raw model, AI text, Generate text, Chat accept input parameters | WP10 |
| Enter does not run Chat, Generate text, AI text | WP10 |

## Order

```
WP1  UI kit + card chrome + errors + AI icon          ✔ committed 1f89c1b
WP2  Sidebar (node library) + panel collapse
WP8  Card polish, shortcuts, smart node search        (fixes visible daily annoyances early)
WP3  Default sizes + placement of new nodes
WP4  Groups: box + open/close in place, all ports
WP5  Data: DataPipe, Database widget, remove SQLite import, file store
WP6  Providers: Cloudflare Workers AI + Clef (JEV)
WP9  Read from, image URLs + paste, image generation   (needs WP5 file store)
WP10 Model provider card, input parameters, Enter to run
WP7  AI: node specialist + "Build with AI"             (last: it must know every node above)
```

WP6 only touches server + provider settings + JEV node; it may run in parallel with others.

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
