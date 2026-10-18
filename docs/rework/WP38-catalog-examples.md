# WP38 — AI catalog truth, examples that combine cards, Build with AI quality

Runs after WP33–WP37. Read `RULES.md` and `docs/review/2026-10-18/gaps.md` (GAPS-08, 09, 19, R) and
`flow.md` FLOW-07.

- **R / GAPS-08** The AI catalog (`shared/nodeSpecs.ts`, `shared/nodeCatalog.ts`) must match the real ports:
  generate (or test-diff) from each definition's real `getPorts()` for default state AND documented dynamic
  ports (`opt:<slug>`, `var:<name>`, `path:<slug>`, `row:<column>`, `in1..N`, JEV yes/no, Load image url, Code
  `in1..`), correct model port types; hide removed/hidden types (postgres). A test fails on any mismatch.
- **GAPS-09** Usage notes for the AI: For each "table rows" for CSV rows, AI text `option` vs `instruction`,
  HTML form `value`/`json` (not `output`), Extract after Agent/LLM prose, Template for JSON bodies, Merge after
  branches. Improve the Build with AI prompt with 3 worked multi-card examples.
- **FLOW-07** Random's spec lists 3 of 8 modes — all cards' enum values must match the real options (test).
- **GAPS-19** Examples: add ~8 examples that combine the new cards (the 10 pipelines from gaps.md §3.2 where
  they now work: CSV rows → AI → table; Agent → Extract → Chart; form → switch → Merge → Save; SQL → Template
  HTML report with chart; links → For each → summary table; search → table → chart; JEV → switch; batch images →
  Gallery). Remove examples that use hidden types. Every example runs in e2e (mock models).
- Re-run the 3 Build with AI goals from gaps.md (G1–G3) with the real model via Magpie
  (`antigravity/gemini-3.8-flash`) and report results; aim for 3/3 correct.
