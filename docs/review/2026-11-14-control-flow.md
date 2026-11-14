# Control flow and Code cards — review 2026-11-14 (WP45)

Cards: If / else, And / Or / Not (`logic`), Decision switch, Router, Merge, Sleep, For each, and
Code (TypeScript / JavaScript / Python). tldraw 5.6.0, branch `wp45`.

Method: small real flows built on the canvas by a Playwright probe spec (web :5203, API :8803,
fresh `DATA_DIR`), run through each card's own Run / Stop button, and the card fields and run
state read back after each run. The probe was then turned into the regression suite
`tests/e2e/control-flow.spec.ts`. Python was also run once online (opt-in test, see below).

**Counts:** 9 bugs (4 high, 5 medium/low), 6 missing features. All bugs and all 6 features are
fixed in WP45 (Part 2, at the end).

## Bugs (ranked)

### B1 (high) — A long For each freezes the window, and Stop cannot be clicked

`for_each` over `1..10000` with one If in the body took **53 s**, and the page did not answer at
all in that time (a Playwright `evaluate` waited the whole 53 s; the Stop click did nothing). A
body made only of quick cards never awaits real work, so the whole loop ran as one microtask chain.
Progress was also written to the store on every item.

### B2 (high) — For each answers from the run cache when only its body changed

Run a For each, change a card in its body (Code: `toUpperCase()` → `+ "!"`), press Run on the
For each: the old result (`A BB CCC`) comes back. The loop card's cache key is its own settings and
inputs; the body is not part of it.

### B3 (high) — A repeated item in a loop body loses its result

For each over `a, a, b, a` with a Code body gives `A, B` instead of `A, A, B, A`. The second `a`
is a cache hit on the body card, and a cache hit answers with the card's stored output info. Inside
a loop that info is derived from the loop's idle `item` port, which is STOP, so the item "reached
no result" and was skipped. The same bug would end a While loop after its first pass whenever the
value repeats.

### B4 (high) — Nested For each: the inner body cannot read the outer item

Outer For each over `x, y`, inner For each over `1..3`, body Code `a + b` with `a` = outer item and
`b` = inner item. Expected `x1x2x3 / y1y2y3`; got empty lines. The inner loop runs its body in a
fresh child graph that does not contain the outer card, so the body read the outer card's idle
output (STOP) and never ran.

### B5 (medium) — Code: Stop does not stop a run, and the time limit is fixed

`while (true) {}` in a Code card: the window stays responsive (the code already runs in a Web
Worker), but Stop leaves the card "running" until a fixed 15 s limit (Python: 120 s). There is
no field for the limit.

### B6 (medium) — Decision switch fails silently, and misreads true / false and numbers

| Input | Mode | Before |
| --- | --- | --- |
| `""` (empty) | auto / choice | routed to "other", status ok |
| `true` / `false` | auto | routed to a choice called `true` / `false` |
| `0.8`, `75` | auto | routed to a choice called `0_8` / `75` |
| `true`, `false`, `0.8`, `75`, `banana`, `{"a":..}` | yes/no | red "failed" badge, **no message** |
| `yes`, `true`, `banana` | score | red "failed" badge, **no message** |

### B7 (medium) — Joining both If branches straight into one card skips that card

`If.then → Output.input` and `If.else → Output.input`: the Output never runs, with no status. The
engine settled the card as "not taken" as soon as one wire into the port was STOP, even though the
other wire delivered. (With a Merge card in between it worked.)

### B8 (low) — Merge with no delivered branch shows as failed or waits forever

A Decision switch picks an output that is not wired into the Merge: mode "all" ran with nothing
and showed a red badge with no message; mode "first" never settled, so a card after it (another
Merge) could wait forever.

### B9 (low) — Smaller logic and Code issues

- If / While number tests read an empty value as 0 (`"" < 5` was true).
- `isTruthy`: `"0.0"`, `"-0"` were true; `"[]"` and `"{}"` were true (`[] OR {}` = true).
- If `equals`: `"5"` did not equal `"5.0"`.
- Code that returns nothing: red badge with no message.
- Code errors had no line number (`Cannot read properties of undefined (reading 'deeper')`); a
  syntax error read `Unexpected token (3:1)`.
- Python: `print()` output was lost when the code failed; Pyodide was loaded again on every run
  (the worker was thrown away after each run); offline, the error was the raw
  `Failed to execute 'importScripts' … failed to load` text.
- Router (legacy, hidden): its input dot was a painted span, not a real port, so it could not be
  dragged; the spec said it "sends one input to one of several outputs", but it copies to all.
- AI spec for If: `between` missing from the condition list; `test` described as "overrides the
  operand" (it replaces the tested value).

## What works

- If: the taken branch runs; the untaken branch's cards do not run (no run entry) and anything
  after them settles. If → both branches → Merge → card: the card runs **once** per run, in
  "first" and in "all" mode. Sleep on the untaken branch never starts.
- Else-if as a chain of Ifs on "else" works (it was only not documented).
- Logic: and / or / not / xor / nand all behave; "false", "no", "0", "off", empty are false,
  case-insensitive.
- For each: lines / separator / range / table rows; collect lines / joined / JSON / table; If inside
  the body with "No result" skip / keep / error; the 10 000-item cap with a clear message; Stop
  during a Sleep in the body.
- Code: inputs, several outputs, objects and arrays as pretty JSON, `console.log` in the result box,
  the value used by the next card; JS / TS run in a Worker, so an endless loop never froze the window.
- Python offline: fails fast (not a hang), just with an unclear message.

## Missing features (expected by a user)

1. **While loop** — no way to repeat until a condition changes.
2. **Else-if** — possible, but nowhere said.
3. **Code timeout field and Stop** (see B5).
4. **Code error line numbers** (see B9).
5. **Python offline message** that says what to do.
6. **Loop progress and Stop** that work on long loops (see B1).

Not done (out of scope): bundling Pyodide for true offline Python; showing a "branch not taken"
marker on the cards of an untaken branch (they keep their last value and show no run badge).

## Part 2 — what WP45 changed

| Finding | Fix |
| --- | --- |
| B1 | `LoopPacer` (`execution/loop.ts`), shared by For each and While: gives the browser a turn every ~30 ms (MessageChannel, not throttled in background tabs), checks Stop before and after every item, writes progress ~10x a second. With 10 000 items the window stays responsive (a main-thread task waits < 500 ms) and Stop ends the loop in under 2 s (e2e). |
| B2 | `for_each` and `while` are in `NO_CACHE_NODE_TYPES` (`shared/runCache.ts`). |
| B3 | Loop body graphs run with `noCache` (`runLoopBodyPorts`). |
| B4 | `execution/loopContext.ts`: a running loop publishes its current port values; the engine reads them for a source card outside the graph. |
| B5 | Code card `timeoutSec` (optional field, default 10 s, 0.1–600); JS and Python runs take the run's AbortSignal and end their Worker at once on Stop (status "stopped"). |
| B6 | yes/no reads true/false/y/n and a number 0–1 (or 0–100) as P(yes); auto reads true/false as yes/no and a plain number as a score; an empty or unreadable decision throws a clear message (`decisionProblem` in `shared/decisionRoute.ts`). |
| B7 | The engine groups wires per input port; a port settles as "not taken" only when every wire into it is STOP. |
| B8 | Merge settles as "not taken" (no badge, cascades) when every wired branch settled without a value, in every mode. |
| B9 | `asNumber` ("" is NaN), `isTruthy` (numeric zero, `[]`, `{}`), numeric `equals`; Code "returned nothing" message; errors read `Line N: message` (JS stack mapped through the `new Function` header, sucrase keeps lines; Python compiled as `<code>`); Python keeps `print()` output on errors, keeps one loaded worker between runs, has a 90 s load limit and a download message; Router uses a real `PortRow`; If spec fixed. |
| While | New card `while` (Flow & code): Start value → condition (same list as If) → body via `value` and `iteration` ports → `result` (loop-back). Outputs: `output` (last value), `count`. **Max iterations** default 100, hard cap 10 000; hitting it ends the loop with a warning. "No result": end the loop (break) or fail. Runs through the same `runLoopBodyPorts` as For each. Spec, catalog, `/` insert, example `while-double`. |
| Else-if | Documented in the If card (tooltip on the sentence row), its description, the AI spec rules, and a new example `if-else-if-chain`. |

Python online was checked once with `E2E_PYTHON_ONLINE=1` (print, outputs, `Line 2: NameError …`,
logs kept on error, second run under 5 s, 1 s timeout on `while True`): passes. That test is
skipped by default because it downloads Pyodide.
