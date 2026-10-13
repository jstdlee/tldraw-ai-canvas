# WP29 — HTML preview card and HTML form card

Read `RULES.md` first. Owner: "add an output of html, js, css preview for html code pieces; add a
preview where the result is cards / buttons / options that need a user click, and when clicked
the output is the form's JSON for the next input".

## Common: the sandboxed preview
- Input text may be a full HTML document, an HTML fragment, or LLM output with fenced blocks
  (```html, ```css, ```js / ```javascript): split and assemble one document (pure helper in
  `shared/htmlPreview.ts`, unit-tested). Separate wirable inputs `html`, `css`, `js` override.
- Render in an `<iframe sandbox="allow-scripts allow-forms">` with `srcdoc` — **never**
  `allow-same-origin`, no access to the app, the API or cookies. A CSP meta in the document
  blocks network by default (`default-src 'none'; img-src data: blob: https:; style-src
  'unsafe-inline'; script-src 'unsafe-inline'`); a card option "Allow network" relaxes it.
- In-card preview with a height field and the expand icon → large view (`LargeEditor` /
  FloatingPanel style dialog). The iframe never steals canvas pointer events when not focused.

## A. `html_preview` card (group Output)
Inputs `text`, `html`, `css`, `js`. Outputs `html` (the assembled document). Shows the live preview.

## B. `html_form` card (group Input)
Same inputs and preview, plus an injected bridge script that reports user interaction to the
card via `postMessage` (check `event.source === iframe.contentWindow`, validate the payload shape,
cap size 1 MB):
- a `<form>` submit → JSON object of its fields (FormData; repeated names → arrays; checkboxes →
  booleans; numbers stay strings unless `type=number`);
- a click on a `button`/`[data-value]`/`a[data-value]` outside a form → `{ "clicked": label,
  "value": data-value or value, ...data-* }`.
- Output `json` = the last submission (pretty JSON). When the card runs, it renders and **waits**
  for the user's submission (progress "waiting for input…"), then outputs and the pipeline
  continues; Stop cancels. A "Submit again re-runs downstream" behaviour: a new submission marks
  downstream out of date and re-runs it.
- Example: a Prompt → LLM "make 3 option cards for X as HTML" → HTML form → If on `value`.

Register both everywhere (registry, nodeGroups, catalog, descriptions, nodeSpecs with chips,
examples, wireFieldCoverage, output-dots). Old canvases unaffected.

## Tests
Unit: fenced-block splitting and document assembly; bridge payload validation. e2e: preview
renders a fragment (check inside the iframe); form card — click a button in the iframe → `json`
output has the value; a form submit → field JSON; sandbox has no `allow-same-origin`.
