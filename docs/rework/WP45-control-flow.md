# WP45 — Review and fix control flow and code cards

Read `docs/rework/RULES.md` first. tldraw is 5.6.0.

## Goal

The user asked for a review of the flow cards: if / else, loops (for, while), switch / route, and
the custom code card (JavaScript / TypeScript and Python). Find what is broken or missing, fix it,
and add what is missing. Write the findings first, then fix.

## Part 1 — Review (write `docs/review/2026-11-14-control-flow.md`)

For each card below, build small real flows on the canvas in an e2e spec and run them. Record
what works, what fails, and what a user would expect but cannot do. Cards (see `shared/nodeSpecs.ts`
and `client/pipeline/nodes/types/LogicNodes.tsx`, `DecisionSwitchNode.tsx`, `CodeNode.tsx`,
`UtilityNodes.tsx`, `MergeNode.tsx`):

- `if`: then / else branches; the branch that is not taken must stop (`STOP_EXECUTION`), and a card
  after an if with both branches joined (through Merge) must run once.
- `logic`, `decision_switch`, `router`: each mode; what happens with an empty input, a number in a
  string, `true`/`"false"`, JSON.
- `for_each`: rows mode, number range mode, collect; nested for_each; for_each with an if inside;
  very large ranges (is there a cap, does Stop work, does the UI freeze).
- `code` in JS/TS and Python: inputs, outputs, errors with a line number, a timeout for an endless
  loop, `console.log` / `print` output, returning objects and tables, using the result in the next
  card. Python loads Pyodide from `cdn.jsdelivr.net`: record what happens offline (the app is meant
  to work offline).
- `merge`, `sleep`: with branches that stop.

Rank the findings: bugs first, then missing features.

## Part 2 — Fixes

Fix every bug from Part 1. Also add these features (they are expected and missing):

1. **While loop.** A new card `while` in the Flow & code group: runs its body sub-flow again while a
   condition is true, with a required **Max iterations** field (default 100, hard cap 10 000), an
   iteration counter output, and the last value output. Model it on `for_each`: read how for_each
   runs its body, reuse that engine, do not write a second loop runner. Add the spec to
   `shared/nodeSpecs.ts` (so the AI catalog, `/` insert and Build know it) and an example in
   `shared/examples.ts` if for_each has one.
2. **Else-if.** If the `if` card has no way to chain conditions, allow a chain of `if` cards on the
   else output to work and document it in the card help; do not add a new card for it.
3. **Code card timeout and stop.** JS and Python runs stop after a timeout field (default 10 s) and on
   the Stop button. An endless loop must not freeze the window (run JS in a worker if it does not
   already).
4. **Code card errors** show the line number and the message in the card's error banner.
5. **Python offline.** If Pyodide cannot load, the error says that Python needs one download and how
   to get it; do not hang. (Bundling Pyodide is out of scope.)
6. **Loop progress and Stop**: for_each and while show progress and stop at once on Stop.

Schema rule: new fields are optional; new node types are added the normal way; nothing is removed.

## Tests

- E2E `tests/e2e/control-flow.spec.ts` covering every flow from Part 1 that now works, plus while,
  timeout, Stop and the Python-offline message (block `cdn.jsdelivr.net` with `page.route`).
- Unit tests for any pure logic you add in `shared/`.

## Done means

`npx tsc --noEmit -p .` clean, `npx vitest run` green, your spec passes with
`CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=2000 E2E_WEB_PORT=5203 E2E_API_PORT=8803 npx playwright test tests/e2e/control-flow.spec.ts`
plus any existing spec you changed. Do not run the whole e2e suite. Do not commit.
