# WP1 — UI kit, card chrome, visible errors, AI icon

Feedback items: #2 (tldraw look), #10 (errors on the component), #11 (AI icon).
Read `RULES.md` first.

## Goal

1. One shared set of tldraw-styled controls (`client/ui/`) that every node and panel uses.
2. A calm card footer: few buttons, tldraw icon buttons, the rest in the ⋯ menu.
3. Every run error is readable on the card itself.
4. A proper AI (sparkle) icon.

## Part A — UI kit (`client/ui/`)

Create these files:

- `client/ui/icons.tsx` — SVG icon components. 16×16 viewBox, `fill="none"`,
  `stroke="currentColor"`, `strokeWidth={1.5}`, round caps/joins, prop `size` (default 16).
  Icons: `IconSparkle` (four-point star with a small second star — the AI icon), `IconPlay`,
  `IconStop`, `IconCopy`, `IconCheck`, `IconChevronUp`, `IconChevronDown`, `IconChevronRight`,
  `IconMore` (three horizontal dots, filled), `IconPin`, `IconLock`, `IconUnlock`, `IconPaste`,
  `IconClear` (eraser), `IconTextSmaller`, `IconTextLarger`, `IconAlert` (triangle with !),
  `IconClose`, `IconUpload`, `IconTable`, `IconDatabase`, `IconGroup` (stacked boxes),
  `IconExpand`, `IconCollapse`, `IconPlus`, `IconTrash`, `IconWand`.
  Export a `Icon` map type is not needed; named exports are enough.
- `client/ui/kit.tsx` — React components:
  - `UiButton({ variant: 'primary'|'normal'|'low'|'danger', icon?, label?, onClick, disabled, title, size: 'sm'|'md' })`
    built on `TldrawUiButton` + `TldrawUiButtonIcon`-like layout. Use `TldrawUiButton type="normal"`
    / `type="primary"` / `type="low"` (danger = low with danger class). `sm` = compact height
    (2em) for inside nodes; `md` = tldraw default (40 px) for panels.
  - `UiIconButton({ icon, title, onClick, active?, disabled?, done? })` — square, 1.75em, uses
    `TldrawUiButton type="icon"`. `active` uses `--tl-color-selected`; `done` flashes success for 900 ms
    (component owns the timer).
  - `UiSelect<T extends string>({ value, options: {value:T,label:string,hint?:string,group?:string}[], onChange, placeholder?, title? })`
    built on `TldrawUiDropdownMenuRoot/Trigger/Content/Group/Item` with `TldrawUiButton type="menu"`
    items; the selected item shows a check (`TldrawUiButtonCheck` or `IconCheck`). Trigger looks
    like a field (full width, label left, chevron right). Options with `group` are grouped with a
    small heading. Needs a unique `id` per instance (`useId`).
  - `UiMultiSelect` — same, but toggles values; trigger shows "a, b, c" or placeholder.
  - `UiTextInput({ value, onChange, placeholder, mono?, onCommit? })` — controlled `<input>`
    styled as tldraw input (see CSS). Stops pointer and key events.
  - `UiTextArea({ value, onChange, placeholder, mono?, rows?, grow? })` — same look, scrolls inside.
  - `UiNumberInput({ value, onChange, min, max, step })`.
  - `UiCheckbox({ checked, onChange, label })` — tldraw-like check box (a 1em box, `--tl-color-selected` when on).
  - `UiSlider({ value, min, max, step, onChange, label })` — wrap `TldrawUiSlider` if its API fits
    (it uses `steps` and `value` as integers; map to the real range); otherwise a styled range input.
  - `UiSegmented<T>({ value, options, onChange })` — a row of small toggle buttons (like tldraw's
    style panel button rows).
  - `UiField({ label, hint?, children, inline? })` — label above control (or left, when `inline`),
    hint in `--tl-color-text-3`.
  - `UiSection({ title, children, collapsible?, defaultOpen? })`.
  - `UiChip({ label, icon?, onClick?, active? })` — rounded pill.
  - `UiEmpty({ icon?, text })` — centred muted placeholder.
  - `UiTable({ columns: string[], rows: string[][], maxRows?: number })` — compact grid:
    sticky header, zebra rows with `--tl-color-low`, mono numbers right-aligned, cells clip with
    ellipsis and full value in `title`, scroll inside, "+N more rows" footer.
  - `UiErrorBanner({ message, onCopy?, onFix?, onDismiss? })` — see Part C.
- `client/ui/ui.css` — all kit styles, imported once from `client/main.tsx` (after tldraw css).
  Class prefix `Ui`. Only tldraw CSS variables. Inputs: background `--tl-color-muted-0` (or
  `--tl-color-low`), 1px border `--tl-color-low-border`, radius `--tl-radius-2`, focus ring
  `--tl-color-focus` / `--tl-color-selected`, font `--tl-font-sans` (mono variant
  `--tl-font-mono`). Inside nodes everything is in `em`.
- `client/ui/index.ts` — re-export all.

All kit controls call `e.stopPropagation()` on `pointerdown`, and inputs also on `keydown`.

## Part B — Replace old controls

1. `client/pipeline/nodes/types/NodeSelect.tsx`: keep the exports `NodeSelect` and
   `NodeMultiSelect` (many files import them) but make them thin wrappers over `UiSelect` /
   `UiMultiSelect`. Delete the old `.TlSelect*` CSS block in `client/pipeline/index.css`
   (around lines 1115–1227) once nothing uses it.
2. Find every native `<button className="NodeField-button"…>`, raw `<select>`, raw
   `<input type="checkbox">` and raw text inputs inside node bodies under
   `client/pipeline/nodes/types/` (InputNodes, DataNodes, ToolNodes, PostgresNode, LogicNodes,
   TextNodes, JevNode, NetworkNodes, etc. — use `grep -n "<button\|<select\|<input"`) and replace
   them with kit components. Keep the same behaviour and props.
3. Replace hard-coded colours in `client/pipeline/index.css` and `client/shell/shell.css` with
   variables: `#3b82f6`/`#2563eb` → `--tl-color-selected`, `#22c55e` → `--tl-color-success`,
   `#e03131` → `--tl-color-danger`, `#111`/whites → `--tl-color-text-1` / `--tl-color-panel`.
   Do not change port data-type colours in `client/pipeline/constants.tsx`, but make the CSS
   colour for data type `any` equal the value in `constants.tsx` (`#c08520`), so the dot and wire match.

## Part C — Card chrome (`client/pipeline/nodes/NodeShapeUtil.tsx`)

### Footer

Today the footer has Run + 9 small buttons (`NodeFooterTools`, lines ~387–528) + ⋯ menu. Change to:

```
[▶ Run / ■ Stop / 1.2 s]                       [✦ AI] [⧉ Copy] [⌃ Collapse] [⋯]
```

- Run button: `UiButton size="sm" variant="low"` with `IconPlay`/`IconStop`, same logic as now.
- AI: `UiIconButton icon={<IconSparkle/>} title="Ask AI about this node"` → `openFillAssist(shape.id)`.
  Give it class `NodeAiButton`: colour `--tl-color-text-3`, hover `--tl-color-selected`.
- Copy: `UiIconButton` with `done` flash (replace the classList hack).
- Collapse: `UiIconButton` with chevron.
- ⋯ menu (`NodeFooterMenu`): keep its current items and **add** these, moved out of the footer:
  Paste, Pin / Unpin, Lock delete / Allow delete, Smaller text, Larger text, Clear output.
  Use `TldrawUiDropdownMenuItem` + `TldrawUiButton type="menu"` + `TldrawUiButtonLabel`, with
  `TldrawUiMenuCheckboxItem`-style check for Pin and Lock (or a check icon). Keep the same handlers
  (move `paste`, `stepFont`, `clearOutput` into the menu component or a shared hook).
- Remove the old `.NodeFooterTools*` CSS.

### Error banner (feedback #10)

Today errors show only as a tiny `.NodeShape-issue` text in the header (10px, ellipsis). Replace it:

- Remove the `.NodeShape-issue` element from the header. Keep the red outline class
  (`NodeShape_error` / `NodeShape_missing`).
- New component `NodeErrorBanner` rendered **directly under the card**, in the place of
  `NodeRunStatus` (absolute, top = card height + 6 px, left 0, width = card width). It does not
  change the shape geometry, so no layout code changes.
- Message source, in order: `run.message` when `run.status` is `error` or `missing`; else
  `shape.props.node.error` when it is a non-empty string. (Use `nodeRunState.get(editor)` via
  `useValue`, as the card already does.)
- Look: panel background `--tl-color-panel`, 1px border `--tl-color-danger`, left bar 3px danger,
  radius `--tl-radius-3`, shadow `--tl-shadow-2`, `IconAlert` in danger colour, title line
  "Run failed" (or "Input missing" for `missing`), message in `--tl-color-text-1`, font 0.8em,
  `white-space: pre-wrap`, max-height 8em with scroll inside, `user-select: text`.
- Actions (small, right side): Copy (copies the message), "Fix with AI" (`IconSparkle`, calls
  `openFillAssist(shape.id, { error: message })` — add an optional second argument to
  `openFillAssist` in `client/pipeline/assist.ts` that puts the error into the request text, e.g.
  prefill the ask box with `Fix this error: <message>`), Dismiss (`IconClose`, calls
  `clearNodeRun(editor, shape.id)` and, if the message came from `node.error`, does nothing more).
- Stop pointer events on the banner so clicks do not select or drag the canvas.
- The usage line (`NodeRunStatus`, "Running…" / token usage) still shows when there is no error.

### Engine: every failure reaches the run state

- In `client/pipeline/execution/ExecutionGraph.tsx`, check that a thrown error from any node's
  `execute` sets `setNodeRun(editor, id, { status: 'error', message })` with `err.message`
  (not `String(err)` with "Error: " prefix — strip it). Also when a node returns normally but its
  node has a non-empty `error` field after the run, set status `error` with that message.
- Nodes `text_tool`, `text_ai`, `code`, `summarize` store `error` and show it in their body result;
  keep that.

## Part D — Small polish

- The node title input (rename) uses the kit input look.
- `.NodeLlmStatus` styling: 0.75em, `--tl-color-text-3`, no background.

## Tests

- Add `tests/uiKit.test.ts` only for pure helpers if you create any (e.g. a `clipCell` helper for
  `UiTable`). React components need no tests.
- `npm run typecheck` and `npx vitest run` must pass.

## How the planner will check

- Every node card: footer shows Run, AI, Copy, Collapse, ⋯. Menu has Pin, Lock, Paste, text size,
  Clear.
- Selects in nodes open a tldraw-styled dropdown. No native select or browser-styled button left in
  node bodies.
- Make a "Fetch URL" (or any) node fail: the red banner appears under the card with the full
  message, Copy, Fix with AI, Dismiss.
- Light and dark theme both look right.
