# WP27 — Menu arrows, long labels, Ctrl+P rows, If/else clarity, remove Summarize, DataPipe skip rows

Read `RULES.md` first. Owner feedback (2026-10-14).

## A. Scroll arrows in long menus
When a menu (UiSelect / UiMultiSelect / FallbackMenu in `client/ui/kit.tsx`, the tldraw context
menu and its submenus `.tlui-menu`, the Insert submenus) has more options than fit, show a small
**up arrow** bar at the top and a **down arrow** bar at the bottom while there is more to see in
that direction (hidden at the ends). Hovering an arrow scrolls smoothly; clicking scrolls one page.
The wheel and keyboard keep working. One shared hook/component, used everywhere a menu can
overflow. Light and dark theme.

## B. Long row labels
Card rows with a long label or long input text: labels get a **fixed width column** (same width
on every row of a card, e.g. 30–35 % of the card, ellipsis + full text as title), and text inputs
/ values **wrap** instead of overflowing (single-line inputs that can hold long text become
auto-growing textareas, max ~6 lines, then scroll). Look at `client/pipeline/nodes/types/fields.tsx`
(`WireField`, `PortRow`, `NodeRow`) and the CSS in `client/pipeline/index.css`. Port dots must
stay on their rows (WP17 anchors measure the row — check `tests/e2e/output-dots.spec.ts`).

## C. Ctrl+P palette
Owner: "the first four options look ugly and do not match the other options". Open the command
palette (`client/shell/ShellChrome.tsx`), find the first four rows (probably special/pinned rows
with their own markup), and render them with the same row component and style as the rest
(icon, title, hint, shortcut). Screenshot before/after in the report.

## D. If / else clarity
Owner: "the if-else logic is really confusing". Review the If card (`LogicNodes.tsx`) and
`shared/logic.ts` `evaluateCondition`:
- operators in plain words grouped (Text: equals, contains, starts with, matches regex; Number:
  >, ≥, <, ≤, between; Empty / not empty; true/false), with a one-line hint per operator;
- the card reads as a sentence: "If **input** *is greater than* **5** → then / else";
- outputs labelled "then (yes)" and "else (no)", and after a run the taken branch is highlighted
  with the value shown;
- operand hidden when the operator needs none.
Add 3–4 examples in `shared/examples.ts` (e.g. route long texts to a summary, flag numbers above a
threshold, If inside For each, a regex check) and update `nodeSpecs` / `nodeDescriptions`.
Keep old saved If cards working (same stored operator ids, or map old ids).

## E. Remove the Summarize card
It duplicates Text AI / Generate text. Remove it from the library, search, insert menus, AI
catalog (`nodeSpecs`, `nodeCatalog`, cardSearch, examples, nodeGroups) and any paste target.
Old canvases must still load: keep the type registered as a removed/hidden card (like other
removed types — see `RemovedNode.tsx` and `tests/e2e/legacy-canvas.spec.ts`), or map it to Text AI
with the same settings if that is simple and safe. Update tests that list it.

## F. DataPipe: skip rows
New DataPipe ops in `shared/tableOps.ts` (+ UI, nodeSpecs, wireFieldCoverage):
- **Skip first N rows** (`n`, default 1) — data rows after the header;
- **Skip rows matching** a regular expression (`pattern`, optional `column`: empty = any cell;
  flag "case-insensitive"); invalid regex → clear error.
Unit tests in `tests/tableOps.test.ts`.

## Tests
Unit for D (`evaluateCondition` new ops) and F. e2e: a long select shows the down arrow, scrolls,
then the up arrow; long label row wraps and the port dot stays on its row; If card branch
highlight; Summarize not in search but an old canvas with one loads.
