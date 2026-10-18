# Review 2026-10-18 — area `gaps` (pipeline companions)

Question from the owner: do the new cards still miss companions, so that they can form usable pipelines?

Short answer: yes. Each new card works on its own. But the values between the new cards often have
the wrong shape: free text where a table is needed, a JSON object where a choice is needed, a list
where a table is needed, an image where text is needed. Today the user fixes this with Text tools
tricks, Table view as a converter, or Code. Six small changes remove most of that friction
(see section 3.3, "Minimum set").

Evidence folder (screenshots, logs, raw results): `/tmp/claude-1000/-home-leilei-dev/b748c873-b27f-4f05-99d7-ad20f0decaac/scratchpad/review/gaps/`
(`results.jsonl` holds the raw result of every run; `inventory.json` holds the real ports of every card).
Specs: `tests/review-tmp/gaps/` (own config, ports 5206 / 8836, fixture web server on 18836, fake MCP research server).

## 1. Summary

What I tested:

- Inventory of all 47 registered card types (5 hidden legacy): real ports and data types (read from the live definitions),
  compared with `shared/nodeSpecs.ts` (Build with AI catalog) and `shared/nodeCatalog.ts`.
- 10 realistic end-user pipelines, built with the test helpers and run for real (Magpie models,
  mocked search, local web server, real MCP stdio server). About 30 model calls in total.
- 3 "Build with AI" goals (one sentence each), applied and run.
- 13 deterministic repros (no model calls) for the problems found.

Results: 10 pipelines built. 4 work (with small friction: P5-P8), 3 work only with a detour card or setting
(P1, P4, P10), 3 break at a missing companion (P2, P3, P9). Build with AI built 1 of 3 goals correctly.

Counts by severity: P0 = 0, P1 = 11, P2 = 8.

Top 5 problems:

1. **GAPS-01 (P1)** An empty upstream value makes Chart, DataPipe and Table view silently use their built-in
   sample table (Ada/Lin). The user sees a chart of fake data, and the fake rows flow on.
2. **GAPS-02/03/04 (P1)** Agent card: the wired `model` port is ignored; a keyless provider (Magpie, Ollama,
   ad-hoc Model provider) fails with "No API key for provider: openai"; an error on the last allowed
   step becomes a "successful" answer "(no answer) (Stopped: reached the step limit.)".
3. **GAPS-05/06 (P1)** HTML form → Decision switch does not route: the switch reads the form JSON as one
   unknown label ("other"; in auto mode it even creates a junk output `opt:clicked_yes_value_yes`).
   A form with named submit buttons reports every button value, not the clicked one.
4. **GAPS-08/09 (P1)** The Build with AI catalog disagrees with the real ports: it rejects valid wires
   (Model provider → Generate text / AI text / Chat; Decision switch choice outputs; JEV yes/no;
   Load image url) and accepts invalid ones (`var:*` on Agent, Code ports `a..d`, rows on built-in DBs).
   2 of 3 goals produced a wrong pipeline.
5. **GAPS-07/10 (P1)** Shape conversions lose data or fail: nested JSON cells become `[object Object]`;
   a one-column list (For each output, a JSON array of strings) is "not a table"; an LLM/Agent answer
   with a Markdown table plus prose is "not a table".

## 2. Findings (ranked)

Each finding was reproduced at least twice unless marked otherwise.

### GAPS-01 — P1 — Empty upstream input silently becomes the sample table
- Steps: Prompt → Text tools (regex that matches nothing, output `""`) → Chart, DataPipe (sort), Table view. Run.
- Expected: the cards stop with "No rows from text_tool" (or show nothing).
- Actual: all three run "ok" on the default sample table `name,city,score / Ada,Paris,3 / Lin,Oslo,5`.
  The chart shows two bars. DataPipe and Table view output the sample rows downstream. The same happens
  when the upstream card fails (Agent → failed DataPipe → Chart still shows the sample chart).
- Evidence: `r02-chart-sample-fallback.png`, `p02-agent-research.png` (Chart on the right), `results.jsonl` R2.
- Cause: `getInputText(inputs, 'data') || node.text` with a non-empty default `text`
  (`client/pipeline/nodes/types/DataNodes.tsx:194, 1096, 1483`, `TableViewNode.tsx:92`; default `text: SAMPLE`).
- Fix: when the `data` port is wired, never fall back to `node.text`; throw "No table from <source>".
  Do not seed `text` with sample data on new cards (use a placeholder instead).

### GAPS-02 — P1 — Agent ignores its wired `model` port
- Steps: Model provider (base URL + model) → Agent.model, or Prompt with a model key → Agent.model. Run (request mocked).
- Expected: the run uses the wired model.
- Actual: the request body has no `model` (`sentModels: [null, null]`); the card still shows "Default: Gemini 3.8 Flash".
- Evidence: `results.jsonl` R9 (2 runs) and P2 (2 runs), `p02-agent-research.png`.
- Cause: `AgentNode.tsx:142` sends `node.model`; `getInput(inputs, 'model')` is never read. The spec says the port
  "Overrides the model field when wired" (`shared/nodeSpecs.ts:988`).
- Fix: `model: coerceToText(getInput(inputs, 'model')) || node.model || undefined`, and show the wired source in the Model row.

### GAPS-03 — P1 — Agent refuses keyless OpenAI-compatible providers
- Steps: provider with empty API key (the review's Magpie config; also any Ollama / LM Studio / keyless Model provider). Agent task "say ok", Max steps 12.
- Expected: same as every other AI card (AI text, Generate text, JEV all ran keyless).
- Actual: "No API key for provider: openai". Reproduced 2× (P2 first run, R10 with 12 steps).
- Cause: `server/index.ts:259` passes `provider.apiKey` straight to pi-ai. `server/llm.ts:20`
  (`apiKeyOrLocalPlaceholder`) already solves this for the other cards.
- Fix: use `apiKeyOrLocalPlaceholder(provider)` for the agent; same for ad-hoc Model provider refs.

### GAPS-04 — P1 — Agent hides the error of the last allowed step, and a step-limit stop counts as success
- Steps: same as GAPS-03 with Max steps 1.
- Expected: run fails with the provider error.
- Actual: status "ok", output `(no answer)\n\n(Stopped: reached the step limit.)`, which downstream cards consume as data. 2 runs.
- Cause: `server/agent/runner.ts:142` ignores `agent.state.errorMessage` when `stoppedReason === 'steps'`; line 146 emits `final` with the placeholder.
- Fix: report the error when one exists; when the limit is hit with no answer, throw "Agent hit the step limit
  (N) before it answered" so downstream cards stop; keep the partial answer only when there is one.

### GAPS-05 — P1 — HTML form JSON cannot drive a Decision switch
- Steps: HTML form (buttons `data-value="yes|no"`) `json` → Decision switch `decision` (mode choice, options `yes`/`no`). Click "Yes", then "No".
- Expected: value routed to `opt:yes`, then `opt:no`.
- Actual: both clicks go to `other`. In auto mode the switch creates a junk output `opt:clicked_yes_value_yes`.
  Works only with Text tools → "JSON value" `value` in between (P3 attempt B).
- Evidence: `results.jsonl` R3, P3; `p03-form-route-A.png`, `p03-form-route-B.png`.
- Cause: `shared/decisionRoute.ts:21-41` only reads JSON objects of numbers (JEV probs); any other object becomes one plain-text answer.
- Fix: in `parseDecision`, when the JSON object has a string `value` (or `answer`/`choice`), use it as the answer.
  Also give HTML form a plain `value` output (the clicked value, or the single field of a one-field form).

### GAPS-06 — P1 — HTML form: named submit buttons report every value
- Steps: `<form><button name="style" value="short">Short</button><button name="style" value="formal">Formal</button></form>`. Click "Formal".
- Expected: `{"style": "formal"}`.
- Actual: `{"style": ["short", "formal"]}`. 2 runs. Build with AI wrote exactly this kind of form for goal G3.
- Cause: `shared/htmlPreview.ts:211` collects every `[name]` element, buttons included; the submit event's `submitter` is ignored.
- Fix: skip `button`/`input[type=submit]` in `fieldsFromForm`, then add `e.submitter.name = e.submitter.value` when present.

### GAPS-07 — P1 — Nested JSON becomes `[object Object]` in tables
- Steps: HTTP GET a JSON API `{meta, data:[{id, customer:{name,country}, total}]}` → Text tools JSON value `data` → Table view → DataPipe group by `customer.country`.
- Expected: nested fields kept (flattened as `customer.name`, `customer.country`, or as JSON text).
- Actual: column `customer` = `[object Object]` in every row; group by fails "No column named customer.country".
  Feeding the wrapped object directly fails: "Looks like JSON, but not a table".
- Evidence: `results.jsonl` R12 (2 runs).
- Cause: `shared/tableText.ts:17` `String(value)` for objects.
- Fix: flatten one or two levels to dotted columns (`customer.country`); stringify deeper values as JSON. Optionally accept
  `{ data: [...] }` / `{ results: [...] }` wrappers (one array property) as a table.

### GAPS-08 — P1 — Build with AI catalog does not match the real ports
`validatePlan` (`shared/aiPlan.ts`) checks wires against `NODE_SPECS`, so every mismatch below changes what the AI can build.
Verified with direct `validatePlan` calls (R7) and the live port inventory (`inventory-diffs.json`).

| Case | Spec says | Real card | Effect in Build with AI |
|---|---|---|---|
| Model ports of generate_text, text_ai, chat, image_gen, raw_model | `model:text` (`nodeSpecs.ts:256,282,302,544,873`) | `model:model` | "m.model (model) cannot feed g.model (text)": the AI can never wire a Model provider into these cards |
| Agent model port | wirable, "overrides the model" | ignored (GAPS-02) | the only accepted Model provider wire does nothing |
| Decision switch outputs | yes/no/unsure/other | choice mode: `opt:<slug>` + other; score: one per band | "opt:a is not an output": no choice routing |
| JEV outputs | output/probs/final | also `yes`, `no` (pass-through) | AI cannot use the yes/no gates |
| Load image inputs | none | `url` (text) | AI cannot load images from a list |
| Code ports | in `a,b,c,d`, out `output,out2,out3` | `in1, in2, …`, `output, out2…` (`shared/codePorts.ts:11`) | wires to `a` pass validation, then point to no port |
| Agent `task` | "Supports {{vars}}" (`nodeSpecs.ts:996`) | no `var:*` ports; no substitution | `var:topic` passes validation (any `var:*` is accepted, `aiPlan.ts:310,337`) and lands nowhere |
| text_ai.input, chat.attach, if.test, … | text / image | any | AI rejects Chart → AI text (the UI allows it) |
| Database `rows` | always listed | hidden and ignored for sqlite/pglite (`DatabaseNode.tsx:288-294`) | AI can wire rows into the default (pglite) card; nothing loads |
| postgres | not hidden in spec | hidden in the library (`cardSearch.ts:55`) | AI may add a card the user cannot find |
| html_form useWhen | "…for the next card (an If, a router, …)" (`nodeSpecs.ts:1060`) | router is a hidden legacy card; If/Switch need a JSON-value step | misleading advice |

- Fix: generate the AI port lists from the real definitions (or add a unit test like the inventory spec that diffs
  `getPorts()` against `NODE_SPECS` for default and per-mode props); document dynamic ports (`opt:<slug>`, `var:<name>`);
  reject `var:*` for types without template variables.

### GAPS-09 — P1 — Build with AI builds plausible but wrong pipelines for common goals
- G2 "Read the CSV …, summarise the review in every row with AI in one short sentence, save all summaries":
  plan HTTP → For each (`lines`) → AI text (`summarize`, instruction "one short sentence", option empty) → Save.
  Result: item 1 is the CSV header (an AI call that summarises "id,product,review"), and every answer is a
  "Three-sentence summary" because the empty option falls back to `3 sentences` (`TextAINode.tsx:52,86`) and
  conflicts with the instruction. 4 model calls instead of 3, wrong output. `p11-bwai-G2-ran.png`.
- G3 "Show three buttons (short, formal, funny) …": the plan wires `html_form.output` (the HTML document) into
  Generate text instead of `json`, puts the form in the HTML override while the default "Option A/B/C" text stays
  in the Text field, and uses named submit buttons (GAPS-06). It can never work. `p11-bwai-G3.png`.
- G1 (search → filter → bar chart) was correct and ran in 1 call. `p11-bwai-G1-ran.png`.
- Fix (catalog text, S): For each — "for table rows use Table view `json` → For each `json`" (or the new rows mode,
  proposal C); AI text — state each operation's option default and "put length/language in `option`";
  HTML form — "`output` is the page; the user's choice is `json`" (or proposal A2).

### GAPS-10 — P1 — A list cannot become a table
- Steps: Prompt `tagline\nPlain one\nPlayful two` → Table view; Prompt `["Plain one","Playful two"]` → Table view.
- Actual: "Looks like plain text, not a table" and "Looks like JSON, but not a table". 2 runs (R4, P9).
- Effect: For each results (lines, or JSON strings in json mode) and Generate image `images` cannot reach DataPipe,
  Chart, Table view, or Database without Code.
- Fix: accept a one-column CSV with a header; accept a JSON array of scalars as one column `value`.

### GAPS-11 — P1 — No visible card can feed a number field
- Steps: wire Prompt / Random / Text tools output into For each `From/To`, Web search `count`, Decision switch `threshold`.
- Actual: refused (`text → number` is not compatible, `client/pipeline/ports/portCompatibility.ts:11`).
  Only the hidden legacy Number card or `any` outputs (HTTP, Read from, Code, If, Sleep) can.
- Effect: "loop N times where N comes from a form or a table" and "search count from settings" need Code.
- Fix: allow `text → number` and coerce on run (the coercion already exists: `shared/fieldCoerce.ts`), error on NaN.

### GAPS-12 — P2 — Built-in databases cannot load wired rows
- Steps: Read from CSV → Database (Built-in Postgres) `rows`; SQL `select … from sales`.
- Actual: the rows port is hidden for SQLite and Built-in Postgres; run fails "relation "sales" does not exist".
  DuckDB with path `:memory:` works (load + query in one run, `p04-sql-report.png`), but the user must know to type `:memory:`.
  1 run; the hidden port is also visible in `inventory.json` and `DatabaseNode.tsx:288-294`.
- Fix: support `rows` → table for Built-in Postgres (create/replace table from CSV), or offer "DuckDB (in memory)" as a ready source.

### GAPS-13 — P2 — "Symbol(STOP_EXECUTION)" shown on untaken branches
- Steps: Prompt → If (contains "zzz") `then` → Generate text `input`. Run.
- Actual: the Input row of Generate text shows `Symbol(STOP_EXECUTIO…`. 2 runs (R6, P3 untaken branches).
- Evidence: `r06-symbol-stop.png`, `crop-p03-symbol.png`.
- Cause: `GenerateTextNode.tsx:212-214` uses `String(inputPort.value ?? '')`; `fields.tsx:62` already handles the symbol.
- Fix: reuse `preview()` from `fields.tsx` (same pattern also in `ChatNode.tsx:284,295`, `PromptConcatNode.tsx:156,167`, `AdjustNode.tsx:169`; Concat showed "connected" correctly).

### GAPS-14 — P2 — For each "JSON array items" ignores "Join with"
- Steps: `["a","b","c"]` → For each (json, Join with ` | `).
- Actual: output `["a","b","c"]` (a JSON array of strings). In P1 the "report" saved as `review-summaries.md` is a JSON array. 2 runs.
- Cause: `LogicNodes.tsx` `joinResults` (`node.split === 'json' ? JSON.stringify(results)`).
- Fix: make the collect format its own choice (lines / joined / JSON array / table), independent of the split mode.

### GAPS-15 — P2 — Invalid CSP in every HTML preview/form
- Actual: 13 console warnings "'img-src' contains the keyword 'none' alongside with other source expressions".
- Cause: `shared/htmlPreview.ts:62-65` builds `img-src data: blob: 'none'`.
- Fix: `img-src data: blob:` when network is off.

### GAPS-16 — P2 — A click on an unselected HTML form card is lost
- Steps: HTML form with buttons, card not selected; click a button twice.
- Actual: no submission (`lastSubmissionJson` stays null) after both clicks (R13, P3). After selecting the card, the first click works.
  (Driven by Playwright; a real mouse may behave slightly differently, but the iframe clearly ignores input while unselected.)
- Fix: let a running ("Waiting for input…") form take clicks without selection, or show "Select the card to answer" on hover.

### GAPS-17 — P2 — Save keeps the user's extension even when the content type differs
- Steps: Resize (PNG out) → Save `thumb.jpg`.
- Actual: files `thumb.jpg`, `thumb-2.jpg`, `thumb-3.jpg` contain PNG data (`file` says PNG, 200×300). Names cannot come from the source. 1 run (3 files).
- Fix: correct the extension (or convert), and allow `{{name}}`/`{{index}}` in the file name from wired inputs.

### GAPS-18 — P2 — No JSON-safe text building (webhook / API bodies)
- Steps: text with quotes and a new line → Text tools Template `{"text": "{{input}}"}` → HTTP POST to a local echo endpoint.
- Actual: the body is not valid JSON (`receivedJson: false`). No Text tools op escapes for JSON. 2 runs (R11).
- Effect: "send the AI summary to Slack/Discord/ntfy" cannot be built safely without Code.
- Fix: proposal F (Template with escape mode) or a "JSON string escape" op.

### GAPS-19 — P2 — Examples never combine the new cards; two examples use hidden types
- `shared/examples.ts`: Agent, Web search, HTML preview/form, Table view, Database each appear only as a 1-2 card demo.
  `url-summary` and `url-in` use the hidden `url_in`; `net-sql` uses the hidden `postgres`.
- Fix: add 5 small multi-card examples (the working pipelines below: P4, P5, P7, P8, P10).

## 3. Pipeline gaps

### 3.1 Compatibility matrix (compact)

What the values really contain. The port data type is `text` for almost all of them, so the canvas allows
the wire; the problem shows only at run time.

| Value kind | Produced by |
|---|---|
| CSV table | DataPipe, Database `output`, Table view `output`, Profile, Read from (CSV/XLSX) |
| JSON array of objects | Web search `results`, Table view `json` (all values become strings), Agent `steps`, HTTP (JSON APIs) |
| JSON object | HTML form `json`, JEV `probs`, HTTP (wrapped APIs), Model provider `model` (model ref) |
| Line list | Web search `urls`, Text tools extract_*, For each `output` (lines mode) |
| JSON string list | For each `output` (json mode), Generate image `images` |
| Free text / Markdown | Generate text, AI text, Chat, Raw model, Agent `output`, Web search `output` |
| HTML document | HTML preview `output`, HTML form `output`, HTTP (raw page) |
| Image | Chart, Load image, Camera, Capture, Crop/Resize/Filter, Generate image |
| File path | Save `output`, Download `output` (for files) |

Can it feed …? (Y = works directly; C = needs a converter card that exists, named; N = no card can do it)

| Value kind → | Table cards (DataPipe, Chart, Table view, Profile) | For each `list` | LLM input / `{{var}}` | Decision switch | HTML preview | Image cards | Number fields |
|---|---|---|---|---|---|---|---|
| CSV table | Y | C: header becomes item 1; use Table view `json` + For each json | Y | N | Y (raw CSV text) | N | N |
| JSON array of objects | Y (flat only; nested → `[object Object]`, GAPS-07) | Y (json) | Y | N | Y (raw) | N | N |
| JSON object | N ("not a table") | N | Y | N for form JSON (GAPS-05); C: Text tools JSON value | — | — | N |
| Line list | N (GAPS-10) | Y | Y | Y if one line | — | Y via For each → Load image `url` | N |
| JSON string list | N (GAPS-10) | Y (json) | Y | N | — | Y via For each json | N |
| Free text / Markdown | N with any prose; C: Text tools keep_lines `\|` / regex for a fenced block | Y (lines/paragraphs) | Y | Y (plain label) | Y (fragment) | N | N (type rule, GAPS-11) |
| HTML document | N | N | Y | N | Y | N | N |
| Image | N | Y (as `any`) | Y for Generate text / AI text `input`; N for Concat, Text tools, `{{var}}` of HTML/Template, HTML preview (`image → text` blocked) | N | N | Y | N |
| File path | N | Y | Y (as text only) | N | N | N (no card reads a local path) | N |

Dead ends (outputs nothing useful consumes): Save/Download `output` (local path; Read from has no path mode),
HTML form `output` (only Save), Agent `model` input (accepts, ignores), Database `rows` on built-in sources (hidden).

Inputs nothing visible produces: every `number` field port (GAPS-11); Decision switch `decision` from a form (GAPS-05);
a "table" from a list (GAPS-10).

Not in the catalog at all (no card or op): merge / wait-for-first of branches (no input accepts two wires,
`ConnectionShapeUtil.tsx:204-209`, no port sets `multi`), schedule / trigger, notify / send (only raw HTTP),
variables / state across runs, append to a file / log, call a saved group with inputs, extract a table/JSON/code
block from LLM text, resolve relative links, JSON-safe templating, image gallery / zip.

### 3.2 The 10 pipelines

Model calls: about 30 in total (26 requests from the app, of which 3 agent runs with 0-2 model turns each, plus 2 checks with curl), all through Magpie.
Note: the shared Magpie config's default model `opencode-go/deepseek-v4.1-flash` answers "This API key has expired";
my run's own copy used `antigravity/gemini-3.8-flash` as default (the app's error message was clear).

| # | Pipeline | Result | Where it breaks / what is awkward | What would fix it |
|---|---|---|---|---|
| P1 | CSV of reviews → AI summary per row → report file (Read from, Table view, For each, AI text, Save) | Works with a detour, 3 calls | For each `lines` treats the header as a row, so the user must find Table view `json` → For each `json`. The "report" is a JSON array of strings (GAPS-14) without id/product. Results cannot go back into the table as a column (DataPipe append: "not a table"). | C (rows mode + collect as table), H |
| P2 | Agent researches (MCP tool) → table → bar chart; steps → Table view | Breaks at Agent → DataPipe | Agent answers with prose + Markdown table (+ sometimes a csv code fence; the format changes per run): "Looks like plain text, not a table". Workaround: Text tools keep_lines `\|`. Chart then needs exact column names (`BEV Share (%)`). Model provider → Agent ignored (GAPS-02); keyless provider fails (GAPS-03); Chart shows sample data (GAPS-01). Steps → Table view works well. | B (extract table/JSON), E (answer format), agent fixes |
| P3 | HTML form (short/formal/funny) → Decision switch → one prompt per choice | Breaks directly; works with Text tools JSON value, 1 call | Form JSON → switch = "other" (GAPS-05). Card must be selected before a click counts (GAPS-16). Untaken branches show `Symbol(STOP_EXECUTION)` (GAPS-13). The 3 branch results cannot merge into one Output/Save. | A (value output / JSON fields), I (merge) |
| P4 | Sales CSV → Database (SQL group by) → Generate text (HTML report, `{{data}}`) → HTML preview → Save; + Chart | Works via DuckDB `:memory:`, 1 call | Built-in Postgres/SQLite cannot load the CSV (GAPS-12). The chart image cannot go into the HTML report (`image → text` blocked); only Code could embed it. | F (template that accepts images/tables), DB rows on pglite |
| P5 | Blog index (HTTP raw) → Text tools extract URLs → For each → HTTP (readable text) → AI summary → Output | Works, 3 calls | Relative links (`/blog/x`, `x.html`) are dropped by extract_urls (only `https?://`); no link text. The digest loses which summary belongs to which URL unless the user adds a Template inside the loop. | Q (extract links), C (collect as table) |
| P6 | Image URL list → For each → Load image (`url`) → Resize (width 200) → Save | Works, 0 calls | Files named thumb, thumb-2, … with PNG data in `.jpg` (GAPS-17). The loop output is local paths: nothing shows them as a gallery or reads them back. | O (Save name template), P (gallery) |
| P7 | Customer message → JEV (angry?) → Decision switch → apology / upsell prompt | Works, 2 calls | Only the untaken-branch label bug (GAPS-13). The two branches cannot merge into one Save. | I (merge) |
| P8 | Web search (mocked) `results` → DataPipe filter score > 0.5 → formula domain → group by → Chart | Works, 0 calls | No URL/domain function in formulas: `split(url, "/", 3)` gave the path part (`blog`), not the domain; the user must guess the index. Group-by names the count column `count_*`; the Chart with Y column `count` still ran "ok" and showed an empty Y selector instead of an error. | small formula/op additions |
| P9 | For each range 1..3 → Generate text `{{n}}` → collected variants → table | Generation works (3 calls); table step breaks | Range bounds cannot come from a Prompt/form (GAPS-11). The collected lines cannot become a one-column table (GAPS-10). | G, H |
| P10 | HTML form (topic, tone, name) → 3× Text tools JSON value → Web search `{{topic}}` → Generate text with 4 `{{vars}}` → HTML preview → Save | Works, 1 call per submit | One Text tools card per form field (3 extra cards). Re-submit re-runs everything once (good). Cannot send the brief anywhere safely (GAPS-18) and cannot run it every morning (no trigger). | A (JSON fields), F, K, L |

Build with AI (one-sentence goals, model `gemini-3.8-flash`, 7 calls including 4 run calls):

| Goal | Plan | Ran |
|---|---|---|
| G1 = P8 "Search … keep score > 0.5 … bar chart of score by title" | Correct: Web search `results` → DataPipe filter → Chart (title/score), 1 call | Yes, correct chart |
| G2 = P1 "Read the CSV … summarise every row … save" | Wrong: For each `lines` (header as item), length in `instruction` while `option` defaults to 3 sentences | Yes, wrong output (GAPS-09) |
| G3 = P3 "three buttons … rewrite in that style" | Wrong: wires `html_form.output` (HTML page) not `json`; named submit buttons (GAPS-06) | Not run (cannot work) |

### 3.3 Proposal — new and changed components, in priority order

Order rule: the smallest set that unlocks the most of the 10 pipelines (and the Build with AI goals) comes first.
Effort: S = up to 1 day, M = 2-4 days, L = a week or more.

**Tier 1 — do first (unlocks P1, P2, P3, P9, P10, G2, G3; removes most detour cards)**

| # | Component | Inputs → outputs | Fields | Behaviour | Example | Effort |
|---|---|---|---|---|---|---|
| D | Fix: no sample fallback on wired tables (GAPS-01) | — | — | Chart/DataPipe/Table view/Profile: wired + empty or failed → stop with "No table from <source>"; new cards start with an empty Text field and a placeholder | Agent fails → Chart shows "No table from DataPipe", not Ada/Lin | S |
| A | **JSON fields** (new card, or Text tools op upgrade) | `json` (text) → one output per path + `rest` | `paths` (one per line: `value`, `topic`, `data[0].name`, `customer.country`) | Parses JSON (also JSON inside a json code fence); each path → its own output port (like Decision switch options); objects → JSON text; missing path → empty + warning | Form `{topic,tone,name}` → 3 outputs in one card (P10 needs 1 card, not 3) | S |
| A2 | HTML form `value` output + Decision switch reads `{value}` (GAPS-05) | form → `value` (text) | — | `value` = clicked `data-value`, or the only field of a one-field form; `parseDecision` uses a string `value`/`answer`/`choice` property | Form → switch choice routes to `opt:formal` with no extra card | S |
| B | **Extract from text** (new card) | `text` → `table` (CSV), `json`, `code`, `list` | `find`: auto / first table / first JSON / fenced block (lang) / bullet list; `clean`: strip `**`, `%`, thousands separators | Finds the first Markdown table, csv/json code fence, JSON object/array, or bullet list in LLM/Agent prose; clear error when none | Agent "Here are the findings … \| Country \| Share \|" → CSV → Chart (P2 without tricks) | S-M |
| C | **For each: table rows + collect as table** (change) | `list` accepts a table; `item` = the row as JSON; new `row:<column>` outputs | `split`: + "table rows"; `collect`: lines / joined / JSON array / **table (add column)**; `resultColumn` name | Each row runs the body; results are added as a new column to the original table (row ↔ result kept); empty results keep the row with an empty cell | Reviews CSV → For each rows → AI text → table with `id, product, review, summary` → Save CSV (P1, G2, P5 url ↔ summary) | M |
| F | **Template** (new card) | one input port per `{{name}}` (any type) → `output` (text) | `template` (long text); `escape`: none / JSON / HTML / URL / CSV | Fills `{{name}}` from wired inputs (reuse `llmTemplateVars`); images become data URLs (or `<img>` in HTML mode); tables can render as an HTML/Markdown table with `{{name\|table}}` | `{"text": {{summary}}}` with JSON escape → HTTP POST to a webhook (GAPS-18); HTML report with chart image + table (P4) | S-M |
| E | Agent fixes + answer format (GAPS-02/03/04, catalog) | — | new `answerFormat`: text / table (CSV) / JSON; `{{vars}}` in task | Read `model` port; keyless placeholder; fail on step limit without answer; `{{vars}}` → `var:` ports like Web search; answer format adds a format instruction and validates (re-asks once) | Agent → table → Chart with no parsing card | S (fixes) + M (format) |
| R | Catalog truth (GAPS-08/09/19) | — | — | Generate AI ports from real `getPorts()` (or a test that diffs them); document `opt:<slug>`, `var:<name>`, JEV yes/no, Load image url, Code `in1..`; fix model port types; hide postgres; add usage notes (For each rows, AI text option, HTML form json); add 5 multi-card examples | Build with AI can wire Model provider → Generate text and route a choice | S |

**Tier 2 — next (unlocks the remaining awkward parts of P4, P5, P6, P7, P9)**

| # | Component | Inputs → outputs | Fields | Behaviour | Example | Effort |
|---|---|---|---|---|---|---|
| G | Text → number wiring (GAPS-11) | text → number ports | — | Allow the wire; coerce at run; error "rangeTo must be a number, got 'abc'" | Form `count` → For each To | S |
| H | Lists as tables (GAPS-10) + flatten nested JSON (GAPS-07) | — | — | One-column CSV accepted; JSON array of scalars → column `value`; nested objects → dotted columns; `{data:[…]}` wrapper accepted | For each output → Table view; orders API → group by `customer.country` | S |
| I | **Merge** (new card) | `in1..inN` (any, N grows) → `output` | `mode`: first that arrives / all (join) / all as JSON | Runs when any (first) or all (all) connected branches finished; untaken branches (STOP) are skipped | 3 Decision switch branches → Merge → one Save (P3, P7) | M (engine STOP semantics) |
| Q | Text tools "Extract links" op | `input` (HTML) + `input2` (base URL) → table `url,text` | `a`: same-site only / all | Parses `<a href>`, resolves relative links against the base URL, dedupes | Blog index with relative links → For each (P5) | S |
| O | Save: name template + append + true extension | `input`, `name` vars → `output` path | `fileName` with `{{name}}`, `{{index}}`, `{{date}}`; `mode`: new file / overwrite / append | Extension follows content type; append mode writes a line/row log | `{{index}}-{{name}}.png` per loop item; daily log file | S-M |
| P | **Gallery** (new output card) | `images` (lines / JSON list / table column) → `output` (same list) | `columns`, `download as zip` | Shows N images as a grid; zip export | Batch resize results (P6), Generate image ×4 | M |
| DB | Built-in Postgres loads `rows`; "DuckDB (in memory)" preset | `rows` → table | `targetTable`, `loadMode` | Same plan as external sources | CSV → SQL with no setup (P4) | M |

**Tier 3 — new capabilities (turn pipelines into automations)**

| # | Component | Inputs → outputs | Fields | Behaviour | Example | Effort |
|---|---|---|---|---|---|---|
| K | **Trigger** (new source card) | → `tick` (timestamp text) | `every` (minutes/hours/daily at time), `on`: app open / manual | Starts a run of everything downstream while the app is open; shows next run; pauses with the run queue | Daily brief at 08:00 (P10) | M |
| L | **Send / Notify** (new card) | `message`, `title` → `output` (status) | `channel`: webhook (Slack/Discord/ntfy) / email (SMTP from secret store) / desktop notification; `keyRef` | Builds a correct JSON payload per channel (no manual escaping) | Brief → Slack; "agent finished" → desktop note | M |
| M | **Variable** (set/get) | set: `value` → ; get: → `value` | `name`, `scope`: canvas / run | Keeps a value across runs (last seen id, counter) | "Only summarise new rows since last run" | M |
| N | **Run group** (call a saved group / My node) | group's inputs → group's outputs | `group` (picker) | Runs the saved sub-pipeline as one card, also inside For each | Reuse "summarise a page" in 3 pipelines | L |

Minimum set: D + A (+A2) + B + C + F + R. With these six, the 3 broken pipelines (P2, P3, P9) and the
3 detour pipelines (P1, P4, P10) run without Code or converter tricks, and Build with AI can express G2 and G3.
Still open after the minimum set: a range bound from a form (G), relative links (Q), merging branches (I),
schedules (K) and sending (L).

## 4. What works well

- Every new card works on its own, and several combinations need no glue: Web search `results` → DataPipe → Chart
  (P8), Agent `steps` → Table view, Table view `json` → For each `json`, JEV `probs` → Decision switch (P7),
  For each `item` → Load image `url` → Resize (P6), DuckDB `:memory:` load + SQL in one card (P4).
- `{{vars}}` on Generate text and Web search make multi-input prompts easy (P10: 4 inputs, one call, re-submit re-runs once).
- The HTML form submit → downstream re-run loop works without pressing Play again.
- Agent + MCP worked on the first try (tool call visible in the step list, 2 turns).
- Build with AI produced a correct, runnable 3-card pipeline from one sentence (G1).
- Error messages are mostly clear (expired provider key, "relation does not exist", "No column named …").
