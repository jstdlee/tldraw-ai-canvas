# UI review — visual and interaction detail

Area: `ui`. Tested against a local build on web :5205 / API :8835, Chromium via Playwright,
light + dark, using the Magpie router (`http://127.0.0.1:3425`) per `ai-config.magpie.json`.
Specs live in `tests/review-tmp/ui/*.spec.ts` (not product code). Screenshots and logs are under
`/tmp/claude-1000/-home-leilei-dev/b748c873-b27f-4f05-99d7-ad20f0decaac/scratchpad/review/ui/`
(`cards/`, `interactions/`, `dialogs/`, `misc/`, `perf/`, `zoom/`).

## 1. Summary

Tested all 47 registered card types (every key in `client/pipeline/nodes/registry.ts`'s
`NodeDefinitions`) at default size in light and dark; the library sidebar, search, Ctrl+P
palette, `/` insert palette, right-click + Insert submenu (at 1000×500, to check the
scroll-arrow affordance), wire-drop picker, card "…" menu, resize, collapse, colour chord, and
the expand (max) text editor; the AI providers dialog (Models/Search/MCP/Skills), Build panel,
agent chat panel (empty, thinking, reply-error, chips), table viewer, image zoom viewer, and the
large editor at a shrunk size; keyboard shortcuts and focus; toasts, the "No AI models yet"
banner (verified from source, not reproduced live — see UI-16), empty canvas, and the page menu;
and canvas feel with 100 mixed, wired cards (pan/drag/select-all frame timing).

**Counts by severity:** P1: 4. P2: 11. Plus 1 informational item not independently reproduced
(UI-16).

**Top 5 problems (by how visible they are to a user):**
1. **UI-01** — AI providers dialog: the model list visually overlaps "Default model for each
   job" / Skills once you have a realistic number of models (20, one normal router config),
   making several rows unreadable.
2. **UI-02** — OpenRouter card shows a raw JS exception (`Failed to execute 'json' on
   'Response'...`) as its Model dropdown's placeholder the moment it's inserted, whenever the
   free-model fetch fails.
3. **UI-03** — A CSS bug clips the last letter of every right-aligned italic hint
   ("not connected" → "not connectea", "not used" → "not useo", "instead" → "insteao") — the
   default look of most cards before they're wired up.
4. **UI-04** — The fixed 32%-wide port-label column truncates short labels to the point of
   unreadability on cramped cards (JEV: "Context"/"Question"/"Input text" → "Cont…"/"Ques…"/
   "Inpu…"; Generate image: "Ref." → "R…").
5. **UI-05** — Database card's Source segmented control (SQLite file / Built-in Postgres /
   Postgres / DuckDB) is wider than the card; "DuckDB" is clipped ~31px past the right edge.

## 2. Findings

### UI-01 — P1 — AI providers dialog: model list overlaps "Default model" / Skills

**Steps:** Open the app with the supplied 20-model Magpie config → press Ctrl+P → "AI
providers…" (or `openProvidersDialog()`) → look at the right-hand detail column with the
`magpie` provider selected.
**Expected:** The model table scrolls independently (or the whole column scrolls) so every
section is readable.
**Actual:** "Default model for each job" renders at a fixed position (~445px from the dialog
top) while the model table's own rows (20 of them, ~36px tall) are *not* clipped there — the
tail of the table (`Nemotron 3.5 Lightning`, `Claude Sonnet 5.5`, `Grok 4.7 Fast`, …) paints
underneath/through the "Default model" selects and the `●chat`/`●vision` radio dots, producing
jumbled, unreadable overlapping text (e.g. "● chat Space Bunny ● v…" on one line).
**Evidence:**
`.../dialogs/ai-providers-default-light.png`, `.../dialogs/ai-providers-model-detail-light.png`
(identical — confirms it's not a one-off), `.../zoom/ai-providers-overlap-full.png`. Measured via
DOM: the "Default model for each job" heading's rect is `{y: 444.66, height: 15}` — a fixed
position regardless of how many model rows are above it.
**Suspected cause:** `client/ai/ai.css` — `.ai-dialog__detail` (`display:flex; flex-direction:
column; gap:12px`, no `overflow`/`min-height:0`) and `.ai-dialog__columns` (`display:grid;
grid-template-columns:180px 1fr; min-height:260px`, no `overflow`). `.ai-dialog__body` has
`overflow:auto` (line ~90), but something inside isn't passing the model table's real height up
to it, so the table's tail renders past the point where its scroll container would have clipped
it. `client/ai/AIProvidersDialog.tsx` around the models list / "Default model" sections.
**Suggested fix:** Give the model table its own `overflow-y:auto; max-height: …` scroll region
(independent of the "Default model"/"Skills" sections below it), or confirm `.ai-dialog__detail`
and its model-list child both propagate height correctly to `.ai-dialog__body`'s scroll. Repro
needs ≥~12–15 models on one provider — verify with the shipped `ai-config.magpie.json` (20
models), not a 2–3 model smoke test.

### UI-02 — P1 — OpenRouter card shows a raw exception as its default dropdown text

**Steps:** Insert an "OpenRouter free" card (type `openrouter`). Don't run it — look at the
Model dropdown immediately.
**Expected:** A friendly state ("Loading free models…", or "Couldn't load models — check your
connection" on failure).
**Actual:** The dropdown's placeholder option reads **`Failed to execute 'json'...`** — a raw
browser `DOMException` message, truncated by the `<select>`'s own width. Reproduced twice, light
and dark (`.../cards/openrouter-light.png`, `openrouter-dark.png`).
**Suspected cause:** `server/batchRoutes.ts:180-184` — `/api/hub/openrouter` does `fetch
('https://openrouter.ai/api/v1/models', ...)` with no `try/catch`; when that external fetch
fails (no network, as in this sandbox, or OpenRouter being slow/down in production), Hono's
default error handling returns a non-JSON error body. On the client,
`client/pipeline/nodes/types/ToolNodes.tsx`'s `useHub()` (lines ~180-186) does
`fetch(url).then(r => r.json())` with no response-shape check, so `.json()` throws, and the
`catch` (line 186) stores `(cause as Error).message` — the raw exception text — into `error`
state, which is then rendered verbatim as the select's only option
(`<option value="">{error || …}</option>`, line ~242).
**Suggested fix:** Wrap the server route in try/catch and return `{ error: 'friendly message' }`
on failure (matching what the client already expects via `payload.error`); on the client, only
use `cause.message` as a last-resort fallback behind a generic "Couldn't load free models" string.
**Who hits this:** anyone without reliable access to openrouter.ai — which, given this card's
whole purpose is "free" models via OpenRouter, is a reasonably common first interaction.

### UI-03 — P1 — Italic hint text clips its own last letter ("not connected" → "not connectea")

**Steps:** Insert almost any card with an unwired input (Prompt concat, Crop, Resize, Random,
Logic, If, For each, Sleep, Switch, …) — i.e., most cards right after inserting them, before
wiring anything.
**Expected:** "not connected" / "not used" / "optional: test this instead" render intact.
**Actual:** The final letter of the phrase is visibly clipped: "not connected" → "**not
connectea**", "not used" → "**not useo**", "optional: test this instead" → "…insteao", "empty
items are skipped" → "…skippeo", "JEV probs or final decision" → "…finai". Confirmed at a clean
100% canvas zoom and at 3×/5× device-scale screenshots (not an anti-aliasing artifact) — see
`.../zoom/prompt_concat-100pct.png` and `.../zoom/prompt_concat-label-crop.png`. At a much
larger card font (48px) the same text wraps to two full lines and renders correctly, which is
what pointed at the cause below.
**Evidence (DOM measurement):** the span's `scrollWidth === clientWidth` (193px both) — there is
**no layout overflow** — so this is a *paint* clip, not a content-too-wide clip.
**Suspected cause:** `client/pipeline/index.css:330-341`, class `.NodeRow-disconnected`:
`font-style: italic; text-align: right; display: -webkit-box; -webkit-line-clamp: 2; overflow:
hidden;` with `padding-right: 0` (none set). Italic glyphs' ink can paint slightly past their own
advance-width box, especially the last character flush against a right edge with no padding; the
line-clamp box's `overflow:hidden` then clips that overhang. Same class is reused (and reproduces
the same way) in `NodeOutputView > .NodeRow-disconnected` (line 1556),
`.ImageGenNode-grid > .NodeRow-disconnected` (line 2952), and
`.HtmlPreviewNode-submission > .NodeRow-disconnected` (line 3137) — i.e. it's one shared bug,
not several.
**Suggested fix:** add a small `padding-right` (e.g. `0.2em`) to `.NodeRow-disconnected`.
**Impact:** this is the single most common thing a new user sees — the gray italic hint next to
every empty input port — on nearly every card in the catalog before it's wired up.

### UI-04 — P1 — Fixed-width port-label column truncates short labels unreadably

**Steps:** Insert a JEV card (type `jev`) or a Generate image card (type `image_gen`).
**Expected:** "Context", "Question", "Input text" (JEV) and "Ref." (Generate image's reference
image row) read in full, or truncate gracefully with enough of the word visible to guess it.
**Actual:** JEV's three input labels render as **"Cont…"**, **"Ques…"**, **"Inpu…"** — 4-5
letters of an 7-10 letter word, unreadable without hovering for the `title` tooltip.
Generate image's "Ref." (already an abbreviation in the source) truncates further to **"R…"**,
and its "optional" hint (in the same cramped row) wraps into two illegible fragments. Confirmed
via DOM: the label's actual text is `"Ref."`, `title="Ref."`, row text `"Ref.optional"` — so this
is purely a rendering/column-width problem, not a content bug.
**Evidence:** `.../zoom/jev-card-crop.png` (crisp), `.../zoom/image_gen-ref-row-crop.png`.
**Suspected cause:** `client/pipeline/index.css:361-372`, `.NodePortLabel { flex: 0 0 32%;
max-width: 32%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }` — a deliberate
"line up every row's label" design (comment references WP27 Part B), with a `title` attribute as
the fallback. At JEV's and Generate image's default card width, 32% isn't enough room even for
short, single- or two-word labels once the port dot + colour-tinted text have taken their share.
**Suggested fix:** Either widen these two cards' default width so 32% is enough for their
longest label, or give `.NodePortLabel` a `min-width` in px (not just a `%`) so short labels
never truncate below a usable length.
**Also seen:** Web search card's "Results" field label wraps mid-word ("Re" / "sults") at
default width — same family of fixed-column-too-narrow issue, on a plain field label this time,
not a port label (`.../cards/web_search-light.png`).

### UI-05 — P2 — Database card: Source tabs overflow the card's right edge

**Steps:** Insert a Database card (type `database`).
**Actual:** The Source segmented control ("SQLite file / Built-in Postgres / Postgres /
DuckDB") is wider than the card. Measured: card right edge at x=828.1, "DuckDB" tab's right edge
at x=859.0 — **~31px of the last tab renders past the card's own border**, with no scroll
affordance.
**Evidence:** `.../cards/database-light.png`, `.../zoom/zoom-database.png`.
**Suspected cause:** `client/pipeline/nodes/types/DatabaseNode.tsx:513-514` (`UiSegmented`
with 4 source options) inside `client/ui/ui.css`'s `.UiSegmented { display:flex; gap:0.15em }` —
no wrapping, no overflow handling, no max-width check against the card.
**Suggested fix:** Either let `UiSegmented` wrap to a second line when it doesn't fit, or shrink
the control's padding/font at this card's default width, or make the card itself a bit wider by
default.

### UI-06 — P2 — LoadImageNode "Load" button truncated to "L…"

**Steps:** Insert a Load image card (type `load_image`).
**Actual:** The button next to the "Source" URL field, whose actual label is **"Load"** (4
letters), renders as **"L…"**.
**Evidence:** `.../cards/load_image-light.png`; DOM-confirmed button text is `"Load"`.
**Suspected cause:** `client/pipeline/nodes/types/LoadImageNode.tsx:209` —
`<UiButton size="sm" variant="low" className="LoadImageNode-browse" label="Load" .../>` sitting
in a row that doesn't give it enough width next to the URL input.
**Suggested fix:** give `.LoadImageNode-browse` a `min-width` (or `white-space:nowrap` with a
bit more flex-basis) so "Load" never wraps below readable.

### UI-07 — P2 — HTML form / HTML preview: override fields have tiny, low-contrast placeholder text

**Steps:** Insert an HTML form (`html_form`) or HTML preview (`html_preview`) card.
**Actual:** The Text/HTML/CSS/JS fenced-block override boxes show placeholder text ("Overrides
the html fenced block (or the Text field)", "Overrides the css fenced block", "Overrides the js
fenced block") in a small monospace font at a muted grey — legible but noticeably harder to read
than the rest of the card, and the "Text" field's own example content (`<button
data-value="a">Option A</button>` etc.) is similarly tiny.
**Evidence:** `.../cards/html_form-light.png`, `.../cards/html_preview-light.png`.
**Suspected cause:** `client/pipeline/nodes/types/HtmlPreviewNode.tsx:339-341` (and the
duplicate block at 517-519) — `SourceRow`'s monospace override boxes use the card's base `em`
scale without a larger minimum for this particular field type.
**Suggested fix:** Bump the override boxes' font-size floor or give the placeholder text a less
muted colour so it's legible at the card's default (16px) font.

### UI-08 — P2 — Build panel: "Plan" button truncated to "Pl…"

**Steps:** Open the Build panel (`openBuildPanel()`, or right-click → "Build with AI…").
**Actual:** The primary action button, labelled `"Plan"` (4 letters, `variant="primary"`), sits
next to the model `<select>` in `.BuildPanel-row` and renders as **"Pl…"**.
**Evidence:** `.../dialogs/build-panel-light.png`.
**Suspected cause:** `client/pipeline/components/BuildPanel.tsx:257-266` — the `ModelSelect`
(a `<select>`, likely `flex:1`) and the `UiButton label="Plan"` share a row with not enough
width reserved for the button at the panel's default ~390px width.
**Suggested fix:** give the "Plan"/"Working…" button a `flex: none; white-space: nowrap` (it's
already the longer of the two possible labels — "Working…" — so sizing for that avoids layout
shift too).

### UI-09 — P2 — "AI text" and "Generate text" cards look almost identical

**Steps:** Insert `text_ai` ("AI text") and `generate_text` ("Generate text") side by side.
**Actual:** Both show: an orange "Input"/"not connected" row, a model select, a "Model settings"
disclosure, and an "Output appears here" box — same visual rhythm, same icon style, very close
titles. The actual difference (AI text = transform existing input via a Job dropdown
Summarize/Translate/etc.; Generate text = write from a typed prompt) isn't visible until you
read the body carefully.
**Evidence:** `.../cards/text_ai-light.png`, `.../cards/generate_text-light.png`.
**Why it matters:** in the library search / insert palette, a user typing "text" sees two
near-identical-looking cards and has to guess which one does what they want.
**Suggested fix:** differentiate the icon or header accent between the two, or lead each card's
first row with the thing that differs (Job dropdown vs. Prompt text) instead of both leading with
an "Input" row.

### UI-10 — P2 — Camera card's buttons don't look like buttons

**Steps:** Insert a Camera card (type `camera`).
**Actual:** "Start camera" renders as plain text with no visible fill/border at rest — it reads
as a label, not a control, unlike "Browse…"/"Load" elsewhere in the same card family which have
a clear grey button background.
**Evidence:** `.../cards/camera-light.png`.
**Suspected cause:** `client/pipeline/nodes/types/ImageNodes.tsx:216-222` uses tldraw's own
`TldrawUiButton type="normal"` instead of the app's own `UiButton` from `client/ui/` — which
`docs/rework/RULES.md`'s "Look and feel" section calls out as the kit every card should use.
`TldrawUiButton`'s "normal" variant has no visible chrome at rest, so it looks inert next to
cards built with the house `UiButton`.
**Suggested fix:** swap to `UiButton` for consistency (also fixes the same thing for "Take
photo"/"Retake" in the same file).

### UI-11 — P2 — AI providers dialog, minimum size: content still readable but very tight

**Steps:** Open AI providers, shrink the window to 900×560.
**Actual:** The dialog keeps its 180px list / flexible detail layout; text wraps rather than
overflowing in the areas not already affected by UI-01, but the checkbox grid of capabilities
(agent/chat/vision/jev/image) per model row gets close to illegible at this width.
**Evidence:** `.../dialogs/ai-providers-min-size.png`.
**Severity note:** not broken, just cramped — recorded for completeness since the brief asked
for minimum-size checks.

### UI-12 — P2 — Toast can sit over a card's own controls and block clicks

**Steps:** With the shipped AI config (2 of its default models point at an expired OpenCode Go
key), load the app — the "N default models are not available" toast appears bottom-right and
stays until dismissed. Insert or select a card whose footer/"…" button ends up under that corner
(common at default zoom with a single card, or in a cramped window).
**Actual:** The toast's DOM sits in front of the card and intercepts pointer events — in testing,
a `.click()` on a card's "More options" button retried against the toast's own text node for the
full 60s before the toast was dismissed first.
**Evidence:** reproduced directly — see the "card … menu" test in
`tests/review-tmp/ui/interactions.spec.ts` (first run, before a `dismissToasts()` helper was
added); error log captured the exact intercepting element
(`<div class="tlui-toast__description">agent, chat: openai/opencode-go/deepseek-v4.1-fla…`).
**Suggested fix:** either give toasts a `pointer-events` boundary that doesn't extend past their
visible box, or keep the bottom-right corner (where the chat-float button and toasts both live)
clearer of card footer controls by design.

### UI-13 — P2 — "…" card menu item wording: "Lock delete"

Minor copy nit, not a layout bug: the "…" menu's delete-lock toggle reads **"Lock delete"**
(`client/pipeline/nodes/NodeShapeUtil.tsx:816`), which reads ambiguously (lock, then delete? or
prevent deleting?) at a glance. The toggled state, "Allow delete", is clearer. Consider "Prevent
delete" or "Delete-locked" for the off state too.

### UI-14 — P2 — Dev console flood of "no port anchor" warnings on a large wired canvas (needs follow-up)

**Observed, not independently reproduced via plain UI clicks:** building a 100-card realistic
canvas via `tests/perf/helpers.ts`'s `buildRealisticCanvas` (used for the scenario-6 perf pass)
produced dozens of `[WP17]`/`[WP21]` dev-only console warnings — e.g. `"input" on a "if" card has
no port anchor — its row never registered one`, `"then" output on a "if" card has no port
anchor — render a <Port>/OutputPortRow...`, and the same for `database`, `web_search`, `table`,
`chart`, `table_view`, `prompt`, `text_ai`, `jev`. These are the project's own instrumentation
(see the warning text) flagging that a port's wire-anchor ref never registered, which — per the
warning's own wording — means that port's wire can render "stuck on the header row" instead of
at its real position.
**Why P2 and not higher:** I could not confirm this happens via normal UI insert+wire flow in
the time available (the perf helper creates shapes directly via `editor.createShape`, which may
not match a card's normal mount timing) — flagging for someone to check whether a wire visually
lands on the wrong port row when a card is created this way vs. drawn by hand.

### UI-15 — P2 — For each card: footer area has a stray horizontal scrollbar at default width

`.../cards/for_each-light.png` shows a thin grey bar directly under the "Run" row that reads as
an unstyled horizontal scrollbar, and the "each item →" pill plus its green output dot sit right
at/past the card's right edge. Lower confidence than the others above (didn't drill into the DOM
for this one) — worth a quick look at `ForEachNodeDefinition`'s default width vs. its "each
item" output pill.

### UI-16 — Not independently reproduced — "No AI models yet" onboarding banner

Read from source (`client/App.tsx` ~line 463: `if (!config || config.models.length > 0) return
null`) rather than seen live — my attempt to clear the AI config via `/api/config` in a test
didn't flip `$aiConfig` the way the real "remove all providers" UI flow would, so I didn't get a
clean screenshot. The code path is simple enough that I'm not flagging it as broken, just noting
it wasn't visually verified this round.

## 3. Card gallery — card → issues

All 47 registered types (`client/pipeline/nodes/registry.ts`) were inserted at default size and
screenshotted light + dark; `✓` = no issue found beyond the general points below.

> Almost every card with an unwired input shows **UI-03** (the "not connected" last-letter clip)
> by default — not re-listed per row below unless there's something else going on too.

| Card | Issues |
|---|---|
| Prompt | ✓ |
| Number | ✓ |
| Image (load_image) | **UI-06** "Load" button → "L…" |
| Camera | **UI-10** buttons look inert (wrong button component) |
| Random | (UI-03 only: "not used" → "not useo") |
| Capture | ✓ |
| HTML form | **UI-07** tiny override-field text |
| AI text (text_ai) | **UI-09** looks like Generate text |
| Text tools | ✓ |
| Generate text | **UI-09** looks like AI text |
| Chat | ✓ — clean example (see §4) |
| Agent | ✓ |
| Model provider (model_source) | "Fetch models" reads as plain text, not an obvious button (low confidence, not separately numbered) |
| Prompt concat | (UI-03 ×3: Prefix/Main/Suffix) |
| Crop | (UI-03) |
| Resize (image_resize) | (UI-03) |
| Filter (image_filter) | (UI-03) |
| Image tools (image_tool) | (UI-03) |
| Adjust | (UI-03) |
| Generate image (image_gen) | **UI-04** "Ref." → "R…", "optional" hint wraps unreadably |
| JEV | **UI-04** "Context"/"Question"/"Input text" → "Cont…"/"Ques…"/"Inpu…" |
| Switch (decision_switch) | (UI-03: "…final decision" → "…finai") |
| If | (UI-03: "instead" → "insteao") |
| Logic | (UI-03 ×2) |
| For each | (UI-03 ×2) + **UI-15** stray scrollbar / edge overflow |
| Router | ✓ — clean example (see §4) |
| Code | ✓ (code editor's own horizontal scroll is expected) |
| Group / Subgraph | ✓ |
| HTTP | ✓ (very tall card → low fit-to-screen zoom, not a bug) |
| Download | ✓ |
| Network (net_tool) | ✓ |
| Postgres | ✓ |
| Web search | **UI-04** "Results" label wraps "Re"/"sults" |
| Output | (UI-03) |
| Save | ✓ |
| DataPipe (table) | ✓ |
| Chart | Possible first-paint delay before the inline preview chart renders (low confidence — may be a test-timing artifact, see note below) |
| Profile | ✓ — renders a full live preview from its default sample data immediately, nice touch |
| Database | **UI-05** Source tabs overflow the card ~31px |
| Table view | ✓ |
| HTML preview | **UI-07** tiny override-field text |
| OpenRouter free | **UI-02** raw exception in the Model dropdown |
| Raw model | ✓ |
| Video | ✓ |
| Read from (file_in) | ✓ |
| URL (url_in) | ✓ — correctly shown as a deprecated card with a "Convert" to Read-from action |
| Sleep | (UI-03) |

Chart note: in one gallery pass the Chart card's default-sample bar chart rendered immediately
in dark mode but not in light mode (same card, same default props, captured ~90s apart in the
same run). Likely the echarts bundle lazy-loading on first use rather than a real light/dark
bug — flagged for awareness, not ranked as a finding.

## 4. Pipeline gaps (UI-relevant)

My area is visual/interaction polish rather than pipeline functionality, so this is short:

- **Model-row affordance in AI providers dialog**: once UI-01 is fixed, the dialog would benefit
  from a sticky "Default model for each job" + "Skills" footer (always visible) instead of
  scrolling away under a long model list — the two are used together constantly (pick a model,
  then set it as a default).
- **OpenRouter card needs a real error state**: beyond fixing UI-02's raw-exception leak, the
  card has no visible retry affordance when the fetch fails — compare to the Agent chat panel's
  error banner (UI "what works well" below), which is the bar to match.
- **A visual differentiator between "AI text" and "Generate text"** (UI-09) would help users
  pick the right card from search/insert results without reading both bodies.

## 5. What works well

- **Agent chat panel** states are genuinely good: empty state has a clear prompt + 4 useful
  suggestion chips, "Thinking…" has a spinner, and the error state (API key expired, captured
  live from the shipped config) shows a clean red banner with an actionable message — this is
  the quality bar the rest of the app should match.
- **Router, Capture, Prompt, Number, Text tools** cards: clean, no truncation, fixed-width
  columns line up correctly, light and dark both look intentional.
- **Profile** card renders a full live analysis (row/column counts, per-column stats, sparkline)
  from its own default sample data the instant it's inserted — no "Run" needed, a nice touch.
- **Right-click → Insert submenu** scroll arrows work correctly at a cramped 1000×500 window —
  confirmed the down-chevron affordance appears when the list doesn't fit.
- **Library sidebar** search/empty-state, Ctrl+P command palette, and the `/` insert palette are
  all clean, fast, and consistent in both themes.
- **tldraw's own context menu / Insert submenus** integrate well with the app's card groups.
- **Canvas performance with 100 wired, mixed cards** is solid: pan p50/p95 ≈ 16.7ms (≈60fps),
  drag p50 ≈ 16.8ms / p95 ≈ 50ms, select-all p50 ≈ 16.7ms with one 333ms spike (acceptable for a
  one-off full-canvas selection highlight over 100 shapes).
