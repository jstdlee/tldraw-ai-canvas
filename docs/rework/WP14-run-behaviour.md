# WP14 — Run behaviour: pull stale inputs, cache, model health

Read `RULES.md` first. Engine: `client/pipeline/execution/ExecutionGraph.tsx`,
`executionState.ts` (`startExecution(editor, ids)`), run state `nodeRunState.ts`.

## Part A — Run pulls stale upstream cards

Pressing Run on a card (or Enter in an LLM card) must first run every **out-of-date** card
upstream of it (`isOutOfDate` on the shape or an out-of-date input), in dependency order, then
the card, then (as today) downstream cards that depend on it. Up-to-date upstream cards are not
re-run; their stored outputs are used. Group boxes count as one card. Loops (`for_each`) keep
their current behaviour. Show "Running 3 cards…" in the footer while it runs.

## Part B — Input-hash cache

Each run stores `lastRunHash` on the node (optional field on the shape props, not inside
`node`): a hash of the card type, its settings (all `node` fields except result keys), and its
input values. When Run would execute a card whose hash equals `lastRunHash` and whose outputs
are present, skip it and keep the outputs (run state `ok`, footer shows "cached"). Cards with
side effects or time dependence never cache: `http`, `download`, `save`, `camera`, `capture`,
`random`, `sleep`, `chat`, `image_gen`, and any formula using `today()`. A footer menu item
"Run without cache" forces a run. Hash: a fast 53-bit string hash (FNV-1a over JSON), in
`shared/runHash.ts`, tested.

## Part C — Default-model health check

On app start and when AI providers is opened: `GET /api/models/health` tests each default
(agent, chat, vision, jev, image) with a tiny request (chat: 1-token completion; jev: one
yes/no question; image: skip, only check the model is listed) with a 10 s timeout, cached 10
minutes. Result: `{ capability: { ok, model, error? } }`.
- AI providers dialog shows a status dot per default (green / red with the error).
- When a default fails, a small toast once per session: "Default chat model magpie/… is not
  available: <reason>. Open AI providers to pick another." with a button that opens the dialog.

## Tests

`runHash.test.ts`; a pure helper `upstreamOrder(graph, target)` in `shared/` with tests
(diamond graph, already up-to-date nodes skipped, cycle guard).

## Planner check

Chain Read from → DataPipe → Chart: change the DataPipe op, press Run on the Chart → DataPipe
reruns, Read from is cached. Point a default at a missing model → toast + red dot.
