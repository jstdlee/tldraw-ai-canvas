# WP15 — Fine-tuning from the browser tests

Read `RULES.md` first. Every item below was seen by the planner while testing WP1–WP10 in the
browser. Small items, one pass. Kit rules as before (UiField is 0.8em in cards; errors are
thrown and shown only in the banner).

## A. Results inside the card (no extra canvas text)

AI text, Summarize, Code, Raw model, HTTP, Download and Save have no result area, so their
output is still copied as a text shape beside the card (`showsOutput = false`).
- Give each a `NodeTextResult` result area (grows, scrolls, expand button, copy) and set
  `showsOutput = true`. HTTP: status line (`200 · 12 KB · 340 ms`) above the body;
  JSON bodies pretty-printed. Code: stdout and the returned value, separated.
- Keep the "Put output on canvas" menu option for anyone who wants the spill.

## B. One error place

These cards still render their error inline as well as in the banner:
`JevNode, PostgresNode, UtilityNodes, DataNodes (chart), ImageNodes, LogicNodes, InputNodes,
RawModelNode, DatabaseNode` (`grep -rn "NodeStatus is-error" client/pipeline/nodes/types`).
Remove the inline error rows and the body height reserved for them; the banner shows it.

## C. LLM cards shorter by default

In Generate text / AI text / Chat / Raw model / Generate image the System and Params port rows
are always shown, even with "Model settings" closed. Move them inside the closed section; while
the section is closed, their port dots sit on the section header row (stacked 6 px apart) and
show a small "2 wired" badge when wired. The card's default height drops by two rows.

## D. Group box wording and placement

- Header shows "Box" and a "GROUP BOX" badge — duplicated. Use the group's title in the header
  (default "Group (N cards)") and drop the badge; keep the group icon.
- Library empty text "Pack nodes, then right-click → Save as my node" → "Select cards, right-click
  → Group as box, then Save as my node".
- New box placement: prefer the members' own bounds position; when it must move, prefer
  **right of** upstream sources and **left of** downstream targets (so wires do not run
  backwards), then fall back to `findFreeSpot`.

## E. Data cards

- DataPipe keeps the uploaded file as CSV text inside the card (`node.text`) → big files make
  the canvas JSON heavy. Keep only `fileUrl` + sheet and read the bytes on run (the file store
  caches them); `text` stays for inline data. Old cards with text keep working.
- The second DataPipe in a chain had ~2 rows of empty space at the bottom: recompute
  `getBodyHeightPx` from the actually rendered rows for every op (params differ per op), and
  remove the fixed preview height when there is no preview yet.
- Database card: the SQL editor takes most of the card while the result grid is small. Default
  split: editor 5 lines, results grow (results are the `NodeGrow` element; the editor gets a
  drag handle to resize).
- Read from: the preview uses 0.74em mono; long CSV lines wrap mid-word. Show tabular data as a
  `UiTable` (first 50 rows) when the content is CSV/TSV, plain text otherwise.

## F. Canvas chrome

- The floating AI (sparkle) chat button sits on top of tldraw's "Get a license" note in the
  bottom-right corner. Move it 56 px up, or into the top-right next to Nodes / Agent.
- Default card font is 20 px (`DEFAULT_NODE_FONT_PX`), so cards are very large at 100 % zoom.
  Change the default to 16 px for **new** cards only (existing cards keep their stored font size;
  cards without a stored size must keep 20 px — store `fontSize: 16` on create instead of changing
  the constant). Re-check `getBodyHeightPx` rows still fit (rows are em-based).

## G. Dev speed

Break the import cycle `nodeTypes.tsx ↔ NodeShapeUtil.tsx ↔ subgraph.ts ↔ SubgraphNode.tsx`
that breaks Vite hot reload: move the registry object (`NodeDefinitions` map + `getNodeDefinition`
etc.) into `nodes/registry.ts` that imports the node type files, and have `subgraph.ts` /
`NodeShapeUtil.tsx` import only small helpers that do not import the registry at module load
(pass the editor and look the definition up at call time). Verify by editing a node file with
the dev server running: no "Cannot access … before initialization".

## Planner check

Each item in the browser, light and dark; old canvases load unchanged.
