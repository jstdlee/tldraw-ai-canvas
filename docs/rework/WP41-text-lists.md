# WP41 — List formats in text (bullets, numbers, checklists)

Every rich-text shape (text, note, geo label) can hold lists.

## What the user gets

- **Typing shortcuts** while editing: `- ` bullets, `1. ` numbers, `[ ] ` (or `[x] `) checklist.
  Enter adds an item, Enter on an empty item leaves the list, Tab / Shift+Tab nest.
- **Keys**: Ctrl+Shift+8 bullets, Ctrl+Shift+7 numbers, Ctrl+Shift+9 checklist.
- **Selection toolbar**: Bold, Italic, Code, Link, Bulleted list, Numbered list, Checklist, Highlight.
- **Tick on the canvas**: click a checkbox without entering edit mode. One undo step, no selection change.
  Locked shapes and read-only mode ignore the click.
- **Context menu → List**: Bulleted list / Numbered list / Checklist / Plain paragraphs for all selected
  text shapes.
- Ticked items are struck through and dimmed.

## Plain text round trip (AI)

`shared/richTextLists.ts`:

- `textToRichText(text)`: list lines in AI answers become real lists. Text with no list lines gives the
  same document as tldraw's `toRichText`. Used where AI or pipeline text becomes a text card
  (placeOnCanvas, autoSpill, arrows, rewrite, agent create for text/geo/note).
- `richTextToPlain` / `listAwareText`: shapes with lists go to the AI with `- `, `1. `, `- [x] ` markers
  (tldraw's own plain text drops them). Used in `shapeText` and the agent's focused-shape format.
- `setListKind`, `toggleTaskAt`, `countTasks`.

## Code

- `client/text/listFormat.tsx`: TipTap extensions (tldraw's set + TaskList/TaskItem), the toolbar
  (copy of tldraw's DefaultRichTextToolbar, which has a fixed button list and does not export its link
  editor), `registerChecklistClicks`, `formatSelectionAsList`.
- `client/text/lists.css`: checklist look, for static HTML and the edit-mode node view
  (TaskItem gets `data-type` through HTMLAttributes, because its node view does not set it).
- No schema change: lists are TipTap JSON inside the existing `richText` prop.

## Tests

- `tests/richTextLists.test.ts` (11 unit tests).
- `tests/e2e/text-lists.spec.ts` (typing shortcuts, toolbar, canvas tick + undo, context menu).
