# WP40 — Canvas-native table (presentation and management lists)

Read `RULES.md`. Owner: a table that lives on the canvas like a drawn object, for presentation and for managing
small lists (issue list, PR list, checklist, plan, comparison). Edited by hand. NOT for large data (that stays
DataPipe / Table view). Typical size: 3–15 columns, up to ~200 rows.

## Shape
A new tldraw shape type `table` (its own ShapeUtil, not a pipeline card: no card header, no Run button). Looks like
a clean drawn table that follows tldraw styles (color, size → font size, font, dash for borders where sensible),
light and dark. Props (versioned with a props migration sequence from v1):
`columns: [{ id, name, width, type, align?, options? }]`, `rows: [{ id, height?, color?, cells: { [colId]: value } }]`,
`headerRow: boolean`, plus tldraw style props. Validators for everything.

## Column types (presentation-friendly)
text (wraps), number (right-aligned), status/select (coloured pill; options with colours editable, e.g.
Open / In progress / Review / Done), checkbox, date (date picker), link (shows title/host, click opens in a new tab
with confirmation only via a modifier or explicit icon — never on plain click while editing), person/owner (text with
initials avatar). Changing a column's type keeps values where they convert.

## Editing (the core)
- Select the table like any shape; move, resize (resizing scales column widths proportionally), rotate off.
- Double-click a cell (or Enter) to edit; Esc cancels, Enter commits and moves down, Tab / Shift+Tab move across,
  arrow keys move between cells when not editing; typing on a selected cell starts editing.
- Drag a column's right border to set its width; drag a row's bottom border to set its height; **double-click a
  column border to auto-fit** the column to its content (measure all its cells + header); double-click a row border
  to auto-fit its height.
- Insert / delete rows and columns: right-click menu (Insert row above/below, Insert column left/right, Delete,
  Duplicate row), hover "+" handles at the end of the last row/column, Ctrl+Enter adds a row below.
- Reorder rows and columns by dragging a row/column handle.
- Row background colour and column alignment from the context menu; header row on/off.
- Sort by a column (one-time reorder, undoable), from the column header menu.
- Paste: TSV/CSV/Markdown from Excel, Google Sheets, GitHub, or another table pastes into cells starting at the
  selected cell (grows the table as needed); pasting a table onto the empty canvas creates a table shape.
- Copy: selected cells as TSV; table menu "Copy as Markdown" / "Copy as CSV".
- Every committed edit is ONE undo step (no undo per keystroke).
- Keyboard/pointer events must not leak to tldraw while editing a cell; canvas shortcuts work again after Esc.

## Insert
Toolbar/insert menu "Table" with a hover size picker (up to 10×10); Ctrl+P "Insert table"; templates:
**Issue list** (#, Title, Status, Owner, Priority, Due), **PR list** (PR, Title, Author, Status, Reviewer, Link),
**Checklist** (Done ✓, Item, Owner, Notes), **Comparison** (Feature, A, B, C).

## Pipelines (secondary, keep it simple)
Context menu "Use as data": creates a Prompt card next to the table with the table as CSV and wires nothing else;
AND, if the connection system can support it with modest work, an output port on the table shape (CSV) so a wire
can go table → DataPipe/Chart/For each. Investigate `client/pipeline/ports/*` and the connection shape; if a port on a
non-node shape is a large change, do only "Use as data" and report why.

## Agent
The canvas agent can create a table (new action: columns, rows) so "make a PR list table with these 5 PRs" works;
add it to the agent action schemas and mode definitions with a unit test for the action parser.

## Performance and limits
200 rows × 10 columns must stay smooth when panning and editing (render only what is needed; no per-keystroke
re-layout of the whole table). Above ~500 rows show a hint to use DataPipe / Table view.

## Tests
Unit: props validation and migration, TSV/Markdown paste parsing, auto-fit width calculation, sort. e2e: insert 4×3,
edit cells with keyboard navigation, resize a column by dragging, double-click border auto-fit, insert/delete
row/column via context menu, paste a TSV block, undo per edit, template insert, dark mode screenshot, save/reload.
Screenshots light and dark of an Issue list and a PR list with real-looking content; look at them and polish.
