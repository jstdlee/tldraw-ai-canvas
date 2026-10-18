# WP37 — UI detail polish

Read `RULES.md` and `docs/review/2026-10-18/ui.md` (screenshots and DOM measurements per item).
Fix, then screenshot each fixed spot in light and dark and LOOK at it.

- **UI-03** italic hint text clips its last letter app-wide (`.NodeRow-disconnected`).
- **UI-04** the fixed 32 % label column truncates short labels ("Cont…", "Ques…", "R…"): the column should fit
  the card's longest *short* label (e.g. measure per card, min 28 % max 42 %, never truncate labels ≤ 12 chars;
  ellipsis only for really long ones), and wrap to two lines before truncating.
- **UI-08 / AI-09** Build panel "Plan" button truncated.
- **UI-09** "AI text" and "Generate text" look almost identical — distinct icon/colour/subtitle, and clearer
  titles/descriptions of when to use which (library, search, nodeSpecs).
- **UI-10** Camera card uses tldraw's native button: use the UI kit buttons.
- **UI-12** toasts sit over card controls and block clicks: place toasts away from the canvas centre / bottom
  toolbar, pointer-events only on the toast itself, auto-dismiss.
- **UI-13** "Lock delete" wording → "Prevent deletion" (or similar) with a check state.
- **UI-16** check the "No AI models yet" banner logic (shows when models exist? hides correctly?).
- General: walk through every card type in light and dark once more after the fixes (tests/review-tmp/ui has a
  spec that inserts every card) and fix any remaining overflow, clipping or misalignment you see.
Do not change files owned by parallel packages beyond small CSS/markup touches: WP33 owns AIProvidersDialog,
AgentNode, RawModel/OpenRouter cards; WP34 owns DataNodes/DatabaseNode/TableView/table parsing; WP35 owns For
each/HTML cards/Decision switch/new glue cards; WP36 owns engine, image cards, Save/Output/Gallery/Merge.

## Tests
e2e: label column (no truncation of short labels on JEV / Generate image), Plan button full text, toast does not
block a card's Run button, Camera buttons are kit buttons.
