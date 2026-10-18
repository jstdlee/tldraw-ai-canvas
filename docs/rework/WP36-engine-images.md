# WP36 — Engine behaviour, Merge, number wiring, images, files

Read `RULES.md` and `docs/review/2026-10-18/{flow,image,data,gaps}.md` for each ID.

## Engine
- **DATA-02** A failed run's error banner renders outside the card box and is often hidden under tldraw's bottom
  toolbar; the Run button shows "NNN ms" as if ok. The error must be visible on the card (inside its bounds, or
  the card grows/zooms into view), and the Run button shows a failed state.
- **FLOW-04** Stop does not interrupt Sleep (sleep ignores AbortSignal) → abortable sleep, status "stopped".
- **FLOW-06** A card whose Run was clicked but waits for upstream shows no busy state.
- **FLOW-08** First edit of a new card undoes together with its creation.
- **IMAGE-03** A cache-hit Run never clears the card's out-of-date flag.
- **GAPS-13** "Symbol(STOP_EXECUTION)" shown as a value on untaken branches → show "not taken" (muted).
- **G / GAPS-11** Text outputs can be wired into number fields/ports: allow the wire; coerce at run; clear
  error "To must be a number, got 'abc'".
- **I Merge** (new card `merge`, group Flow): inputs `in1..inN` (N grows as you wire, like Code inputs), output
  `output`; field `mode`: first that arrives / all joined (separator) / all as JSON. Untaken (STOP) branches are
  skipped; "first" runs as soon as one branch delivers. Register everywhere (see WP35 list).

## Images and files
- **FLOW-02** Image cards reject same-origin relative URLs (`/examples/x.jpg`); 4 bundled examples broken.
- **IMAGE-01** Load image says "paste" but there is no paste: support Ctrl+V of an image (and of an image URL)
  when the card is selected / its drop zone focused; also paste onto the canvas creates a Load image card? (only
  the card part is required).
- **IMAGE-02 / P Gallery** Output card shows a broken image for a multi-image value → render a grid. New card
  `gallery` (group Output): input `images` (lines / JSON list / table column `url`) → grid with columns field,
  click → ImageZoom, "Download all" (zip) ; output = the same list.
- **IMAGE-05** consistent error for a broken URL (field vs wired). **IMAGE-06 / GAPS-17 / O** download/save
  names: card title or result-based name, extension follows the real content type; Save `fileName` supports
  `{{index}}`, `{{name}}`, `{{date}}`; mode new file / overwrite / append (append = one line/row per run).
- **FLOW-03** "Chat message" example broken (Prompt into "Reply to" seeds history, not the message): fix the
  card so a wired message input is sent, and fix the example.
- **FLOW-05** Group as box exposes every unconnected field of every member as a port → only wired-across-boundary
  ports plus dedicated inputs/outputs of edge cards; field ports only when the user marks them.
- **UI-06** LoadImageNode "Load" button truncated to "L…".

## Tests
e2e per item (Stop during Sleep, error banner visible after zoomToFit, number wiring, Merge first/all with a
Decision switch, relative example images, paste, gallery, save names, chat example, group ports); unit where pure.
