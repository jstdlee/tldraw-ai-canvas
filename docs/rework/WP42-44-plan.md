# WP42-44 plan (not started, except the SDK upgrade)

## WP42 Comments (tldraw 5.6.0 is installed)
- Add `@tldraw/commenting` 5.6.0. Register `commentSchemaRecords`, `commentTools`, `commentToolOverrides`, `CanvasComments`.
- The app uses `persistenceKey`; find how to pass the records with it. Old saved canvases must still load.
- Licensed feature: runs in development with no key; production needs a tldraw license that includes commenting.

## WP43 Zip wires (interpretation to confirm)
- Command for selected wires and arrows: pull them into one shared trunk that splits at the ends, with a zip animation.
- Geometry: `getConnectionControlPoints` in client/pipeline/connection/ConnectionShapeUtil.tsx. Pure bundling logic in shared/, with tests.
- New shape fields must be optional, or get a migration step.

## WP44 One agent panel
- Dock the agent panel on the right so it pushes the canvas. It replaces the FloatingPanel in client/App.tsx.
- The header shows the live scope: general, one card, several cards, text, image. Quick actions follow the scope.
- Move these into the panel thread: BuildPanel, FillChatCard and NoteDialog (CanvasExtras.tsx), Rewrite and presets dialogs (RewriteDialogs.tsx), window.prompt in aiTextJob, toast-only runAI jobs.
- Routing, pure and tested: one card -> runNodeAssist; two or more cards -> buildWithAI; otherwise TldrawAgent. Remove the Draw/Build chip.
- Add a `build-workflow` agent action, so a general request can build cards.
- Add a task item to ChatHistoryItem. Today plan entries are local state and always render last.
- Update e2e: wp23, wp28, wp32, wp37, ai-catalog-ports.
- Compare stays a dialog; it is not an AI task.
