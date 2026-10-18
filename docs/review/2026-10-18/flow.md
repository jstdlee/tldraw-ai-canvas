# Flow review — 2026-10-18

Area: node cards and the execution engine (`client/pipeline/nodes/types/*.tsx`,
`client/pipeline/execution/*`, `client/pipeline/subgraph.ts`, `shared/examples.ts`). Driven end to
end through the real UI with Playwright (own ports: web 5204, API 8834) plus manual exploration.
Specs live in `tests/review-tmp/flow/*.spec.ts` (deleted after this review); raw result JSON and
all 125 screenshots are under
`/tmp/claude-1000/-home-leilei-dev/b748c873-b27f-4f05-99d7-ad20f0decaac/scratchpad/review/flow/`.

## 1. Summary

Tested: all 55 examples in `shared/examples.ts` (main menu → Examples → Play, the way a user
does it); every If condition operator plus branch highlighting and the "test" port override;
every For each split mode, all three `noResult` modes, a nested For each, Stop mid-loop, and the
progress bar; Decision switch (yes/no, choice, score, auto-detect) with its branch highlight;
Router; Logic (and/or/not/xor/nand); Code in TypeScript, JavaScript and Python; Number; Random
(all 8 modes, not just the 3 the AI spec documents); Group as box (pack/open/close), "Save as my
node" + inserting it back from the library, and running inside a box; and the execution engine —
run cache (upstream change, field change, wired-field override), upstream pull, Stop, the error
banner and its "Fix with AI" button, wire type compatibility (a real drag-and-drop simulation,
not just reading the code), field ports, undo/redo, copy/paste and duplicate with wires, delete
cleaning up wires, page switch, save/open canvas file round-trip, and an old v0.2.0-style canvas.

**140 of 140 automated checks pass** against the behavior actually shipped (a few early assertions
were wrong about what the UI does and were corrected after reproducing each discrepancy twice —
see each finding's "verified" note). The card-level logic (If, For each, Decision switch, Logic,
Code, Router, Random) is solid: every pure-logic case matched `shared/logic.ts`,
`shared/decisionRoute.ts`, `shared/random.ts` and `shared/codePorts.ts` exactly, with no
incorrect-value bugs found anywhere in this area.

**Counts by severity:** P0: 0. P1: 4. P2: 5.

**Top 5 problems:**
1. **FLOW-01** (P1) — Agent card can't call any provider configured with an empty key for a local/self-hosted router (e.g. this review's own Magpie setup), even though Chat, Generate text, Text AI, JEV etc. all work fine against the exact same provider.
2. **FLOW-02** (P1) — Every image-processing card rejects a same-origin relative image URL (`/examples/girl-base.jpg`); this silently breaks 4 of the 55 bundled examples (the whole "Image" showcase) with "Paste an image, upload one, or use an image URL."
3. **FLOW-03** (P1) — The "Chat message" example is broken as shipped: wiring a Prompt into Chat's "Reply to" port does not seed the chat's outgoing message, so running it always fails with "Type a message first."
4. **FLOW-04** (P1) — Stop cannot interrupt an in-flight Sleep card; the card runs to its full configured delay regardless, reporting "ok" instead of "stopped."
5. **FLOW-05** (P2, but high pipeline-gap impact) — "Group as box" exposes every unconnected field on every member as its own box port (by design — "Rule 1" in `shared/groupPorts.ts`), so packing two ordinary 2-field cards produces a 9-input box full of generic "Text to…" ports.

## 2. Findings

### FLOW-01 — Agent card fails against any keyless/local provider (P1)

**Steps:** Configure a provider with `kind: "openai"`, a custom `baseURL` pointing at a local,
no-auth router, and an empty `apiKey` (exactly this review's Magpie setup, and a normal way to
point the app at Ollama/LiteLLM/etc.). Place an **Agent** card with any task, press Run.

**Expected:** Same behavior as Chat/Generate text/Text AI/JEV against the same provider — it just
works, because the app already has a documented workaround for exactly this case.

**Actual:** `No API key for provider: openai`. Every other AI-calling card succeeds against the
identical provider in the identical run.

**Evidence:** `examples-all.spec.ts` → `agent-task` example, reproduced twice (full-run log and
isolated rerun). `docs/review/2026-10-18` screenshots not needed — the error is in
`runStatus`/`runMessage`, see `examples-results.json`.

**Suspected cause:** `server/llm.ts:9-23` documents exactly this scenario and fixes it for the
`ai` SDK path: `apiKeyOrLocalPlaceholder(provider)` substitutes a placeholder key when
`provider.apiKey` is empty but a custom `baseURL` is set (the SDK otherwise throws
`AI_LoadAPIKeyError` before the request is even sent). `getLanguageModel()` in that same file uses
it (`server/llm.ts:26-38`). But the Agent route builds its own `apiKey` independently:
`server/index.ts:258`
```ts
const apiKey = provider.apiKey || (provider.kind === 'cloudflare' ? provider.apiKey : undefined)
```
For `kind: 'openai'` with an empty `apiKey`, this evaluates to `undefined`, which is passed to
`runAgent()` (`server/agent/runner.ts:57`, `getApiKey: () => opts.apiKey`) and from there into
`pi-ai`'s model layer, which has no local-router workaround and throws.

**Suggested fix:** Replace the ad-hoc expression at `server/index.ts:258` with
`apiKeyOrLocalPlaceholder(provider)` (already exported from `server/llm.ts`), the same helper
`getLanguageModel` uses.

---

### FLOW-02 — Image cards reject a same-origin relative image URL; breaks 4 bundled examples (P1)

**Steps:** Main menu → Examples → **Filter look** (or **Crop and resize**, **Image tools and
adjust**, **Same girl, three outfits**). Press Run on the last card.

**Expected:** The bundled photo (`public/examples/girl-base.jpg`, confirmed present on disk and
served by Vite at `/examples/girl-base.jpg`) loads and the filter/crop/resize/tool runs on it —
these are the app's own curated demos of the entire Image card category.

**Actual:** `Run failed — Paste an image, upload one, or use an image URL.` on every downstream
image card. Reproduced on all 4 examples, twice each.

**Evidence:** `examples-results.json` (`image-look`, `image-frame`, `image-tools`, `wardrobe`);
screenshots `image-look-run.png`, `wardrobe-run.png`, `image-tools-run.png`,
`image-frame-run.png`.

**Suspected cause:** `client/pipeline/imageOps.ts:47-73`, `toImageUrl()` — the function every
image-consuming card (`image_filter`, `crop`, `image_resize`, `image_tool`, `adjust`) calls to
resolve its `image` input. It only accepts three shapes: `data:image/…`, `/api/images/…`, or an
absolute `http(s)://…` URL; anything else — including a perfectly reachable same-origin path like
`/examples/girl-base.jpg` — falls through to
`throw new Error('Paste an image, upload one, or use an image URL.')` (line 73). `load_image`'s
own `execute()` (`client/pipeline/nodes/types/LoadImageNode.tsx:77-87`) happily passes that exact
string straight through as its `output` when `node.source` is empty, which is exactly how all 4
examples set it up (`props: { imageUrl: '/examples/girl-base.jpg', source: '' }` in
`shared/examples.ts`).

**Suggested fix:** Either have `toImageUrl()` also accept a same-origin relative path (treat it
like the `http(s)://` branch — fetch/import it the same way), or change the example fixtures to
reference the images via `/api/images/…` or a full absolute URL instead of a bare `/examples/…`
path. The former also fixes it for any real user who wires a `load_image` with a typed relative
path.

---

### FLOW-03 — "Chat message" example is broken: wiring a Prompt into Chat's "Reply to" doesn't seed its message (P1)

**Steps:** Main menu → Examples → **Chat message**. Press Run on the Chat card.

**Expected:** Per the example's own blurb ("A prompt is the first message in a chat node") and
the wiring (`prompt.output → chat.parent`), the chat sends "Say hello in one short sentence." and
gets a reply.

**Actual:** `Message: Type a message first.` (shown in red on the card) — it never calls the
model at all. The Chat card's own `Message` field stays empty; the wired Prompt text has no
effect on it.

**Evidence:** `examples-results.json` (`llm-chat`); screenshot `llm-chat-run.png` shows the card
with "Reply to: conversation" ← wired from the Prompt, and a red "Type a message first." where
the message should be.

**Suspected cause:** `client/pipeline/nodes/types/ChatNode.tsx`. The "parent" port (labelled
"Reply to" in the UI) is for **conversation history**, not "this turn's message": per
`buildChatHistory()` (lines 159-183), a non-chat upstream node's value becomes an *earlier user
turn with no reply* (`turns.unshift({...EMPTY_TURN, userMessage: value})`, line 176) — not the
current card's own outgoing message. The actual message comes only from `node.userMessage`
(the card's own typed field), checked in `sendChat()`:
```ts
// client/pipeline/nodes/types/ChatNode.tsx:200-205
const { text: filledMessage } = fillLlmTemplate(node.userMessage, vars, inputs)
const userText = filledMessage.trim() || ...
if (!userText && !attachment) {
  updateNode<ChatNode>(editor, shape, (n) => ({ ...n, error: 'Type a message first.' }), false)
  return null
}
```
The example (`shared/examples.ts`, `llm-chat` step) never sets `userMessage` on the chat node —
it only wires the prompt into `parent` — so `node.userMessage` is always `''` and this always
fires.

**Suggested fix:** Either set the chat node's `userMessage` prop directly in the example instead
of (or in addition to) wiring `parent` (quick fix, makes the example work), or reconsider the
product behavior: a user who wires a plain text node into "Reply to" most likely expects it to
become *their* outgoing message, not a fabricated unanswered prior turn — worth a clearer label
than "Reply to" / "conversation" if the current semantics are intentional.

---

### FLOW-04 — Stop does not interrupt an in-flight Sleep card (P1)

**Steps:** Prompt → Sleep (ms: 2000) → Sleep (ms: 2000). Click Run on the first Sleep (it starts
executing almost immediately — its own footer button is the one that shows "Stop", not the one
you clicked if you started from further downstream; see FLOW-06). Click **Stop** right away,
well inside the 2000ms window.

**Expected:** The card's own run aborts promptly; footer shows "Stopped."

**Actual:** The Sleep card runs to the full 2000ms and reports **"ok"**, not "stopped" — clicking
Stop had no visible effect on it. (The chain-level behavior is still correct: the second Sleep,
downstream, never gets a run entry at all, because `startExecution` already tore the run down by
the time the first Sleep resolves.) Verified twice: once with a wall-clock measurement
(`sleep1FinishedAfterMs` ≈ 2945ms after the Stop click, i.e. it ran essentially to completion),
once via `getNodeRun` status.

**Evidence:** `engine-results.json`, case `stop-does-not-abort-in-flight-sleep`; screenshot
`engine-stop-chain.png`.

**Suspected cause:** `client/pipeline/utils/sleep.ts` — `sleep(ms)` is a bare
`new Promise(resolve => setTimeout(resolve, ms))` with no `AbortSignal` support at all. Its only
caller, `SleepNodeDefinition.execute()` (`client/pipeline/nodes/types/ToolNodes.tsx:154-157`),
never reads `currentRunSignal(this.editor)` (the signal `ExecutionGraph` already threads through
for exactly this purpose — see its WP19 Part 2 comment in `executionState.ts:13-16` about
aborting "every in-flight server call"). Since the promise never rejects, `ExecutionGraph`'s
`executeNodeIfReady` sees a normal successful resolution and records `status: 'ok'`.

**Suggested fix:** Make `sleep()` take an optional `AbortSignal` (reject early — or resolve early
with a sentinel — when aborted via `clearTimeout` + a `signal.addEventListener('abort', …)`), and
have `SleepNodeDefinition.execute` pass `currentRunSignal(this.editor)`.

---

### FLOW-05 — Group as box exposes every unconnected field as a port, not just the meaningful boundary (P2 / pipeline gap)

**Steps:** Wire Prompt → Text tools (trim) → Text tools (count word/char/line counts). Select the
two Text tools cards, press Ctrl+Shift+P ("Group as box").

**Expected:** A clean box with roughly the two ports that matter at the boundary (one text input
feeding the trim, one result output from the count).

**Actual:** The box gets **9 input ports** and 1 output port. Every member's every unconnected
field — "Input 2", "Tool", "Param A", "Param B" on *each* of the two Text tools cards — becomes
its own box port, each generically labelled "Text to…" (truncated). For any pipeline with more
than the most trivial single-port-per-node shape, the resulting box is visually noisy and hard to
read or wire up from outside.

**Evidence:** `groups-results.json`, case `pack` (`inputs: 9, outputs: 1`); screenshot
`group-box-packed.png` shows the wall of "Text to…" rows.

**Suspected cause:** `shared/groupPorts.ts:66-98`, `computeGroupPorts()`. Rule 1 (line 72):
*"hidden only when fed by another member"* — applied per-port, with no distinction between a
card's main data port and its settings/field ports (`field:<key>` ports exist for every wirable
field, per `WireField` in `client/pipeline/nodes/types/fields.tsx:229-261`). `toInnerPorts()`
(`client/pipeline/subgraph.ts:67-78`) feeds it literally every port `getNodePorts` returns for a
member, with no filtering.

**Suggested fix:** This is a real design trade-off (today you *can* still reach in and set, say, a
"Param B" from outside the box, which some pipelines genuinely want), so the fix is likely UX
rather than logic: collapse field-ports into a collapsed "Advanced" section on the box by default,
or let the user pick which ports to expose at pack time, or visually group same-node ports under
one label instead of repeating the truncated node label on every row.

---

### FLOW-06 — A Run-clicked card that's waiting on upstream work shows no "running" feedback on its own button (P2)

**Steps:** Prompt → Sleep(2000ms) → Sleep(2000ms). Click Run on the **second** (downstream)
Sleep's own footer button.

**Expected:** Some visible feedback on the card you actually clicked that a run is in progress
(busy state, spinner, "Stop" affordance, anything).

**Actual:** The clicked card's footer button reverts to showing **"Run"** again almost
immediately (not "Stop", not a busy indicator) and stays that way for the ~2s the upstream Sleep
is executing, because the button's label is driven by *that card's own* `getNodeStatus(shape.id)
=== 'executing'` (true only once the card itself starts), while the click *handler* correctly
uses the graph-wide "is anything running" flag (so clicking it again *would* still stop the whole
run — the mechanism is fine, only the label is misleading).

**Evidence:** `client/pipeline/nodes/NodeShapeUtil.tsx:299-309` (`isExecuting` is per-node,
`isGraphRunning` is global) vs. line 458 (`label={isExecuting ? 'Stop' : …}`) vs. line 460
(`onClick` uses `isGraphRunning`). Confirmed via the Stop test in `engine.spec.ts` needing to
target the *first* (actively executing) card's button rather than the one actually clicked to
start the run.

**Suggested fix:** Drive the footer label (at least a busy/spinner state, if not literally "Stop")
off `isGraphRunning` for any card that is part of the current run, not only the one presently
`executing`.

---

### FLOW-07 — Random node's AI-facing spec documents 3 of its 8 real modes (P2 / pipeline gap)

**Steps:** Compare `shared/nodeSpecs.ts`'s `random.fields` mode enum to `shared/random.ts`'s
`RANDOM_MODES` (what the card's own dropdown actually offers).

**Expected:** They match, so the "Ask AI" / AI-build flow can use every mode the UI has.

**Actual:** `nodeSpecs.ts` line 586: `field('mode', 'enum', 'Mode', …, ['number', 'pick',
'shuffle'])` — only 3 entries. `shared/random.ts:3-12` defines 8: `number, pick, shuffle, coin,
dice, uuid, password, color`. All 5 missing modes work correctly through the real UI dropdown
(verified directly — `logic-cards.spec.ts`: dice stays within `1..sides`, uuid matches the v4
format, shuffle is a true permutation, etc.) — this is a documentation/AI-context gap, not a
runtime bug: an AI-assisted canvas build (or the "Ask AI about this node" chip list) simply never
knows coin/dice/uuid/password/color exist.

**Evidence:** `logic-cards-results.json` (dice/uuid/shuffle cases all pass); direct file diff
above.

**Suggested fix:** Add the 5 missing ids (with short hints, matching the `CONDITIONS`-style
table already used for the If card) to `nodeSpecs.ts`'s `random` field enum.

---

### FLOW-08 — A freshly created card's first edit can be undone together with its creation in one step (P2)

**Steps:** Create a Prompt card (text "first"). Immediately change its text to "second"
(programmatically, as the app's own field editors do — `editor.updateShape`). Press Ctrl+Z once.

**Expected:** One undo reverts the text edit only, back to "first" — matches how a second,
separate undo then removes the card entirely.

**Actual:** Reproduced twice: the single Ctrl+Z removed the card entirely (both the creation and
the text change undone together), not just the edit.

**Evidence:** `engine-results.json`, case `undo-granularity`: `{"fused": true,
"existsAfterOneUndo": false, "textAfterOneUndo": null}` in both the isolated run and the full
combined run.

**Suspected cause (not fully confirmed):** Neither `createShape` nor the field-update path calls
`editor.markHistoryStoppingPoint()` between a shape's creation and its first subsequent edit
(contrast `packSelection`, which explicitly marks one — `client/pipeline/subgraph.ts:307`).
Whether tldraw's default history squashes "create, then edit the same shape" when nothing else
happens in between is worth confirming against tldraw's own docs/changelog; flagged here as an
observed behavior rather than a pinned-down cause.

**Suggested fix:** If unintentional, mark a history stopping point after a card's creation
completes (e.g. in `createNodeAt`/the insert-palette pick handler) so a user's very first edit to
a just-placed card is independently undoable.

---

### FLOW-09 — Running Output downstream of an interactive card that's waiting for a click spins indefinitely with no hint (P2)

**Steps:** Main menu → Examples → **Click an option card**. Press Run on the Output card (last in
the example) without clicking any of the HTML form's Option A/B/C buttons first.

**Expected:** Either a quick, clear "waiting for input" state, or the run completes once there's
genuinely nothing to show.

**Actual:** The run never completes — `runNode` on the Output card timed out after 30s with no
error shown anywhere on the canvas; the footer just keeps showing the run as in progress. This
matches the card's own by-design behavior (`html_form` really does wait for a click), but there is
no indication to the user that the reason Run is "stuck" is an upstream card wanting input.

**Evidence:** `examples-results.json`, `html-form-cards`: `threwError: "runNode(...): still
running after 30000ms"`.

**Suggested fix:** Low priority / polish: a hint on the Output (or any) card whose upstream is an
unresolved `html_form`/interactive card, pointing at what's blocking it.

## 3. Pipeline gaps for the flow area

- **Chat card can't receive its outgoing message from a wire.** (name: *wire a message into
  Chat*, inputs: a `text` port that sets `userMessage` directly, outputs: n/a, why: today the
  only text-like input port on Chat ("Reply to" / `parent`) has completely different semantics —
  it seeds prior conversation history, not this turn's message — so there is no way to pipe, say,
  a Prompt or a For each item straight into "what Chat says this turn" without the user manually
  retyping it into the card's own field. Priority: P1, directly caused the broken example
  (FLOW-03) and would trip up any real pipeline that wants to drive a chat turn programmatically.
- **Sleep is not abortable** (FLOW-04): no pipeline gap in the card's inputs/outputs, but a real
  gap in the execution engine's promise — "Stop" is advertised as a global control but silently
  doesn't apply to the one card type whose entire purpose is waiting. Priority: P1.
- **Load image → relative URL → any image card is a dead end** (FLOW-02): there's no supported way
  to reference a same-origin/static asset by path once it leaves `load_image`'s own field; the
  user must re-host it as a data URL, upload it through the app's own store, or use an absolute
  `http(s)://` URL. Priority: P1 (blocks 4 bundled examples outright).
- **Group-as-box has no port curation step** (FLOW-05): packing more than the most trivial chain
  produces a box whose interface is dominated by rarely-wired settings fields rather than the
  one or two ports that matter. A "choose which ports to expose" step, or an Advanced/basic
  split, would make packed boxes usable as actual reusable sub-pipelines rather than just a
  visual collapse. Priority: P2, but high value for "My nodes" reuse specifically.
- **Random's AI spec is 5 modes short of the real card** (FLOW-07): name *random coin/dice/uuid/
  password/color*, priority P2 — cheap, mechanical fix (add entries to `nodeSpecs.ts`).
- **No per-card "waiting on upstream" feedback** (FLOW-06, FLOW-09): both point at the same
  underlying gap — a card that's part of a run but not itself currently executing gives the user
  no visual signal that anything is happening (or, worse, what it's waiting on). Priority: P2.

## 4. What works well

- **Every pure-logic card is correct.** If's 15 conditions (including the newer `between`),
  branch highlighting, and the `test`-port override; For each's 5 split modes, number-range mode,
  all 3 `noResult` behaviors, and genuinely-working nested For each (a real two-level loop with
  exact expected output); Decision switch's yes/no (with margin/"unsure"), choice (auto-derived
  options), and score modes, all auto-detected correctly from a raw JEV-shaped decision; Logic's
  and/or/not/xor/nand truth table; Code running identical logic correctly in TypeScript,
  JavaScript, *and* Python (WASM); Random's number/pick/shuffle/dice/uuid all format- and
  range-correct — none of this needed a single correction once the test's own setup was right.
- **The run cache is precise.** A second identical run is reliably "cached"; changing upstream,
  changing the card's own field, or overriding a field via a wire all correctly force a real
  re-run, and a wired field override genuinely wins over the (hidden) typed value.
- **Upstream pull, delete-with-wires, duplicate, page switch, and save/open canvas** all behave
  exactly as documented, including a realistic copy/paste (select two wired cards the way a
  drag-select box naturally would, with the connector itself in the selection) correctly
  recreating the wire between the *new* pair, not the originals.
- **The error banner and "Fix with AI"** are genuinely good: the banner shows the real thrown
  message, and the AI button opens the per-node assist panel with an accurate, usefully-phrased
  "Fix this error: …" draft already filled in — not just a vague prompt.
- **Wire type compatibility actually works as designed**: dragging a `number`-typed output onto
  an `image`-typed input drops the wire (confirmed via a real simulated drag, not just reading the
  code) rather than silently connecting mismatched types; dragging onto an `any`-typed port binds
  normally.
- **Old-canvas compatibility holds up**: a v0.2.0-style snapshot missing a since-added required
  field (`chart.dualScale`) loads with no `ValidationError` and the sensible default.
- Visually, every card checked (If, Decision switch, For each incl. nested, Table view, Chart,
  Group box open/closed, HTML form) is clean, consistent with tldraw's own styling, and free of
  clipping/overlap/contrast problems in both the placed and post-run states.
