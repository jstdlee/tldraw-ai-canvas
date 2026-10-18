# Image review — load, chains, generation, camera, output

Area: `image`. Tested against a local build on web `:5203` / API `:8833`, Chromium via
Playwright, using the local Magpie router (`http://127.0.0.1:3425`). Specs live in
`tests/review-tmp/image/*.spec.ts` (not product code, deleted after this report). Screenshots,
logs and test images are under
`/tmp/claude-1000/-home-leilei-dev/b748c873-b27f-4f05-99d7-ad20f0decaac/scratchpad/review/image/`
(`screens/`, `testimages/`, `pw-out/`). Test images (a 832×1248 photo, a 200×100 four-colour
swatch for pixel checks, a transparent-gradient PNG, a 4000×3000 JPEG, and an SVG) were served
from a tiny local HTTP fixture server (`fixture-server.mjs`, port 5940) so "load by URL" exercised
a real network request, not just a `data:` URL.

## 1. Summary

Tested: Load image by URL (Source field + Load button, and a wired `url` text port), by upload
(native file picker), by HTML5 drag-and-drop, and by clipboard paste; Crop (all 6 aspect presets
+ custom box, including a live custom-box edit); Resize (all 5 modes: fit/exact/scale/width/
height); Filter (all 8 sliders, all presets, rotate, flip X/Y, restore default); Image tools (all
9: info/convert/pixelate/border/round/watermark/square/data_url/look); the legacy, hidden Adjust
node; Generate image (model availability, then 2 real generations once a model was added per the
coordinator's note); Chat-card vision (a real model describing an attached photo); Camera (fake
video device) and Capture (canvas-region snapshot); Save-to-file, the footer menu's "Download
image," the "Put output on canvas" spill toggle and its one-label-per-run rule, the ImageZoom
expand dialog, Generate image's multi-tile grid, wiring an image list through For Each, and the
generic Output card with both a single image and a multi-image value; a 4000×3000 JPEG for speed/
memory, a transparent PNG through resize and jpeg-conversion, an SVG through the full pipeline,
and three broken/not-an-image URL cases. 56 automated checks, all passing (pixel-sampled where it
mattered, not just "no exception"), plus manual screenshot review of every scenario.

**Counts by severity:** P0: 0. P1: 2. P2: 4.

**Top problems:**
1. **IMAGE-01** — The Load image card's own placeholder text promises "paste," but no paste
   handler exists anywhere in the app (node or canvas) — pasting an image does nothing, silently.
2. **IMAGE-02** — The generic Output card (`kind: image`) renders a broken image icon instead of
   anything useful when its input is a multi-URL value — which a normal pipeline produces
   whenever Generate image's "All images" port or a For Each over images feeds it directly.
3. **IMAGE-03** — A cache-hit "Run" never clears a card's stale/"out of date" flag, so a card can
   finish a run and still look (and stay) marked as needing another one.
4. **IMAGE-04** — The keyless Magpie config ships with zero image-generation-capable models, so
   Generate image is non-functional out of the box; once a model is configured it works well.
5. **IMAGE-05** — The exact same "image failed to load" error is shown two different ways
   depending on whether the broken URL came from the Source field or a wired port.

## 2. Findings

### IMAGE-01 — P1 — "Paste" is advertised but not implemented anywhere

**Steps:** Insert a Load image card. Read its empty-state placeholder. Copy an image, focus the
card (or the empty canvas), press Ctrl+V / dispatch a `paste` ClipboardEvent carrying an image
`File`.
**Expected:** Either the image loads into the card (what the text promises), or — at minimum —
pasting an image somewhere sensible (e.g. onto the canvas, for the user to then wire in) works.
**Actual:** Nothing happens. `node.imageUrl` stays `null`; no error, no toast, no shape created.
Reproduced twice (direct ClipboardEvent dispatch on the card, and on the empty canvas). A
repo-wide search for paste handling (`onPaste`, `addEventListener('paste', ...)`) outside an
unrelated icon name in `client/ui/icons.tsx` finds nothing — there is no paste path to fail into,
it simply was never wired up.
**Evidence:** `tests/review-tmp/image/01-load-image.spec.ts` ("paste" test, passes by confirming
`imageUrl` stays null); `.../screens/load-paste-attempt.png` shows the card still on its "Drop,
browse, paste, or enter a URL" empty state after the paste attempt.
**Suspected cause:** `client/pipeline/nodes/types/LoadImageNode.tsx:243` — the placeholder text
lists "paste" as a supported input method, but `LoadImageNodeComponent` (same file) only wires
`onDrop`/`onDragOver`/`onDragLeave` and a `Browse...` file picker; no `onPaste` prop anywhere, and
no document/window-level `paste` listener exists in the codebase.
**Suggested fix:** Either add a real `paste` handler (read `ClipboardEvent.clipboardData.files`/
`.items`, reuse the existing `handleFile`/`readFileAsDataUrl` path already in this component —
it's a small addition), or remove "paste" from the placeholder text so the UI stops promising a
feature that doesn't exist.

### IMAGE-02 — P1 — Output card shows a broken image for a multi-image value, not a grid or an error

**Steps:** Wire Generate image's "All images (JSON)"-adjacent text port (`images`, which is
really the result URLs newline-joined, e.g. for Place/Use-as-ref downstream use) — or a For Each
node looping over a list of image URLs — directly into a generic Output card set to "Image" (or
"Auto," which resolves to "Image" for this value). Run it.
**Expected:** Something legible: the first image, a small gallery, or a clear "can't preview
multiple images" message.
**Actual:** The `<img>` gets a `src` with an embedded newline between two `/api/images/...` URLs
(e.g. `src="/api/images/img_..._a57b4269\n/api/images/img_..._64a1b024"`), fails to decode, and
renders as a broken image with a collapsed (0×0) box — worse than doing nothing, since the card
looks broken rather than merely limited. Reproduced twice with two different stored image URLs.
**Evidence:** `tests/review-tmp/image/06-save-spill-grid-foreach-output.spec.ts` ("multi-image
list... renders a broken image" test); `.../screens/output-card-multi-image-broken.png`.
**Suspected cause:** `client/pipeline/ValuePreview.tsx:22` — `{k === 'image' &&
<img className="ValuePreview-image" src={value.trim()} alt="" draggable={false} />}` passes the
raw text value straight into `src` with no check for more than one URL (contrast with
`ImageGenNodeComponent`'s own result grid in `client/pipeline/nodes/types/ImageGenNode.tsx`,
which already knows how to parse and tile a JSON array of URLs — `parseImages`/the
`ImageGenNode-tiles` grid).
**Suggested fix:** In `ValuePreview`, detect a multi-line/JSON-array image value and either show
the first image with a "+N more" affordance, or reuse the same tile-grid component Generate image
already has. At minimum, split on `\n` and use only the first URL so the image actually renders.

### IMAGE-03 — P2 — A cache-hit "Run" never clears the card's "out of date" flag

**Steps:** Run an image-processing card once (clears `isOutOfDate`). Touch one of its fields in a
way that re-marks it out of date without actually changing the computed result (e.g. any
`updateNode` call), then press Run again with nothing about its real inputs changed, so the
execution engine's input-hash cache hits.
**Expected:** The card finishes the run and shows as up to date again, the same as a real
recompute does.
**Actual:** The run reports success ("cached") and the footer still just says "Run" (no distinct
"cached" label visible in the UI), but `shape.props.isOutOfDate` stays `true` — confirmed twice
via a direct prop read right before and after the cache-hit run. Anything gated on that flag (the
dimmed/"loading" preview styling several image cards use, e.g. `AdjustNode`'s
`NodeImagePreview_loading` class, and the one-output-label spill logic) stays in the "stale"
state indefinitely until a real (non-cached) run happens.
**Evidence:** reproduced via a small diagnostic script (not part of the kept test suite) that
printed `isOutOfDate` before/after two independent cache-hit runs — both `true` after,
`false` after the preceding real run. Also what originally made the "one output label" test
(`06-save-spill-grid-foreach-output.spec.ts`) fail until it was switched to a real,
`noCache: true` re-run: a second plain "Run" never re-executed at all, which is the cache
behaving as designed — it's only the leftover `isOutOfDate: true` that looks wrong.
**Suspected cause:** `client/pipeline/execution/ExecutionGraph.tsx:221-238` — the cache-hit
branch (`lastRunHash === hash`) sets `nodesById`/calls `setNodeRun(..., { status: 'ok', message:
'cached' })` and returns early; it never calls the `editor.updateShape({ props: { isOutOfDate:
false } })` that the normal path does at line 278 after a real `executeNode` call.
**Suggested fix:** Clear `isOutOfDate` in the cache-hit branch too (it's a one-line addition right
before the early `return` at line ~238). Cross-cutting — not image-specific — but very visible on
image cards because of their dimmed-preview styling.

### IMAGE-04 — P2 — The keyless config ships with no image-generation model; Generate image is otherwise solid

**Steps:** Open a fresh canvas with the shipped `ai-config.magpie.json`-style keyless config (no
manual provider setup). Insert "Generate image." Open its model dropdown.
**Expected:** Either a working default image model, or at least a clear explanation of what to
configure.
**Actual:** None of the 21 models in the shared keyless fixture declare an `"image"` capability
(confirmed by reading the file and by a live probe of the local Magpie router's own `/v1/models`
— 26 models, same result: zero with an `image` output modality). The card itself doesn't
misbehave — the model select just quietly offers nothing image-capable — but the feature is a
dead end for anyone starting from this config. Per the coordinator's note, adding one model entry
(`antigravity/gemini-3.1-flash-image`, capability `"image"`) to the config fixed this
immediately: a real `n: 2` generation returned two well-composed, correctly on-prompt
illustrations in ~13s (`.../screens/image-gen-real-result.png`), and the result grid, "Place,"
"Use as ref.," and "Download" all worked correctly.
**Evidence:** `tests/review-tmp/image/04-gen-vision.spec.ts`; `.../screens/image-gen-card-empty.png`,
`.../screens/image-gen-real-result.png`.
**Suspected cause:** Not a code bug — a content/config gap in the shipped keyless fixture
(`shared/nodeSpecs.ts`'s `image_gen` spec and the card code are both correct; there's just
nothing in `ai-config.json` with `capabilities: ["image"]` by default).
**Suggested fix:** Ship at least one image-capable model (even a clearly-labelled "needs your own
key" placeholder) in the default/example config, or have the card itself show an explicit
"No image model configured — add one in AI providers" message instead of a silently-empty
dropdown.

### IMAGE-05 — P2 — Inconsistent error UX for the same failure (broken URL)

**Steps:** On a Load image card, type a URL that 404s into the Source field and press "Load."
Separately, wire a text node carrying that same broken URL into the card's "url" port and press
the card's own Run.
**Expected:** The same failure, reported the same way (or at least both equally clear).
**Actual:** Source-field path: a clear inline message inside the preview area, "Failed to fetch
image: 404" (`.../screens/broken-url-inline.png`). Wired-port path: the generic card-level red
error banner (`.NodeErrorBanner`, "Run failed / Failed to fetch image: 404" —
`.../screens/broken-url-banner.png`), which in that screenshot sits partly under the canvas's
bottom toolbar depending on where the card is on screen. Both messages are individually clear and
correctly worded, but a user wiring a URL in (the more "pipeline-native" way to do it) gets a
different, more generic-looking failure style than one just typing a URL in directly.
**Evidence:** `tests/review-tmp/image/07-large-transparent-svg-broken.spec.ts` ("Broken URL"
tests); the two screenshots above.
**Suspected cause:** `client/pipeline/nodes/types/LoadImageNode.tsx` — the Source-field path goes
through the component's own `loadSource()` (lines ~186-196), which has a `try/catch` and sets
local `loadError` state; the `execute()` method (lines ~77-87, used for the wired `url` port) has
no `try/catch` at all, so the same thrown error instead falls through to the execution engine's
generic per-node error banner.
**Suggested fix:** Either give `execute()` the same try/catch-and-report pattern so both paths
render identically, or intentionally keep the banner for the port path but document the
difference — currently it looks like an oversight rather than a choice.

### IMAGE-06 — P2 — Downloaded images are never named for the card or result

**Steps:** Run a Filter (or any) image card with a visible result. Open its "…" footer menu →
"Download image." Do it again from a different card, or from a second tile in a Generate image
grid.
**Expected:** A filename that helps tell downloads apart (e.g. including the card type, a
timestamp, or the result index).
**Actual:** Every download (both the per-card footer menu's "Download image" and each Generate
image tile's own "Download" button) is always named literally `image.<ext>` — `image.png`,
`image.jpeg`, etc. — with nothing identifying, so repeated downloads collide and rely entirely on
the browser's own de-duplication (`image.png`, `image (1).png`, …).
**Evidence:** `tests/review-tmp/image/06-save-spill-grid-foreach-output.spec.ts` ("Download
image" test — `download.suggestedFilename()` is exactly `"image.png"`); confirmed in source.
**Suspected cause:** `client/pipeline/nodes/NodeShapeUtil.tsx:656` (`a.download =
'image.' + ext`) and `client/pipeline/nodes/types/ImageGenNode.tsx:210` (`download(src,
'image-${i + 1}.png')`, which is a little better but still generic and ignores the real file
type — a jpeg result still downloads as `.png`-named).
**Suggested fix:** Include the node type/title and a short id or timestamp, e.g.
`crop-2026-10-18T...png`; for the Generate image tiles, use the real extension from the result's
content type, not a hardcoded `.png`.

## 3. Pipeline gaps for the image area

1. **Image gallery / grid viewer card** — inputs: a list of image URLs (newline-joined text or a
   JSON array); outputs: pass-through list, optionally a "selected" single-image output. Why:
   text→image port compatibility already makes "wire a list of images through For Each" a fully
   legal, working pattern (verified in this review), but nothing can show the results as images —
   For Each's own card has no image preview at all (just a text progress bar), and the generic
   Output card actively breaks on a multi-image value (IMAGE-02). This is the single biggest hole
   for "build a real pipeline with more than one image." Priority: high.
2. **Paste support** — see IMAGE-01. Priority: high (already promised by existing UI text).
3. **Image compositing / overlay** — inputs: base image, overlay image, position or anchor,
   opacity/blend mode; output: composited image. Why: the only way to combine two images today is
   Generate image's single reference-image slot (a model call) or the text-only Watermark tool;
   there's no deterministic, free, local way to place one image on another (a logo on a photo, a
   sticker on a background). Priority: medium.
4. **Multiple reference images in Generate image's UI** — the server/params already accept an
   `images: string[]` array (`client/pipeline/nodes/types/ImageGenNode.tsx`'s `apiGenerateImage`
   call), but the card only exposes one "Ref." field/port. Priority: low-medium.
5. **EXIF / metadata strip** — Image tools has format/pixelate/border/round/watermark/square/
   data-url/info/look, but nothing to read or strip embedded metadata (location, camera info)
   before sharing a photo someone loaded or captured. Priority: low.

## 4. What works well

- Crop (all 6 aspect presets + a live-editable custom box), Resize (all 5 modes), Filter (all 8
  sliders, every preset, rotate/flip, restore-default) and Image tools (all 9 tools) all produce
  pixel-exact, correct results — verified by sampling actual output pixels and dimensions, not
  just "it didn't crash."
- SVG is handled cleanly end to end: correct intrinsic size, correct `image/svg+xml` reporting
  from the Info tool, and a crisp rasterized result through Crop — no blur or clipping.
- A 4000×3000 JPEG loads, resizes and filters quickly (each step well under a second per the
  card's own footer timer in the UI) with no crash or visible memory issue.
- Transparent PNG alpha survives a resize correctly, and is intentionally, correctly flattened to
  white by "Convert to jpeg" — matches the documented behaviour in `imageOps.ts`.
- Camera (tested against Chromium's fake video device) and Capture (a canvas-region snapshot)
  both work correctly, including wiring their output straight into a downstream Filter.
- The "one output label per run" rule for "Put output on canvas" is implemented correctly: it
  adds exactly one image shape, and a genuine re-run replaces it with a fresh one rather than
  stacking duplicates (once tested with a real re-run rather than one that hits the cache — see
  IMAGE-03).
- Vision works well: attaching an image to a Chat card correctly switches its model picker to
  vision-capable models, and a real model produced an accurate, well-written description of the
  attached photo.
- Once a model is configured, Generate image itself is solid: correct prompt-following output,
  a clean multi-tile grid for `n > 1`, and working "Place on canvas," "Use as ref.," and
  "Download" actions per tile.
