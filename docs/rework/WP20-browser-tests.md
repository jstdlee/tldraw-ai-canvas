# WP20 — Automated browser tests (local only)

Read `RULES.md` first. Today all 450+ tests are unit tests; every UI check was done by hand. Add a
small Playwright suite that runs the real app in Chromium. **Local only:** do not add it to the CI
workflow (`.github/` stays untouched).

## Setup

- `npm i -D @playwright/test` — pick the version whose browsers are already in
  `~/.cache/ms-playwright` (chromium-1243 / chromium_headless_shell-1243 exist) so nothing new is
  downloaded; if no version matches, use `channel: 'chrome'` (Google Chrome is installed at
  /usr/bin/google-chrome). Do not run `npx playwright install`.
- `playwright.config.ts` at the repo root: `testDir: 'tests/e2e'`, one worker, `webServer` that
  starts the app on its own ports (web 5185, API 8795) with `DATA_DIR` set to a fresh temp folder
  (so tests never touch the user's data or canvases) and `reuseExistingServer: false`. Check how
  `npm run dev` / `dev:server` / `dev:web` take ports (API_PORT env; vite `--port`) and the Vite
  proxy target, and make the test server consistent.
- Script `"test:e2e": "playwright test"`. Vitest must not pick up `tests/e2e` (exclude it in the
  vitest config).

## Helpers (`tests/e2e/helpers.ts`)

The dev build exposes `window.editor`. Helpers: `freshCanvas(page)` (delete all shapes),
`addCard(page, title)` (click the library item), `wire(page, fromId, fromPort, toId, toPort)`
(create the connection shape + two bindings, as the app does), `run(page, id)` (import
`startExecution` via the dev module URL, or click the card's Run button), `nodeProps(page, id)`.
Prefer real UI interactions where they are stable (keyboard `/`, typing in the palette, clicking
Run); use `window.editor` for setup only.

## Tests (each independent, < 20 s)

1. **Insert:** press `/`, type "pivt", Enter → a DataPipe with op `pivot` exists, fontSize 16.
2. **Pipeline:** inline CSV DataPipe → Group (region, sum amount) → Chart (bar): run the Chart →
   upstream runs, group output has the right sums, chart `imageUrl` is set.
3. **Cache:** run the Chart again → footer shows "cached"; change the group op → that card re-runs.
4. **Wired field:** Prompt "S" wired into DataPipe filter `field:with` → output filtered by S;
   delete the wire → stored value used again.
5. **Group box:** select two chained cards → Ctrl/Cmd+Shift+P → one box with the expected ports;
   Open → members visible in a group; Close to box → members hidden again.
6. **Database (SQLite):** create a small .sqlite file in the test (sql.js in node, or a committed
   tiny fixture under tests/e2e/fixtures) → upload through the card's file input → tables listed →
   click a table → result rows.
7. **Formula preview:** DataPipe Formula column `round(amount * 1.2, 1)` shows a live preview line.
8. **Error banner:** a card that throws (e.g. URL card with an empty URL) shows the banner under the
   card with the message.
9. **Old canvas loads:** load a fixture snapshot that contains removed / legacy types (`sqlite_in`,
   `url_in`, an old chart with `kind,xCol,yCol` only, an old `subgraph` with `in0/output` ids) via
   `editor.loadSnapshot` → no crash, cards render.

No test may call a real AI model or the network (JEV re-rank off: set the smart-ranking
localStorage key to `off` in the test setup).

## Done when

`npm run test:e2e` passes locally twice in a row; `npx vitest run` and typecheck still pass.
Report the run time.
