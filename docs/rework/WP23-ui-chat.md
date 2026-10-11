# WP23 — Output label, error panel, long menus, expand on outputs, agent chat that builds

Read `RULES.md` first. Owner feedback from a test round (2026-10-11).

## A. At most one output label on the canvas

Cards without their own output view spill their result onto the canvas as a text/image shape
(`client/pipeline/autoSpill.ts`, `MAX_HISTORY = 12`: every run adds one more label beside the card).
Owner: keep **one** label. Each run replaces the previous label's content (same shape, updated
text/image) instead of adding a new one; old extra labels from earlier runs are removed on the next
run. Keep the "Put output on canvas" menu toggle.

## B. Error panel open, with icons

The error panel under a card is collapsed at the bottom. Show it **expanded** by default (full
message, wraps, max-height with scroll inside), with a collapse chevron to fold it. Copy and Fix with
AI become `UiIconButton`s (`IconCopy` with a done flash, `IconSparkle` "Fix with AI") plus the close
icon — no text buttons.

## C. Long menus

The DataPipe operation menu (~30 entries) does not fit: entries are cut off. Fix it in the kit so
every long select benefits:
- `UiSelect` / `UiMultiSelect` menus get a max height (min(60vh, 420px)) with scrolling inside, and
  keep the selected item scrolled into view when opened.
- With more than 10 options, a search box sits at the top of the menu (autofocus, filters by label,
  hint and group; ↑/↓/Enter).
- Grouped options keep their group headings while filtering.
Also check the tldraw context menu: the right-click "Insert" submenus must scroll if taller than the
viewport.

## D. Expand icon on every output

Every output view in a card (text results, JSON, tables / `UiTable`, the Profile table, images,
image grids, chart previews, Database results) gets the same hover-visible expand icon (`FieldMax`)
that opens the large viewer: text → `LargeEditor` read-only, table → a full-size scrollable table
view, image → `ImageZoom`. Add a full-size table viewer for tabular outputs (sticky header, all rows
up to 5 000, copy as CSV).

## E. Agent chat panel

The agent chat (floating ✦ button → chat window, `client/App.tsx` `.chat-float-modal`,
`client/components/ChatInput.tsx`, `ChatPanel`) looks out of place and cannot move. Put it in the
WP22 `FloatingPanel` (`client/ui/FloatingPanel.tsx`): draggable header, resizable, remembered
position, tldraw styling, close icon. NOTE: `client/App.tsx` has another person's uncommitted edits
— change only the chat mount block, minimally, and list the lines.

## F. Chat with selected cards builds with them

Owner: "agent chat is good for casual chat and drawing; when I select objects, the purpose is to use
the selected objects, connect them together and fill parameters, not draw them."
- When the chat is sent and the current selection contains cards (node shapes), do **not** send it
  to the drawing agent. Run Build with AI (`client/pipeline/aiBuild.ts` `buildWithAI`) with the chat
  text as the goal and the selection as scope, and show the result **inside the chat thread** as a
  plan message: summary, the plan rows (same rendering as the Build panel), and buttons **Apply**,
  **Open in Build panel**, **Revise** (focuses the input). Apply = `applyAiPlan` with arrange.
- A small chip above the input shows the mode: "Drawing" (no cards selected) or "Building with N
  cards" (cards selected); clicking it toggles to force the other mode for this message.
- Remove the WP22 "Build with cards instead" hint (this replaces it).

## Tests

e2e: long select shows all options by scrolling and filters by typing; error panel expanded with icon
buttons; one spill label after two runs; chat with selected cards shows a plan message (mock the
model: intercept `/api/generate-text` in Playwright and return a fixed plan JSON).
