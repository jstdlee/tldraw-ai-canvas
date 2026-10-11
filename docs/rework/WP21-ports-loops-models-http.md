# WP21 — Visible outputs, logic inside loops, model outputs, Raw model fetch, HTTP import

Read `RULES.md` first. Owner feedback from a test round (2026-10-11).

## A. Every output port is a visible, draggable dot

`If` has `then` / `else` outputs in `getPorts` but renders no `<Port>` for them, so they cannot be
seen or dragged ("the if card missing output point"). Same defect: For each `item`, JEV extra
outputs (`probs`, `final`, `yes`, `no`), Router `out_*`.
- Render a `<Port shapeId portId>` on the row that labels each output (right edge), and register
  the row anchor (WP17 `useFieldPortAnchor` / the PortRow mechanism) so the dot sits on its row at
  any font size. Outputs use the right edge x = card width (`getNodeWidthPx`), never the constant
  `NODE_WIDTH_PX`.
- Extend the WP17 dev warning to output ports: a rendered output without an anchor warns.
- e2e test: drag from If `then` to empty canvas opens the picker (like `wire-drop-picker.spec.ts`).

## B. Logic inside For each

Owner: "for each, each item shall be connected to If / else and other logic". The loop body is
the sub-graph from `item` to the feedback input `result` (`execution/loop.ts runLoopBody`).
- Allow any logic card in the body (If, And/Or/Not, JEV, Decision switch from WP22, Router, Code).
  When an item's path ends in a branch that does not reach `result` (e.g. If sends it to `else`
  which is not wired back), that item has **no result**.
- New For each field `noResult: 'skip' | 'keep' | 'error'` (default `skip`): skip = the item is
  left out of the output list (filter semantics), keep = the input item is kept, error = stop with
  "Item 3 reached no result". Show it in the card.
- Both branches may be wired back to `result` (through different cards) — the first value that
  reaches `result` wins for that item.
- Unit tests for the loop rules with a pure helper; e2e: list "1,2,3,4" → For each → If (item > 2)
  `then` → Result ⇒ output "3,4"; with `noResult: keep` ⇒ "1,2,3,4".

## C. Model provider outputs

Add outputs `modelId` (text: the chosen model id) and `baseURL` (text) next to `model`. Rows at the
bottom of the card, each with its own dot and label.

## D. Raw model: fetch models

Raw model has a free-text model field. Add a **Fetch models** button next to it (uses its `url`
and `keyRef` through `POST /api/providers/models` like the Model provider card) and turn the field
into a searchable `UiSelect` filled with the fetched ids (keep free text allowed: an "Other…"
entry or typing in the filter). Store the list in an optional `models` field.

## E. HTTP request: import from text

A user pastes a captured request. Support:
- a **cURL** command (`-X`, `-H`, `-d` / `--data` / `--data-raw` / `--data-binary`, `-b` / `--cookie`,
  `-u user:pass`, `--url`, quoted args, line continuations `\`, ignore `--compressed`, `-s`, `-L`,
  `-k`);
- a **raw HTTP request** (request line `POST /path HTTP/1.1`, `Host:` header gives the URL,
  headers, blank line, body);
- browser "Copy as fetch" (`fetch("url", { method, headers, body })`).

Pure parser `shared/httpImport.ts` → `{ method, url, query, headers, body, auth?, cookies? }`
(cookies stay a `Cookie` header; `Authorization: Bearer x` / `Basic` become auth fields whose
secret goes to the secret store via `authRef` — never kept in the card). Tests for each format.

UI: an **Import request…** button in the HTTP card opens a small text area dialog → fills the
fields. Also a new input `request` (text): when wired, its text is parsed at run time and
overrides the card's fields (so a captured request from another card can drive it).

## Done when

typecheck + unit tests + `npm run test:e2e` pass; new tests for B, E and the If-port drag.
