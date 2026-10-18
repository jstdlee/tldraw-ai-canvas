# AI area review — 2026-10-18

Area: `ai` (prompt/model cards, JEV + Decision switch, Agent card, HTML preview/form, Build with
AI, canvas agent chat, AI providers dialog). App version v0.3.3. Tested on web :5202 / API :8832
with a fresh `DATA_DIR`, the keyless Magpie config (`ai-config.magpie.json`), the
`fake-mcp-server.mjs` fixture over stdio, and a seeded skill folder (`review-echo`). Driven with
real Playwright specs under `tests/review-tmp/ai/*.spec.ts` (kept out of the real suite, deleted
after this review), reusing `tests/e2e/helpers.ts`. Screenshots and raw run logs are under
`/tmp/claude-1000/-home-leilei-dev/b748c873-b27f-4f05-99d7-ad20f0decaac/scratchpad/review/ai/`.

**Environment note, not an app bug:** the Magpie config originally shipped for this review
defaulted chat/agent to `opencode-go/deepseek-v4.1-flash`, whose upstream key has expired
(confirmed with a direct `curl` to :3425), and every `our-free-model/*` id is also dead
("OpenCode's free tier can only be used from within OpenCode"). The shared config was corrected
mid-review to default to `openai/antigravity/gemini-3.8-flash`. Live models verified working:
`antigravity/gemini-3.8-flash`, `antigravity/claude-sonnet-5-5`, `antigravity/claude-opus-5-5`,
`grok/grok-4.7`, `grok/grok-4.7-build-fast`. All functional tests below use an explicitly picked
live model, not left on "Default", except where the test is specifically about default behaviour.
Where the app reacted to the original broken default, see **What works well**.

## Summary

Tested all 7 scenarios: text-model cards (AI text, Generate text, Chat message, Raw model, Model
provider), JEV + Decision switch, the Agent card (MCP fixture + skill), HTML preview/HTML form,
Build with AI, canvas agent chat, and the AI providers dialog. ~30 real model calls through Magpie,
modest search mocked via `page.route`, MCP tested against the real fixture.

**Counts:** 1 P0, 4 P1, 4 P2 (9 findings), plus one low-confidence observation flagged as such.

**Top 5 problems:**
1. **AI-01 (P0)** — The Agent card cannot run at all against a keyless/local provider (the
   review's own Magpie config): `No API key for provider: openai`, every time, no workaround in
   the UI.
2. **AI-02 (P1)** — The Agent card's `model` input port is wired/drawn but never actually used;
   `execute()` always uses the card's own dropdown value.
3. **AI-03 (P1)** — The AI providers dialog visibly breaks (overlapping, unclickable rows) once a
   provider has a longer model list (21 models here): the "Default model for each job" and
   "Skills" sections render on top of the model table's bottom rows.
4. **AI-04 (P1)** — Decision switch's "Auto" mode can never select Score mode; a JEV "score"
   decision routed on Auto is silently treated as Choice instead.
5. **AI-05 (P1)** — "Rescan" in the AI providers dialog's Skills section always fails (415 from
   the server's own CSRF guard) as an unhandled promise rejection; the user sees nothing and the
   skill list never actually refreshes.

## Findings

### AI-01 — P0 — Agent card cannot run against a keyless/local provider

**Steps:** Fresh canvas, one Agent card, task "Say hi.", model Claude Sonnet 5.5 (the review's
Magpie provider, `apiKey: ""`). Press Run.
**Expected:** Runs like every other LLM card in this app does against the same keyless provider
(AI text/Generate text/Chat/Raw model/JEV all work fine with an empty key).
**Actual:** Immediate failure: `No API key for provider: openai`. Reproduced twice, and
independently corroborated by the `gaps.md` review (GAPS-02/03/04).
**Evidence:** `/tmp/.../scratchpad/review/ai/03-agent-no-api-key-bug.png`.
**Cause:** `server/index.ts:259` passes `apiKey = provider.apiKey || (cloudflare ? ... : undefined)`
to `toPiModel`/`runAgent`. For a provider with `apiKey: ""` this becomes `undefined`.
`@mariozechner/pi-ai`'s `openai-completions` provider (`node_modules/@mariozechner/pi-ai/dist/providers/openai-completions.js:329-331`)
hard-requires a truthy key and throws exactly this message when it's missing — unlike the `ai`
SDK path every other card uses (`server/llm.ts`), which is fine with an empty/no key against a
local/keyless endpoint.
**Suggested fix:** When `provider.apiKey` is empty for a non-Cloudflare provider, pass a harmless
non-empty placeholder (e.g. `'not-needed'`) instead of `undefined`, mirroring how the rest of the
app already treats "no key" as "no auth needed" for local servers.
**Workaround used to keep testing the rest of the card:** gave the Magpie provider a placeholder
key through the real `/api/config` endpoint (`setDummyApiKeyForWorkaround` in
`tests/review-tmp/ai/ai-helpers.ts`) — Magpie itself never validates it. Everything else about the
card (below) was verified with that workaround in place.

### AI-02 — P1 — Agent card's `model` input port is wired but never used

**Steps:** Wire a Model provider (or any node) into the Agent card's `model` port.
**Expected:** The wired model is used, the same way every other LLM card's `model` port works
(TextAI/Generate text/Chat/JEV all read `getInput(inputs, 'model')`).
**Actual:** `execute()` ignores it entirely.
**Cause:** `client/pipeline/nodes/types/AgentNode.tsx:142`: `model: node.model || undefined` — the
function never calls `getInput(inputs, 'model')`, even though the component renders a `<Port
portId="model">` that looks wirable. Confirmed by source read; matches `gaps.md` GAPS-02/03/04.
**Suggested fix:** In `AgentNodeDefinition.execute`, read the wired model the same way
`TextAINodeDefinition`/`ChatNodeDefinition` do, falling back to `node.model`.

### AI-03 — P1 — AI providers dialog: model table overlaps "Default model"/"Skills" with a longer model list

**Steps:** Open AI providers with a provider that has many models (the review's Magpie provider:
21). Try to tick a capability checkbox on one of the later rows (e.g. "jev" on Claude Sonnet 5.5,
row 6 of 21).
**Expected:** Clickable, like any other row.
**Actual:** The "Default model for each job" row visibly renders on top of the model table's lower
rows (overlapping checkboxes, dropdown text garbled into table cells — see screenshot), and
`document.elementFromPoint()` at the checkbox's own on-screen position resolves to `.ai-defaults`,
not the checkbox. Neither a normal Playwright click nor `force: true` (which still dispatches
through the browser's real hit-testing) toggles it; only a native `el.click()` bypassing
hit-testing entirely gets through. Reproduced 3× independently (an earlier, abandoned approach in
the JEV test, a dedicated repro, and the final providers-dialog test).
**Evidence:** `/tmp/.../scratchpad/review/ai/07-dialog-models.png` (visibly broken layout).
**Suspected cause:** `client/ai/AIProvidersDialog.tsx`'s `.ai-dialog__body` is one `overflow:
auto` flex column holding the provider detail pane (incl. the `table.ai-models`) and the
"Default model"/"Skills" `.ai-defaults` sections as siblings (`client/ai/ai.css:198-347`). With a
long table, the sections after it appear to be positioned without properly accounting for the
table's real rendered height. Does not reproduce with a short detail pane (e.g. an MCP server
selected instead) or a provider with few models — only manifests once the model list is long
enough to make the table itself tall.
**Suggested fix:** Give `.ai-dialog__detail` (or specifically `table.ai-models`) its own scroll
container, or otherwise make sure `.ai-defaults`/the Skills block never overlaps the table
regardless of its height.

### AI-04 — P1 — Decision switch "Auto" mode can never resolve to Score

**Steps:** JEV card, `kind: 'score'`, 3 levels (low/mid/high); Decision switch wired to it with
`mode: 'auto'` (the default, never touched).
**Expected:** Per WP22 ("Mode follows the decision type automatically") and the card's own UI
text, a score-type decision should route through score bands.
**Actual:** The switch resolves to Choice mode instead (`resolvedMode: "choice"`, chosen
`"opt:high"`), not Score — silently, no warning, no error.
**Evidence:** console output from `tests/review-tmp/ai/02-jev-decision-switch.spec.ts` (`"Switch
routed (score)": {"resolvedMode":"choice","chosen":"opt:high",...}`) and
`/tmp/.../scratchpad/review/ai/02-score-result.png`.
**Cause:** `shared/decisionRoute.ts`'s `detectMode()` only ever returns `'noul'` (exactly
`{yes,no}` keys) or `'choice'` — there is no code path that returns `'score'`. This is inherent to
the design: JEV's `probs` output (what the switch reads) is a flat `{label: probability}` object
with no `type` tag, so a score decision's probabilities are structurally indistinguishable from a
choice decision's. Confirmed via source (deterministic, no flakiness) and one live repro.
**Suggested fix:** Either have the JEV card's `probs` output (or a sibling output) carry its
`type`, and have the switch read that instead of guessing from shape; or document clearly in the
UI that Auto mode never selects Score and the user must pick it by hand.

### AI-05 — P1 — "Rescan" (Skills) in the AI providers dialog always fails silently

**Steps:** Open AI providers, Skills section, click "Rescan".
**Expected:** Re-reads `data/skills/`, same as the initial load.
**Actual:** Always fails with a 415 from the server (`Unsupported Media Type` /
`Expected application/json`), as an **unhandled promise rejection** — nothing is shown to the
user, and the skill list is never actually refreshed (it keeps showing whatever the initial GET
loaded). Reproduced twice, cleanly isolated.
**Evidence:** console output: `[Unhandled rejection] Error: Unsupported Media Type` at
`client/ai/aiConfig.tsx:128` (`fetchSkills`).
**Cause:** `fetchSkills(true)` POSTs to `/api/skills/rescan` with no `Content-Type` header and no
body (`client/ai/aiConfig.tsx:127-128`). The server's own CSRF guard
(`server/index.ts:79-83`) rejects any `/api/*` POST/PUT without `Content-Type: application/json`
with a 415. `rescanSkills()` in `AIProvidersDialog.tsx` has no `.catch()`, so the rejection is
unhandled and the UI silently does nothing.
**Suggested fix:** Send `headers: { 'Content-Type': 'application/json' }` (with an empty JSON body)
on that `fetch`, and add error handling in `rescanSkills` so a real failure shows something.

### AI-06 — P2 — Raw model's network errors show the raw `fetch failed` string

**Steps:** Raw model card, URL pointed at an unreachable port, Run.
**Expected:** A clear message like the other cards get (e.g. JEV's `No model for "jev". Open AI
providers...`).
**Actual:** The card's error area literally shows `fetch failed` (Node's bare `TypeError` message,
via `ECONNREFUSED`), red text, no further context.
**Evidence:** `/tmp/.../scratchpad/review/ai/01-raw-model-error.png`.
**Suspected cause:** `client/pipeline/nodes/types/RawModelNode.tsx`'s `execute()` passes through
`(error as Error).message` from the raw `fetch()` call to `/api/raw-model` without rewording a
network-level failure.
**Suggested fix:** Catch network errors specifically and show e.g. "Could not reach <url>: connection refused."

### AI-07 — P2 — Decision switch loses its `threshold`/`margin` port anchors outside Yes/No mode

**Steps:** Create a `decision_switch` card with `mode: 'choice'` (or `'score'`), leave it idle
for several seconds.
**Expected:** Per the WP22 fix already applied to `options`/`bands` ("always a wirable field, so
its anchor always renders here — even in a mode that doesn't use them"), the same should hold for
`threshold`/`margin`.
**Actual:** The app's own dev-mode port-anchor watcher warns: `[WP17] "threshold" on a
"decision_switch" card has no field-port anchor...` / same for `"margin"`. Confirmed in a clean,
steady-state repro (no mode-flipping race) — this is a real gap, not a transient false positive
(I did rule out a very similar-looking false positive from rapid mode switching elsewhere in this
same area; this one survives a 3.5 s steady wait).
**Cause:** `client/pipeline/nodes/types/DecisionSwitchNode.tsx`: the `threshold`/`margin`
`WireField`s are only rendered inside `{mode === 'noul' && (...)}`, unlike `options`/`bands`, whose
`WireFieldHeader` was deliberately pulled outside the mode-conditional block.
**Suggested fix:** Same treatment as `options`/`bands`: render `WireFieldHeader` for
`threshold`/`margin` unconditionally, only hiding the value editor itself by mode.

### AI-08 — P2 — Agent card's status row always reads "Not run yet"

**Steps:** Run an Agent card to a successful finish (or Stop it mid-run).
**Expected:** Some indication it actually ran (matches the footer's own run-time, e.g. "2.8 s").
**Actual:** The status row under the task fields permanently reads "Not run yet" unless there's an
error — even right after a successful run or after Stop.
**Evidence:** `/tmp/.../scratchpad/review/ai/03-agent-final.png`,
`/tmp/.../scratchpad/review/ai/03-agent-stopped.png`.
**Cause:** `client/pipeline/nodes/types/AgentNode.tsx` (`AgentNodeComponent`):
`<span>{node.error ?? 'Not run yet'}</span>` — no success-state message exists at all.
**Suggested fix:** Show something like "Done" / the final answer's presence, or just drop the row
when `lastOutput` is set and there's no error.

### AI-09 — P2 — "Build with AI" panel: "Plan" button label truncates

**Steps:** Open Build with AI (Ctrl+Shift+K) at its default size.
**Expected:** The "Plan" button reads fully.
**Actual:** It's clipped to "Pl…" next to the model dropdown — the row doesn't reserve enough
width for both.
**Evidence:** `/tmp/.../scratchpad/review/ai/05-panel-empty.png`,
`/tmp/.../scratchpad/review/ai/07-dialog-models.png` is unrelated but
`/tmp/.../scratchpad/review/ai/05-panel-plan-goal1.png` shows the same truncation before a plan
exists.
**Suggested fix:** Let the model select shrink, or the button keep a minimum width / wrap the row.

### Observation (not asserted as a bug) — a wired/live HTML form's iframe and mouse-simulated clicks

While driving a `html_form` card whose `text` was wired to a live upstream node (not a literal
field value), a Playwright mouse-simulated click on a button **inside** the sandboxed iframe
(`frameLocator(...).click()`) consistently registered 0 clicks on the iframe document's own
listener, at both the default zoom and a forced 100% zoom — a direct native `element.click()` from
inside the frame worked immediately and the whole bridge → downstream chain then functioned
perfectly. The project's own existing e2e test (`tests/e2e/html-preview-form.spec.ts`) uses the
same mouse-click pattern successfully, but only against a **literal** (non-wired) `text` field. I
could not pin down whether this is purely a Playwright/CDP coordinate-translation artifact or
reflects something that could occasionally affect a real user's very first click on a live-wired
form (e.g. a re-render racing the click). Flagging for awareness, not claiming it as a confirmed
product bug — I don't have enough evidence either way.

## Pipeline gaps for the AI area

1. **JEV capability discovery is easy to miss.** No ordinary OpenAI-compatible model is tagged
   `jev` by default (`guessCapabilities`), so a user who leaves JEV's model on "Default" gets a
   clear error (good), but the fix path (pick one of the many **live**, auto-tagged options in the
   same dropdown) works without ever touching AI providers — which is good UX, but those live
   picks aren't *configured* models, so they depend on a live `/api/models` fetch succeeding every
   session. Worth either: tagging common chat-model providers with `jev` by default (the server
   comment already says "any chat model may ... answer JEV questions"), or making the dropdown's
   live group more obviously "pick one of these, it'll work" rather than looking like an error
   state until explored.
2. **No model-port support on the Agent card (AI-02 above).** Until fixed, there is no way to
   give the Agent card a per-run/ad-hoc model (e.g. from a Model provider card) — only the
   card's own fixed dropdown.
3. **Decision switch Score-by-Auto (AI-04 above).** A real "build a pipeline that scores and
   branches" flow needs the user to know to flip the switch to "Score on a scale" by hand; Auto
   quietly does something else.
4. **Canvas agent chat has no per-chat model picker.** The model chip in the chat header is a
   shortcut to the global AI providers dialog (which changes everyone's default), not a way to
   pick a different model just for this chat/agent instance. Fine for a single-user canvas, a gap
   if someone wants to quickly A/B two models in chat.

## What works well

- **Text/model cards** (AI text — several ops incl. custom instruction, Generate text with
  `{{var}}` templating wired from another card, Chat message with real streaming replies and
  branching "Reply to" turns, Raw model incl. its own "Fetch models", Model provider wired into
  another card's `model` port): all produced correct results against live Magpie models, with
  clean, well-laid-out cards in both tested states. Run caching verified: an unchanged second Run
  made zero additional `/api/generate-text` calls and reported `cached`.
- **The model-health toast** proactively flagged the (at-the-time) broken default models with a
  precise message and a direct "AI providers…" link — good defensive UX, independent of the
  config issue itself.
- **JEV + Decision switch**: once given a usable model, yes/no, choice, and score decisions all
  routed correctly end-to-end through a full Prompt → JEV → Switch → Output chain, with clear
  probability bars and a highlighted chosen branch. The "no model" error is exact and actionable:
  `No model for "jev". Open AI providers, fetch models and tick "jev".`
- **Agent card internals** (once past AI-01): live step list updates mid-run, correctly calls a
  real MCP tool (`fake-mcp__echo`) and a skill-reading tool (`read_skill`) in the same run,
  synthesizes both into one final answer, `maxSteps` stops cleanly with a `(Stopped: reached the
  step limit.)` note, and Stop aborts promptly with no hang and a sane partial step list left
  visible.
- **HTML preview / HTML form**: sandboxing is correct (never `allow-same-origin`, always
  `allow-scripts`), LLM-authored fenced HTML renders pixel-correct (a styled button with the exact
  requested look), and the full "LLM makes option cards → HTML form → click → extract → If →
  Output" chain produced the exact expected routed value.
- **Build with AI**: both an empty-canvas goal (built a sensible Generate text → AI text →
  Output chain, wired and laid out left-to-right, ran correctly end to end producing a real French
  translation) and a goal with 2 cards selected (correctly reused both existing cards — 0 new
  nodes — rather than duplicating them) worked well; "Run after building" correctly cascaded
  through two sequential dependent model calls.
- **Canvas agent chat**: "hi" now gets a normal, on-topic text reply with zero canvas changes
  (the WP28 Part A fix holds); a drawing request produces a nice live action list (collapsible
  "Thought for..." step, Reject/Accept, a small live preview) and leaves real shapes on canvas;
  selecting cards auto-switches the mode chip to "Build (N)" and sending builds an in-chat plan
  card (Apply/Open in Build panel/Revise) that applies correctly; an unresolvable model id surfaces
  a clear upstream error bubble with no crash; light and dark themes both render cleanly.
- **AI providers dialog** (outside AI-03): Search provider add/key-save/Test (both success and
  failure paths read clearly) and MCP add/Test connection (real stdio fixture, correctly lists
  `echo, fail`) both work well, and a capability change genuinely persists across Save + reopen.
