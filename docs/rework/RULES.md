# Rules for the coding agent (read first, follow always)

Project: `~/dev/tldraw-video-canvas` — React 19 + tldraw 5.5.2 canvas with a node-workflow system,
a Hono server (`server/`), and an Electron shell. Node types live in
`client/pipeline/nodes/types/*.tsx` and are registered in `client/pipeline/nodes/nodeTypes.tsx`.

## Scope

- Implement **only** the work package you were given. Do not refactor unrelated code, rename
  unrelated files, or "clean up" other features.
- Do **not** commit, push, tag, or change git config. Leave the work as uncommitted changes.
- Do **not** add npm dependencies unless the WP guide names them. Install named ones with
  `npm i -D <name>` (all packages are devDependencies; the app is bundled).
- Do not edit `data/`, `.github/`, `electron-builder.yml`, `package-lock.json` by hand.

## Saved canvases must keep loading (critical)

Users have canvases saved in the browser. A validation error makes the whole canvas fail to load.

- A **new field** on an existing node type must be optional: `T.string.optional()`,
  `T.number.optional()`, etc., and code must handle `undefined`.
- Never remove or rename a field of an existing node type. Stop using it instead.
- To **remove a node type**, move it to `RemovedNodeDefinitions` in `nodeTypes.tsx` with
  `removedNodeDefinition('<type>', '<Old title>')`. Never delete the type id.
- To **rename** a node for users, change its `title`/`heading`; keep the `type` id.
- Shape `props`/`meta` updates merge: to clear a meta key, set it to `null`.
- Tldraw props passed to `<Tldraw>` (callbacks like `getShapeVisibility`) must be stable
  (module-level or `useCallback`), or the editor is rebuilt in a loop.

## Look and feel (tldraw style)

- Use the UI kit in `client/ui/` (created in WP1): `UiButton`, `UiIconButton`, `UiSelect`,
  `UiMultiSelect`, `UiTextInput`, `UiTextArea`, `UiNumberInput`, `UiCheckbox`, `UiSlider`,
  `UiSegmented`, `UiField` (label + control row), `UiSection`, `UiChip`, `UiEmpty`, `UiTable`,
  `UiErrorBanner`, `Icon`.
- Only tldraw CSS variables: `--tl-color-panel`, `--tl-color-low`, `--tl-color-muted-1/2`,
  `--tl-color-text-1/3`, `--tl-color-divider`, `--tl-color-selected`, `--tl-color-primary`,
  `--tl-color-danger`, `--tl-color-warning`, `--tl-color-success`, `--tl-color-hint`,
  `--tl-space-1..10`, `--tl-radius-1..4`, `--tl-shadow-1..4`, `--tl-font-sans`, `--tl-font-mono`.
  No hex or rgb colours in new CSS (port data-type colours in `constants.tsx` are the only exception).
- Sizes inside nodes in `em` (relative to the node font), so the A−/A+ node font setting scales them.
- Icons: SVG components in `client/ui/icons.tsx` (stroke `currentColor`, 1.5 px, 16×16 viewBox),
  never emoji or text glyphs (no ✦ ★ × ⋯ as icons).
- Every control inside a node stops pointer events from reaching the canvas
  (`onPointerDown={stopEvent}`), and text fields stop key events.
- Must look right in light **and** dark mode (`.tl-theme__dark`).

## Node conventions

- A node's `execute` reports failure by **throwing** an `Error` with a short, human message
  (what failed + what to do). The engine records it in run state and shows the error banner.
  Nodes that also store `node.error` keep doing so (the banner shows either).
- Do not swallow errors into normal output values.
- Long text in a node scrolls inside its own box; it never grows the card by itself.

## Code style

- TypeScript strict; match the surrounding code (tabs, single quotes, no semicolons).
- Short comments only where the why is not obvious.
- Pure logic goes in `shared/` (testable in Node); React/tldraw code in `client/`.

## Before you finish

Run and make pass:

```bash
npm run typecheck
npx vitest run
```

Then write a short report: files changed, what you did, anything you could not do, and how to
check it in the app.
