# WP16 — One type scale for cards and labels

Read `RULES.md` first. Owner feedback: "the font size of components and labels really need
improvement". Today `client/pipeline/index.css` alone uses about 15 different card font sizes
(0.74em ×29, 0.8em, 0.85em, 0.87em, 0.78em, 0.82em, 13px, 12px, 11px !important …), plus the kit's
own sizes in `client/ui/ui.css`, and the card base font is 20 px. Cards look uneven and too large.

## Part A — Tokens

Define on `.NodeShape` (card root) a small scale relative to the card font `--node-fs`
(the A−/A+ per-card setting still scales everything):

| Token | Size | Use |
|---|---|---|
| `--fs-title` | 1em, weight 600 | card title |
| `--fs-body` | 0.875em | field values, inputs, selects, buttons, table cells, results |
| `--fs-label` | 0.8125em, weight 500, `--tl-color-text-2` | field and port labels |
| `--fs-meta` | 0.75em, `--tl-color-text-3` | hints, row counts, usage line, badges |
| `--fs-mono` | 0.8125em, `--tl-font-mono` | code, SQL, formulas, CSV previews |

Line heights: body 1.4, labels 1.3, mono 1.45. One spacing scale for rows: row height
`2.25em` (was 44 px at 20 px), gap `0.5em`, card padding `0.75em`.

New-card default font: **16 px** (stored as `fontSize: 16` on create; cards without a stored size
keep 20 px so old canvases look unchanged). This supersedes WP15 item F2.

## Part B — Apply everywhere

- Replace every `font-size` inside card CSS (`client/pipeline/index.css`, `client/shell/shell.css`,
  `client/ui/ui.css` rules that apply in cards) with one of the five tokens. No `!important`,
  no px inside cards. Remove the compounding fixes added earlier (`.UiField .UiSelect-trigger
  { font-size: 1em }` etc.) — with tokens on each element nothing compounds.
- Kit components read the tokens when inside a card and fall back to tldraw sizes in panels
  (the sidebar, dialogs, Build panel keep tldraw's 12–14 px UI sizes).
- Port labels, `NodeInputRow-label`, `UiField-label`, segmented controls, badges, the footer
  (Run, time), the error banner, the usage line, result areas, tables, the Profile card — all on
  the scale.
- `NODE_ROW_HEIGHT_PX` and friends stay the source for geometry; compute them from the card font
  (`rowPx = round(fontPx × 2.25)`) so port dots stay on rows at any font size. Body heights from
  `getBodyHeightPx` must use the row helper, not literal 44.

## Part C — Check

A screenshot sheet: every card type at 16 px default, light and dark, at 100 % zoom — no clipped
labels, no overflowing rows, ports on their rows. The planner reviews the sheet.
