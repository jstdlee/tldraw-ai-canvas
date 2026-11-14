# WP49 — Flow safety cards, Notify, and extensions

Read `docs/rework/RULES.md` first. tldraw is 5.6.0. Read how an existing card is built end to end
before adding one: `shared/nodeSpecs.ts`, `shared/nodeGroups.ts`, `shared/nodeCatalog.ts`,
`shared/nodeDescriptions.ts`, `client/pipeline/nodes/registry.ts`, `client/pipeline/nodes/types/LogicNodes.tsx`
(the WP45 `while` card is a recent full example), `tests/nodeRequiredFields.json`,
`client/pipeline/execution/ExecutionGraph.tsx`. Every new card must appear in the library, the `/`
insert palette, the AI catalog (so Build and the agent can use it) and the card help.

## New cards

1. **Try / catch** (group Flow & code). A body sub-flow like For each's body. Outputs: `output`
   (the body's result when it succeeds) and `error` (the error message text when any card in the
   body throws). Exactly one output is delivered per run; the other is STOP. Field: **Retries**
   (0–5, default 0) and **Wait between retries** (seconds, default 1). The cards in the body show
   their own error banners as usual.
2. **Ask user** (group Flow & code). Pauses the run and asks the user: field **Question** (text,
   `{{input}}` allowed), **Answer type** (Approve / reject, Choose one of options, Free text),
   **Options** (one per line). The card shows the question with buttons / input inside the card and
   also as a toast with "Go to card". Outputs: `answer` (the choice or text) and `rejected` (STOP
   unless the user rejected). Stop cancels the wait. A timeout field (minutes, 0 = wait forever).
3. **Variables**: two cards, **Set variable** (name, value input) and **Get variable** (name →
   output). Variables live in the canvas document (store them so they save with the canvas, e.g. a
   page meta map or a hidden record; pick the simplest that persists and undoes correctly). Scope:
   the whole canvas. Get runs after every Set of the same name in the same run (add the ordering to
   the execution graph). A small "Variables" list in the card help or main menu shows current values.
4. **Notify** (group Output). Field **Title**, **Message** (`{{input}}` allowed), **Sound** (on/off).
   Shows a desktop notification (Electron: `Notification`; web: the Notification API after asking
   permission once) and an in-app toast. Passes its input through.

## Extensions

5. **Offline Python.** The Code card loads Pyodide from `cdn.jsdelivr.net`. Bundle it: add the npm
   package `pyodide` (exact version 0.27.5 to match today, as a devDependency), copy its runtime files
   into the build (Vite `public/` or a build-time copy into `dist/pyodide/`), and load from the app's own
   origin. Keep the CDN only as a fallback when the local files are missing. Check the desktop build
   size impact and write it in the report. Common packages (numpy, pandas) may still download on first
   use; say so in the card help.
6. **HTTP card scrape mode.** A new option **Extract**: Full text (exists?), **Main article** (readable
   text, title, links), **CSS selector** (field: selector; output: list of matched texts / attributes as
   a table). Do this on the server (`server/`), reuse its existing HTML-to-text code; no new heavy
   dependency (a small HTML parser already in `node_modules` is fine; check first).
7. **Chart export.** Chart card footer: **Save PNG**, **Save SVG**, **Copy image**, and **Place on
   canvas** (as an image shape with a derived link). ECharts can render SVG and PNG; reuse the server
   SSR path that already makes PNGs.

Schema rule: new fields optional; new types added the normal way; add each new type to
`tests/nodeRequiredFields.json` as the other cards are.

## Tests

- Unit tests for pure logic (retry timing, variable ordering, answer parsing, selector extraction).
- E2E `tests/e2e/flow-safety.spec.ts`: Try/catch takes the error path when a Code card in the body
  throws, the output path otherwise, retries N times; Ask user approve / reject / choose / text and
  Stop; Set then Get across two branches; Notify shows a toast (mock `Notification`); Python runs with
  `cdn.jsdelivr.net` blocked; HTTP CSS-selector extract against a local test page served by the API
  test server or a `page.route` mock; chart Save PNG downloads a file and Place on canvas adds an
  image.

## Done means

`npx tsc --noEmit -p .` clean, `npx vitest run` green, your spec passes with
`CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=2000 E2E_WEB_PORT=5208 E2E_API_PORT=8808 npx playwright test tests/e2e/flow-safety.spec.ts`
plus `control-flow.spec.ts` and any spec you changed. Do not run the whole e2e suite. Do not commit.
