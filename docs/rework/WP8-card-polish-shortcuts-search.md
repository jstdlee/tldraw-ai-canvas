# WP8 — Card polish, keyboard shortcuts, smart node search on wire drop

Owner feedback (second round): output label duplication, resize shows an extra rectangle, text
areas do not fill the node, the "max" (expand) icon and its modal look bad, Ctrl+E delete,
Ctrl+B colour chord, search when dropping a wire with a long widget list (rank by name,
description, JEV, recent use). Read `RULES.md` first. WP1–WP2 are done (kit in `client/ui/`).

## 1. Output spill only when the node cannot show its own output

Today `spillUnconnectedOutput` (`client/pipeline/autoSpill.ts`, called from
`client/pipeline/execution/ExecutionGraph.tsx` ~L244) puts every unwired main output on a text or
image shape beside the node — also for nodes that already show the result inside the card (AI
text, chat, code, table preview, chart, images, JEV …). That is a duplicate.

- Add `readonly showsOutput: boolean = false` to `NodeDefinition` (`nodes/types/shared.tsx`).
  Set `true` on every node type whose card body renders its result (read each Component; list them
  in your report).
- New optional shape prop on the node shape (`NodeShapeUtil.tsx` props): `spill?: 'auto' | 'always' | 'never'`
  (undefined = `'auto'`). `auto` → spill only when `!definition.showsOutput`.
- ⋯ menu: a checkbox item "Put output on canvas" (checked when the effective mode spills); toggling
  sets `'always'` or `'never'`.
- Existing spilled shapes stay; nothing is deleted.

## 2. One clean edge while selected and resizing

- Run-state outlines (`.NodeShape_running`, `_ok`, `_error`, `_missing` in `client/pipeline/index.css`
  ~L1310–1326) use `outline` + `outline-offset: 2px`, which draws a second rectangle next to the
  selection box. Replace with the card's **own border** colour (border stays 1px; error/missing →
  `--tl-color-danger`, ok → `--tl-color-success` for 1.5 s then normal, running → animated border
  colour pulse with `--tl-color-selected`). No outline, no offset, no box-shadow ring.
- Selection: in `NodeShapeUtil` set `hideSelectionBoundsFg` → `true` for nodes (keep resize handles
  via `hideResizeHandles` false when `canResize`), and make `getIndicatorPath` draw a **rounded**
  rect with the same radius as the card (`--tl-radius-3`, read the px value used by `.NodeShape`)
  plus the port circles. Result: one rounded blue edge exactly on the card edge, handles on it.
- Same for `.SearchBlink` (use border colour, no offset).
- Check in the browser (planner will) that select, hover, resize and run states show exactly one edge.

## 3. Text areas fill the node

From the code map: `.NodeBody` is a flex column and only `.GenerateTextNode-result`,
`.NodeImagePreview`, `.NodeGrow`, `.ChatNode-thread` grow. `.TextAreaField`, `.CodeArea`,
`.NodeField-block`, `.PromptNode-row` have fixed inline heights, and
`.NodeRow textarea.UiTextArea { height:auto; align-self:stretch }` (`client/ui/ui.css` ~L116)
overrides `.UiTextArea_grow`.

- Rule: the **main** text area of a node (Prompt text, AI text instruction, Chat message, Code,
  JEV question/options, RawModel system, Template text, DataPipe inline data, Database SQL) is the
  growing element: wrap it in `.NodeGrow` (direct child of `.NodeBody`), width 100%, height 100%
  of the free space, min-height 3 rows. Remove the fixed inline heights (`height={80}` etc.);
  `getBodyHeightPx` keeps the default size, and extra node height (resize) goes to that area.
- Fix the `ui.css` specificity so `UiTextArea` with `grow` always fills its container
  (`width:100%; height:100%; box-sizing:border-box; resize:none`).
- Secondary text areas stay fixed height but full width.

## 4. Expand button and the large editor

- `FieldMax` (`client/pipeline/editors/LargeEditor.tsx` ~L95): replace with `UiIconButton`
  (`IconExpand`, 1.5em), shown only on hover/focus of its field (CSS `opacity` transition), top-right
  inside the field with `--tl-space-1` inset, no border, panel background at 85% via
  `color-mix(in srgb, var(--tl-color-panel) 85%, transparent)`.
- `LargeEditor` and `ImageZoom`: rebuild as a proper tldraw-style dialog:
  centred, `min(960px, 90vw)` × `min(720px, 85vh)`, dim backdrop
  (`color-mix(in srgb, var(--tl-color-text-1) 25%, transparent)`), radius `--tl-radius-4`, shadow
  `--tl-shadow-4`. Header: title (node name · field), right side kit buttons: Format (code only),
  Copy, **Apply** (primary), Close (`IconClose`). Body: editor fills all space; mono font for code/SQL/JSON.
  Footer hint: "Ctrl+Enter apply · Esc close". Click on the backdrop closes (asks only if the draft
  changed: `window.confirm('Discard changes?')`). ImageZoom: image `object-fit: contain` on a
  `--tl-color-low` background, plus "Place on canvas" button (uses `placeImageOnCanvas`).
- Keep the existing props API so callers do not change.

## 5. Shortcuts

Both go through the existing places: tldraw action overrides (`canvasActionOverrides` in
`client/clips/CanvasMenus.tsx`) and the window key handler in `client/shell/ShellChrome.tsx`.

- **Ctrl/Cmd+E = delete selection.** It exists twice today (`erase-selection` `$e` and a
  ShellChrome handler). Keep exactly **one** (the action override, label "Delete (erase)"), make it
  `preventDefault()` so Chrome/Electron do not focus the address/search bar, skip when typing in an
  input/textarea/contenteditable, and respect `deleteLocked` nodes (they are skipped, toast
  "N locked nodes kept"). Remove the duplicate handler.
- **Colour chord: Ctrl/Cmd+B, then C, then a colour key.** After Ctrl+B, show a small kit toast /
  floating hint near the bottom toolbar: "Colour: G green · K default · B blue · R red · Y yellow"
  (2 s timeout, Esc cancels). Accept `C` then the colour key; also accept the colour key directly
  after `C` within 2 s. Keys: `g` → green, `k` or `d` → black (tldraw "black" = default), `b` → blue,
  `r` → red, `y` → yellow. Apply with `editor.setStyleForSelectedShapes(DefaultColorStyle, value)`
  and `editor.setStyleForNextShapes(...)`. `preventDefault()` on Ctrl+B (browser bookmarks) only
  when focus is not in a text field.
- **Node colour:** nodes have no colour prop. Add optional shape prop `color?: string` (one of the
  tldraw colour names). The chord also sets it on selected nodes. Render it as a 4px top accent on
  the card header and a tinted header icon, using tldraw's theme colours
  (`getDefaultColorTheme({ isDarkMode })[color].solid`) — this is the one allowed computed colour.
- Add both shortcuts to the keyboard shortcuts dialog / main menu labels (`kbd` values).

## 6. Smart search when dropping a wire

Today: dragging from an output port to empty canvas opens `OnCanvasNodePicker`
(`client/pipeline/components/OnCanvasNodePicker.tsx`, 170 px, every node, grouped, no search,
no type filter). Wire flows: `client/pipeline/ports/PointingPort.tsx` (~L91–179) and
`client/pipeline/connection/ConnectionShapeUtil.tsx` (~L236–300), `findFirstCompatiblePort`.

New picker (keep the same open/close/onPick contract):

```
┌──────────────────────────────────┐
│ 🔍 [summ|                     ]  │  autofocus; typing filters immediately
│ Recent                           │  (only when the query is empty)
│  ▢ Summarize   Short summary …   │
│ Best matches          ✦ ranked   │  ✦ shown when JEV re-ranked the list
│  ▢ Summarize   Short summary of… │  icon · title · one-line description (text-3, ellipsis)
│  ▢ AI text     Rewrite, translate│  ↑/↓ moves, Enter picks, Esc closes
│  ▢ Chat message …                │
│ Other compatible (12) ▸          │  collapsed rest
└──────────────────────────────────┘
```

- Width 340, max height 420 px, kit styles, scaled like today.
- **Candidates:** non-hidden node types that have an input port compatible with the source port's
  data type (`arePortDataTypesCompatible`). Incompatible types are not shown.
- **Descriptions:** create `shared/nodeDescriptions.ts`: `NODE_DESCRIPTIONS: Record<type, { title: string; description: string; keywords: string[] }>`
  for every non-hidden type (one sentence each; read the node files). WP7 will reuse it.
  Test that every type in `NODE_PORTS` has an entry.
- **Local score** (`shared/pickerRank.ts`, pure, tested):
  `score = 3·titlePrefix + 2·titleContains + 1.5·keywordHit + 1·descriptionContains + 0.8·recency + 0.5·exactTypeMatch`,
  fuzzy subsequence match on the title as a fallback (0.5). Recency: `localStorage`
  `oh-my-tldraw:picked` = `{ [type]: { count, last } }`; `recency = min(1, log2(1+count)/4) · 0.5^(daysSince/14)`.
  Record a pick on every pick (also from the sidebar).
- **JEV re-rank** (accuracy): when the query has ≥ 3 characters and ≥ 3 local candidates, after a
  350 ms pause call `POST /api/jev` with `{ type: 'choice', question: 'Which node does the user want next? Query: "<q>"', context: '<source node title> output (<dataType>): <first 300 chars of its value>', options: top 8 as "<type>: <title> — <description>" }`.
  Use the default JEV model (fast models such as Clef Flash are set by the user). Timeout 2.5 s
  (`AbortController`). Final order = `0.6·localNorm + 0.4·jevProbability`. Ignore stale responses
  (query changed). On error or timeout keep the local order silently. A setting in the picker
  footer "Smart ranking" toggle (persisted) turns JEV off.
- Pick → same creation + wiring as today.

## Tests

`tests/pickerRank.test.ts` (prefix beats contains; keyword hit; recency decay; compatible filter
helper if pure), `tests/nodeDescriptions.test.ts` (coverage).

## Planner check

Spill only for nodes without their own output view; one rounded edge while selected/resizing/running;
Prompt and AI text areas fill the card and grow on resize; new expand dialog; Ctrl+E deletes;
Ctrl+B C R makes a selected rectangle and a node red; drop a wire from Prompt, type "sum" → Summarize first.
