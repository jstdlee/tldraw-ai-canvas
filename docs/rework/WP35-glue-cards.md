# WP35 — Glue cards: JSON fields, Extract from text, Template, For each rows; HTML form and Decision switch fixes

Read `RULES.md`, then `docs/review/2026-10-18/gaps.md` §3.3 (components A, A2, B, C, F, Q) and the findings
below. New cards: follow how `TableViewNode.tsx` / `HtmlPreviewNode.tsx` were registered (registry, nodeGroups,
nodeCatalog, nodeDescriptions, nodeSpecs with chips, examples, wireFieldCoverage, improvements PORTS,
nodeRequiredFields.json, output-dots).

## New cards
- **A JSON fields** (`json_fields`, group Data): input `json` (text; also JSON inside a ```json fence) → one
  output per path in field `paths` (one per line: `value`, `topic`, `data[0].name`, `customer.country`; port ids
  `path:<slug>`, labels = path) + `rest`. Objects/arrays out as JSON text; missing path → empty + a warning row.
- **B Extract from text** (`extract`, group Text): input `text` → outputs `table` (CSV), `json`, `code`, `list`
  (one per line). Field `find`: auto / first table / first JSON / fenced block (+ lang) / bullet list; field
  `clean` (strip `**`, `%`, thousands separators in numbers). Finds the first Markdown table, csv/json code
  fence, JSON object/array, or bullet list in LLM / Agent prose; clear error when none.
- **F Template** (`template`, group Text): field `template` (long text) with `{{name}}` → one input port per name
  (`var:<name>`, any type); field `escape`: none / JSON / HTML / URL / CSV; images become data URLs (or `<img>` in
  HTML mode); `{{name|table}}` renders a table input as an HTML or Markdown table. Output `output` (text).
  Reuse the `{{vars}}` helper used by Generate text.
- **Q** Text tools op "Extract links": HTML + base URL → table `url,text`, relative links resolved, deduped.

## Changes
- **C For each over table rows**: `split` option "table rows" (header kept); `item` = the row as JSON, plus
  `row:<column>` outputs; new field `collect`: lines / joined / JSON array / **table (add column)** with
  `resultColumn` name — results added as a new column to the original table (row ↔ result kept; no result →
  empty cell). **GAPS-14** "JSON array items" must respect "Join with" (or document collect=JSON array).
  **UI-15** stray horizontal scrollbar in the For each footer.
- **A2 / GAPS-05** HTML form gets a `value` output (the clicked `data-value`, or the only field of a one-field
  form); `shared/decisionRoute.ts` `parseDecision` accepts a JSON object with a string `value` / `answer` /
  `choice`. **GAPS-06** named submit buttons: only the clicked submitter's name/value. **GAPS-16** a click on an
  unselected HTML form card is lost — the first click must count. **GAPS-15** invalid CSP in every preview/form —
  fix the policy string (check console). **FLOW-09** an Output downstream of a form waiting for a click spins with
  no hint — show "waiting for input in <card>" on the waiting chain. **UI-07** override fields tiny/low contrast.
- **AI-04** Decision switch "Auto" never resolves to Score; **AI-07** threshold/margin port anchors lost outside
  Yes/No mode.

## Tests
Unit for every pure helper (path extraction, extraction from prose with 8 real LLM-style fixtures, template
escaping, row collection, decision parsing). e2e: form → Decision switch routes by choice; Agent-like prose →
Extract → Chart; CSV → For each rows → (mock LLM or Text tools) → table with new column → Table view;
Template JSON escape → HTTP POST body (mock).
