# WP33 — Agent card and AI providers: make them work for real

Read `RULES.md`, then the review reports in `docs/review/2026-10-18/` for each ID below (steps, evidence,
file:line causes are there). Fix the root cause of each, add a test per item.

## Must fix
- **AI-01 / FLOW-01 / GAPS-03 (P0)** Agent refuses keyless local providers ("No API key for provider").
  Use the same rule as `server/llm.ts` `apiKeyOrLocalPlaceholder` in `server/agent/model.ts` / `server/index.ts`.
- **AI-02 / GAPS-02** Agent ignores its wired `model` port (Model provider card → Agent). Read it like the
  other LLM cards do.
- **GAPS-04** The error of the last allowed step is hidden; a step-limit stop counts as success with
  "(no answer)". Step limit without a final answer = error status with a clear message; last step error shown.
- **AI-08** Agent status row always "Not run yet".
- **E (gaps.md §3.3)** Agent `answerFormat` field: text / table (CSV) / JSON. Adds a format instruction, then
  validates the answer (CSV via `parseTableText`, JSON via JSON.parse); if invalid, re-asks once; output is the
  clean CSV/JSON. Also `{{vars}}` in the task with `var:<name>` input ports (same mechanism as Web search /
  Generate text). Field optional (old cards = text).
- **AI-03 / UI-01 / UI-11** AI providers dialog: with ~20 models the model list overlaps "Default model" and
  Skills; rows become unclickable. Fix the layout (scroll areas, no absolute overlap) incl. minimum size.
- **AI-05** Skills "Rescan" always fails (415, unhandled rejection) and never refreshes.
- **AI-06** Raw model shows raw "fetch failed" — give a clear message (host, reason, hint).
- **UI-02** OpenRouter card shows a raw JS exception ("Failed to execute 'json' on 'Response'…") as its model
  dropdown text when the free-model fetch fails — show a short error state with Retry instead.

## Tests
Unit/integration for the keyless mapping, model port, answer formats (faux model), step-limit error. e2e for
the dialog with 21 models (no overlap: rows' bounding boxes do not intersect the next section; every row
clickable), Rescan, OpenRouter fetch failure (mock).
