# WP19 — Remaining safety defects from PHASE2.md

Read `RULES.md` first. The PHASE2 audit (`PHASE2.md`, section "P0 defects") predates the rework.
Already fixed and verified in code: EPIPE handler in `server/batchRoutes.ts runProcess`, fixed desktop
port 47201 in `electron/main.ts`, `Origin: null` blocked for mutating calls in `server/index.ts`,
For each surfaces the failing item, secrets stripped from AI prompts (WP7), Raw model key in the
server secret store (WP10). Do not redo those. Fix the rest:

## 1. HTTP card auth value out of the canvas

`client/pipeline/nodes/types/WebNodes.tsx`: `authValue` (bearer token / basic password / header
value) is a plain node field. Do what WP10 did for Raw model: new optional field `authRef`
(`secret:<id>`), the control becomes `UiSecretInput`; on first run an old `authValue` is moved to
the store and cleared; the server route that performs the request (`/api/http`, `server/http.ts`)
accepts `authRef` and resolves it with `resolveSecret`. `authValue` stays in the schema (old
canvases), `wire: false` stays.

## 2. Stop cancels in-flight work

Today Stop flips flags; model calls keep running and spending tokens.
- `client/pipeline/execution/executionState.ts`: each `startExecution` creates an
  `AbortController`; `stopExecution` (and a new run replacing an old one) aborts it. Export
  `currentRunSignal(editor): AbortSignal | undefined`.
- Client API helpers (`client/pipeline/api/pipelineApi.ts`: generate-text, chat stream, generate
  image, raw model, jev, http, db query) take an optional `signal` and default to
  `currentRunSignal(editor)` when called from a card's `execute` (pass the editor or the signal
  explicitly — choose the simpler wiring and apply it to every card that calls the server).
- Loops (`execution/loop.ts`) and group boxes (`SubgraphNode.tsx` nested `ExecutionGraph`) check
  the signal between steps and pass it down.
- Server: `/api/generate-text`, `/api/generate-image`, `/api/raw-model`, `/api/jev`, `/api/http`
  pass `c.req.raw.signal` to their outbound fetch / `generateText` so a closed client request stops
  the provider call. `/api/chat` already does.
- An aborted card ends with run status `missing`-style neutral state "Stopped" (not a red error).

## 3. Built-in Postgres must not silently lose data

`client/pipeline/pg.ts openDb`: on failure to open `idb://ai-canvas` it falls back to an in-memory
database with no message. Keep the fallback but set a module flag; the Database card (source
`pglite`) and the legacy Postgres card show a visible warning row "Built-in Postgres is running in
memory: data is lost on reload (<reason>)", and a toast is shown once per session.

## 4. MyGo port

Check `mygo/launcher.cjs`: if the server is started on a random port each launch, use the same
stable-port approach as `electron/main.ts` (preferred port, fallback only if taken). If it is
already stable, say so in the report.

## Tests

`tests/hardening.test.ts`: secret migration helper (pure part), abort helper behaviour if pure,
`resolveSecret` with `authRef`. Server route abort is not unit-testable — describe the manual check.

## Planner check

HTTP card with a bearer token → canvas JSON has only `secret:…`. Start a long Generate text and press
Stop → card shows Stopped, server log shows the request aborted. For each over 5 items with Stop after
item 2 → stops.
