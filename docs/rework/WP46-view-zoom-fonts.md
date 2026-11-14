# WP46 — Auto center, better zoom, default font sizes

Read `docs/rework/RULES.md` first. tldraw is 5.6.0. Read the camera API in
`node_modules/@tldraw/editor/dist-esm/index.d.mts` (`TLCameraOptions`, `zoomSteps`, `wheelBehavior`,
`zoomToFit`, `zoomToSelection`, `zoomIn`, `zoomOut`, `getViewportScreenBounds`).

## 1. Auto center

- **On load**: when the app opens a canvas, show the content: zoom to fit all shapes, at most 100 %
  zoom (a small canvas does not jump to 800 %), with padding that keeps content clear of the
  toolbar at the bottom, the left library sidebar and the right agent dock. Skip this when the
  canvas is empty (center the page origin at 100 %).
- **When the viewport size changes** (library sidebar or agent dock opens or closes, window resize):
  keep the point that was at the center of the canvas at the center. Today the content slides
  under the panel.
- **Center view** (existing action, `client/clips/CanvasMenus.tsx` `centerView`): fit the selection if
  there is one, else all content, with the same rules. Shortcut **Shift+1** fits all (tldraw's own),
  **Shift+2** fits the selection; check both still work and both use these padding rules.
- **After a big insert** (template, example, AI plan apply, paste of many shapes): if the new shapes
  are off screen, pan (do not zoom) so they are in view, with a 200 ms animation.

## 2. Better zoom

- **Wheel / trackpad**: Ctrl+wheel and pinch zoom around the pointer, smooth, no jump between steps.
  Plain wheel pans (keep tldraw's default unless it is set otherwise; check `wheelBehavior`).
- **Zoom steps** for Ctrl+= / Ctrl+-, the zoom menu and the buttons:
  10, 25, 50, 75, 100, 125, 150, 200, 300, 400 %. Min 5 %, max 800 %.
- **Zoom readout** (the % button bottom left): click opens the menu as today; add **Zoom to 100 %**,
  **Fit all**, **Fit selection** with their shortcuts.
- **Zoom toward the pointer** for keyboard zoom when the pointer is over the canvas, else the center.
- **Double-click empty canvas with Shift**: zoom in one step at that point (only if this does not
  clash with an existing double-click action; check `client/` for canvas double-click handlers).
- Respect `prefers-reduced-motion` (no zoom animations).

## 3. Default font sizes

Review the defaults, then set them so a new canvas at 100 % zoom is readable and cards look
balanced with text:

- New pipeline cards: `NEW_NODE_FONT_PX` (16) vs `DEFAULT_NODE_FONT_PX` (20) in
  `client/pipeline/constants.tsx`. Pick one default so a card's title, fields and ports are readable
  at 100 % and a card is about 300–360 px wide. Old cards keep their stored `fontSize`.
- New text, note and geo shapes: tldraw's default size `m` is large next to cards. Set the default
  text style so a new text shape matches the card body text size at the same zoom (use tldraw's style
  API, `editor.setStyleForNextShapes`, on mount; do not change existing shapes).
- Clip shapes (Markdown, Mermaid), the table shape and the comment layer: check they use the same
  base size and are readable at 100 %.
- Inside cards all sizes must stay in `em` (RULES.md).

Write the before / after values and the reasons in a short table at the end of this file.

## Tests

- E2E `tests/e2e/view-zoom.spec.ts`: on load the content is in view and no shape is under the
  toolbar or a panel; opening the agent dock keeps the center point; Ctrl+= steps through the zoom
  steps; Shift+2 fits the selection; a new text shape and a new card have the expected font sizes;
  inserting an example far away pans it into view.
- Check that existing specs that call `zoomToFit` or assume a zoom level still pass: run
  `tests/e2e/output-dots.spec.ts`, `error-banner.spec.ts`, `culled-anchors.spec.ts`,
  `wp39*`, `agent-dock.spec.ts`.

## Done means

`npx tsc --noEmit -p .` clean, `npx vitest run` green, your spec and those specs pass with
`CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=2000 E2E_WEB_PORT=5204 E2E_API_PORT=8804 npx playwright test <files>`.
Do not run the whole e2e suite. Do not commit.
