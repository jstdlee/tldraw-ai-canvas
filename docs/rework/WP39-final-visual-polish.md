# WP39 — Final visual polish (planner's walkthrough of every card, 2026-10-18)

Read `RULES.md`. Evidence: per-card screenshots (default state, light and dark) in
`/tmp/claude-1000/-home-leilei-dev/b748c873-b27f-4f05-99d7-ad20f0decaac/scratchpad/review/final-cards/<type>-<theme>.png`
and contact sheets in `.../review/final-sheets/`. Fix each, then re-shoot the card (light + dark) and LOOK at it.

1. **Database** (`database-light.png`): the Source segmented control still overflows the card — "DuckDB" is cut
   to "Duc" at the default card width (UI-05 is not fixed in the default state). Make all four sources fit: shorter
   labels ("SQLite", "Built-in PG", "Postgres", "DuckDB") or a select, or wrap to two rows. Also the "Load rows
   into" / "Rows" area: the hint "wire CSV rows to load" breaks into a tiny 2-line fragment beside the port; give it
   a proper row layout.
2. **Decision switch** (`decision_switch-light.png`, Auto mode): the headers Options, Bands, Threshold, Margin
   are shown with nothing under them, and two unlabeled inputs ("0.5", "0" + "0 = off") follow below them. Each
   field's editor must sit in its own labelled row, directly under/next to its own label; fields that do not apply to
   the current mode should be shown collapsed (label + "not used in Auto/Choice mode" hint) while still keeping their
   port anchor (AI-07 requirement) — never orphan inputs.
3. **Merge**: "Join with" shows "Choose" (no value). Default to "New line" (and show it greyed with "used in All
   joined mode" when mode is "First that arrives").
4. **For each**: the progress bar under "No result" looks like a horizontal scrollbar. Make it read as progress:
   thin bar with a label ("Not run yet" / "3 / 10" / "done"), or hide it until a run starts.
5. **JSON fields**: the Paths box shows 3 lines while the card has 4 path outputs (value, topic, data[0].name,
   customer.country) — the box must show all lines (auto-grow up to ~8 lines) so the paths and the outputs match
   visibly.
6. **Chart** (`chart-light.png`): the "Text" row shows a label with no visible editor (empty table text after
   WP34). Show a proper placeholder text area (like Profile/Table view: "Paste a table: CSV, TSV, JSON array, or
   Markdown"), or hide the Text row while the Table port is wired. Also check row alignment of "Titles and labels".
7. **HTML preview / HTML form**: the HTML override placeholder "Overrides the html fenced block (or the Text
   field)" is cut in half vertically; let it wrap fully or shorten it ("Overrides the html block").
8. **Image tools**: the Tool select is squeezed to "Info (size, t…" by the "Restore default" button beside it. Put
   "Restore default" on its own row or make it an icon button with a tooltip.
9. **Model provider**: the URL field breaks a URL mid-word ("https://api.openai.c / om/v1"). URLs should not be
   broken arbitrarily: keep single-line with horizontal scroll inside the field, or break only at "/".
10. Then walk through all the other cards' screenshots in the sheets (light and dark) and fix anything else that is
    clipped, misaligned or inconsistent (e.g. text_tool "Param B" row with no editor visible, Code card's "a"/"b"
    input rows look like empty bars).

Tests: extend `tests/e2e/wp37-ui-polish.spec.ts` (or a new `wp39` spec) with DOM checks (no element of a card
overflows its card box horizontally; no input without a label in Decision switch; Merge default separator).
Re-run the card gallery (copy `.../review/review-tmp-specs/ui/card-gallery.spec.ts` + its config into a temporary
folder OUTSIDE the repo or into tests/review-tmp/ and delete it afterwards) and save the new sheets to
`.../review/final-sheets-after/`.
