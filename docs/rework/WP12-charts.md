# WP12 — Chart card

Read `RULES.md` first. Chart node: type `chart` in `client/pipeline/nodes/types/DataNodes.tsx`,
option builder `shared/chartOption.ts` (ECharts 6, already a dependency). Today: kinds bar /
line / pie, x column + comma list of y columns, dual axis. Keep every existing field; new fields
optional.

## Part A — Option builder (`shared/chartOption.ts`, pure, tested)

New signature (keep the old export working as a wrapper):
`buildChart(table, spec: ChartSpec): EChartsOption` with

```ts
interface ChartSpec {
  kind: 'bar' | 'hbar' | 'line' | 'area' | 'scatter' | 'pie' | 'donut' | 'histogram' | 'heatmap'
  x: string                  // category / x column (scatter: numeric x)
  y: string[]                // value columns (one series each)
  series?: string            // split into one series per distinct value of this column ("long" data)
  aggregate?: 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max'   // per x (and series) before drawing
  stack?: boolean            // bar / hbar / area
  dual?: boolean             // existing dualScale
  sort?: 'none' | 'x' | 'value-asc' | 'value-desc'
  top?: number               // keep the top N categories by value (rest summed into "Other" when otherRow)
  otherRow?: boolean
  bins?: number              // histogram
  title?: string; xLabel?: string; yLabel?: string
  labels?: boolean           // data labels on marks
  smooth?: boolean           // line / area
}
```

- `series` + `aggregate` make one card handle long data (`region, month, amount`) without a
  pivot first.
- Histogram: numeric `y[0]`, `bins` buckets. Heatmap: x, series (as y axis), value y[0].
- Dates in x are sorted as dates when every value parses.
- Colours: a palette passed in by the client from tldraw's theme colours
  (`getColorValue` for blue, orange, green, violet, red, light-blue, yellow, grey); axis and text
  colours from the theme for light and dark.
- Over 5 000 points: sample evenly and add a subtitle "showing 5,000 of N points".

Tests `tests/chartOption.test.ts`: each kind produces the right series types; series split;
aggregate; stack; sort + top N + Other; histogram buckets; date sort.

## Part B — Card UI

```
┌ Chart ───────────────────────────────────────── ● output
│ ● data   from "Group by region"
│ [Bar][Line][Area][Scatter][Pie][Hist][…]        ← UiSegmented with icons, overflow in a menu
│ X  [month ▾]   Y [amount ▾ +]   Split by [region ▾]
│ Summary [sum ▾]  Stack [✓]  Sort [value ↓ ▾]  Top [10]
│ ▸ Titles and labels                              ← UiSection: title, x label, y label, data labels, smooth
│ ┌─────────────────────── chart ────────────────────────┐
│ └──────────────────────────────────────────────────────┘
```

- Only the fields that apply to the chosen kind are shown (e.g. no Stack for pie).
- Column pickers list the real headers of the input; number columns first for Y.
- The chart area is the growing element (`NodeGrow`) and redraws on resize.
- Output port `output`: PNG of the chart (data URL stored in the image store) so it can feed
  Output, Generate image as reference, or be placed. ⋯ menu: "Place on canvas" (image shape
  beside the card, resizable) and "Copy as PNG".
- Empty / wrong input: `UiEmpty` with the reason ("Pick a number column for Y").

## Planner check

Group output (region, month, sum_amount) → Line split by region; Bar stacked; Pie top 5 with
Other; Histogram of amount with 10 bins; Scatter of two number columns; place on canvas; light
and dark.
