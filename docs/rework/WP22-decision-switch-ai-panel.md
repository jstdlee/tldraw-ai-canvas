# WP22 — Decision switch card, and an AI panel that builds with cards

Read `RULES.md` first. Owner feedback from a test round (2026-10-11).

## A. Decision switch (new card `decision_switch`, group Decide)

The JEV card answers yes/no, one-of-options, or a score. The switch routes a value by that answer.
- Inputs: `decision` (the JEV card's `probs` or `final` output — accept the JSON the JEV card
  emits; check JevNode.tsx for its exact output format) and `value` (any; the thing to route;
  default = the decision text itself).
- Mode follows the decision type automatically (also settable):
  - **Yes / no:** outputs `yes`, `no`; field `threshold` (default 0.5) on P(yes); optional
    `unsure` output when |P − threshold| < `margin` (default 0, off).
  - **Choice:** one output per option, built from the card's `options` field (one per line) or,
    when empty, from the options seen in the last decision; plus `other` for anything unmatched.
    Port ids `opt:<slug>`; labels show the option.
  - **Score:** bands from a `bands` field like `low < 0.33 ≤ mid < 0.66 ≤ high` (simple editor: rows
    of name + upper bound) applied to the score (0–1 scaled, or the level index when levels are
    used); one output per band.
- Only the chosen output gets `value`; the others get `STOP_EXECUTION` (like If). The card shows the
  last decision: chosen output highlighted, probabilities as small bars.
- Every output is a visible dot on its row (WP21 A rules). Works inside For each (WP21 B).
- Register everywhere (registry, nodeGroups `decide`, catalog, descriptions, nodeSpecs with
  assistant chips, examples, tests incl. wireFieldCoverage and cardSearch).
- Unit tests for the routing (pure `shared/decisionRoute.ts`).

## B. AI panel that builds with cards

Owner: with several cards selected, the assistant "tries to describe but misses connecting and
arranging the components and setting their parameters; it prefers to draw the connection rather
than using the component; the UI is not tldraw; the modal cannot be dragged."

1. **Look and move:** `BuildPanel` (and the per-card `FillChatCard`) become tldraw-style floating
   panels: `--tl-color-panel`, `--tl-shadow-3`, tldraw radius and type, tldraw buttons; a header
   bar you can **drag** (pointer events, clamp to the viewport, position remembered in
   localStorage); a resize handle at the bottom-right; Esc closes when focus is inside.
2. **Plan model:** `shared/aiPlan.ts` `AiPlan` gains `unwire: [{to, toPort}]` (remove an existing
   wire into a port) and `arrange: 'none' | 'tidy'`. `validatePlan` checks them. `applyAiPlan`
   removes listed wires, and when `arrange === 'tidy'` (default when 2+ cards are selected or the
   plan adds cards) lays out **all involved cards — existing selected ones too** — left to right by
   dependency with `layoutPlan` (existing cards may move; one undo step).
3. **Prompt rules** (Build with AI system prompt in `client/pipeline/aiBuild.ts`):
   - Work only with cards and card wires. Never propose tldraw arrows, shapes, text or notes.
   - For selected cards: set their parameters in `update` (with real field names and enum
     values), wire them together with ports from the catalog, add only missing cards.
   - Prefer the fewest cards; every card fully configured; `arrange: "tidy"`.
   - Give one or two worked examples using selected cards (update + wires + arrange).
   Include for each selected card its current field values, its wired inputs, and its free ports.
4. **Preview:** show `update` rows as field diffs (`op: select → filter`), `unwire` rows, and an
   "Arrange cards" checkbox (on by default).
5. **Routing:** the canvas chat agent (floating ✦ chat) draws shapes and arrows. When the user's
   selection contains cards and they type in the agent chat, show a one-line hint with a button
   "Build with cards instead" that opens the Build panel with the same text. `aiAskSelection`
   (Ctrl+Shift+K) with any card in the selection always opens the Build panel.

## Done when

typecheck + unit tests + e2e pass. Planner checks with the real model (Claude Sonnet 5.5): select a
Prompt, a DataPipe and a Chart, goal "filter rows where score > 3 and chart score by name" → plan
updates the DataPipe op/params, wires Prompt→DataPipe→Chart, sets Chart columns, arranges them;
apply works and runs. Panel drags and resizes, looks like tldraw in light and dark.
