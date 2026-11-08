# WP44 — One agent panel, docked on the right

Read `docs/rework/RULES.md` first. tldraw is now 5.6.0.

## Goal

There is **one** AI surface: the agent panel, **docked on the right edge of the window**. It is
part of the layout (it takes a column; the canvas gets narrower), not a floating window over the
canvas. Every AI feature runs in it. There is no separate "AI" versus "agent" any more:

1. The panel reads what the user selected (the **scope**): nothing, one card, several cards, text
   shapes, an image, or a mix.
2. The user gives the need: a quick action chip, or free text.
3. The panel routes the task, shows it in one thread, and gives the result as a reply, a change on
   the canvas, or a change to the selected objects (with Apply where the change needs a review).

## Today (to replace)

| Today | File | After |
|---|---|---|
| Agent chat in a `FloatingPanel` | `client/App.tsx` (`panels.chat`), `client/components/ChatPanel.tsx` | Docked panel |
| Draw / Build mode chip | `client/components/ChatInput.tsx` | Removed; routing is automatic |
| Build with AI `FloatingPanel` | `client/pipeline/components/BuildPanel.tsx`, `aiBuild.ts` (`$buildOpen`, `openBuildPanel`) | Plan message in the thread |
| Card AI ("fill") `FloatingPanel` | `CanvasExtras.tsx` `FillChatCard`, `assist.ts` (`$assist`, `openFillAssist`) | Assist message in the thread |
| AI answer dialog | `CanvasExtras.tsx` `NoteDialog`, `$aiNote` | Reply in the thread (remove if unused) |
| Rewrite dialog + presets dialog | `client/clips/RewriteDialogs.tsx` (`ClipModal`) | Panel sheets |
| Translate `window.prompt` | `canvasFeatures.ts` `aiTextJob` | Prefilled input in the panel |
| One-shot jobs with toasts only | `canvasFeatures.ts` `runAI` (describe, OCR, explain, summarize, improve, brainstorm) | Task messages in the thread (keep placing results on the canvas with derived links) |

**Compare** stays a dialog (it is not an AI task). The AI providers dialog stays a dialog (settings).
Pipeline cards that call AI (Agent card, Chat card, Text AI, …) are not changed.

## Layout

- `.app-layout` is already a grid `auto 1fr auto`. Put the panel in the **third column** as a
  real element (`<aside class="agent-dock tl-theme__light|dark">`), full window height, outside the
  `<Tldraw>` element like the left library sidebar. The canvas column shrinks; tldraw follows its
  container size (check that `editor.getViewportScreenBounds()` changes after open/close).
- Width: default 380 px, drag the left edge to resize between 300 and 640 px, persisted in
  `localStorage` `oh-my-tldraw:agent-dock-width`. Double-click the edge: back to 380.
- Open/closed: keep the existing `panels.chat` flag and `togglePanel('chat')`. Closed: the existing
  round button stays at the bottom right of the canvas. **Ctrl+Shift+K** opens the panel and focuses
  the input (today it is "Ask about selection…"; keep that action id, change what it does).
  Opening uses a 160 ms width transition (none with reduced motion).
- tldraw's own style panel stays inside the canvas column, so the two never overlap. Delete the
  WP32 code that offset the floating panel away from the style panel.
- Must work in light and dark mode (the dock needs the `tl-theme__*` class, see WP32 in `App.tsx`).

## Panel parts (top to bottom)

1. **Header**: title "Agent", model chip (as today in `ChatPanelHeader`), history, new chat, close.
2. **Scope bar**: one chip that says what the next task will use, updated live from the selection:
   "Canvas" (nothing selected), "Card: DataPipe", "3 cards", "2 texts", "Image", "4 items".
   A small × clears the selection. Pure function `getAgentScope(...)` in `shared/agentScope.ts`
   (input: plain descriptions of the selected shapes; output `{ kind, ids, label }`), unit-tested.
   `kind`: `'canvas' | 'card' | 'cards' | 'text' | 'image' | 'mixed'`.
3. **Quick actions** for the scope (chips, wrap to two lines max, then "More"):
   - canvas: Draw a flowchart, Build a workflow, What can you do?
   - card: the card's `NODE_SPECS[type].assistant.chips`, Explain this card, and **Fix error** when the
     card shows an error.
   - cards: Wire these up, Explain this flow
   - text: Summarize, Translate…, Improve writing, Brainstorm, Rewrite…, Make a checklist
     (Make a checklist uses `formatSelectionAsList(editor, 'task')` from WP41, no AI)
   - image: Describe, Extract text, Send to pipeline
   - mixed: Explain, Summarize
   A chip that needs one more answer (Translate…, Rewrite…) prefills the input or opens a sheet;
   the others run at once.
4. **Thread**: the agent chat history (`ChatHistory`) with task messages in it, in time order.
5. **Sheet** (optional, above the input): Rewrite (preset chips + note, as in `RewriteDialog`) and
   Rewrite presets editor (as in `PresetsEditor`). Escape or Cancel closes the sheet.
6. **Input**: one textarea, Enter sends, Shift+Enter new line, context tags as today.

## Routing (pure, `shared/agentRouting.ts`, unit-tested)

`routeAgentTask(scope, request)` where `request` is `{ action: <quick action id> }` or
`{ text: string }`:

- Quick actions map to fixed routes: `text-job` (summarize, improve, brainstorm, translate with a
  language), `image-job` (describe, ocr), `explain`, `rewrite`, `list-format`, `send-to-pipeline`,
  `node-assist` (card chips, Fix error), `build` (Build a workflow, Wire these up), `agent`.
- Free text: scope `card` → `node-assist`; scope `cards` (≥ 2 cards, or cards plus notes) →
  `build`; everything else → `agent` (the drawing agent with the selection as context).
- If the last task in the thread is a `build` plan that was not applied and the user writes free
  text, route to `build` as a **revision**: send the previous plan with the new text (the existing
  "Revision: … Previous plan …" prompt in `BuildPanel`).

## Task messages in the thread

Add to `shared/types/ChatHistoryItem.ts`:

```ts
export interface ChatHistoryTaskItem {
	type: 'task'
	id: string
	route: string            // 'text-job' | 'build' | 'node-assist' | …
	label: string            // "Summarize", "Build: Load sales.xlsx…"
	scopeLabel: string       // frozen from the scope at send time
	scopeIds: string[]
	status: 'running' | 'done' | 'error' | 'applied' | 'discarded'
	text?: string            // reply text or the result text placed on the canvas
	placedIds?: string[]     // shapes the task added to the canvas
	plan?: unknown           // AiPlan for build
	warnings?: string[]
	assist?: unknown         // NodeAssistResult for node-assist
	error?: string
}
```

- Push a `prompt` item (the user's words, or the chip label) and then the task item with
  `agent.chat.push(...)`; update it by `id` with `agent.chat.update(...)`. It persists with the chat.
- `ChatHistorySection` renders task items with a new `ChatTaskMessage` component:
  - running: a spinner line with the label and a Stop button (abort the fetch).
  - text-job / image-job / explain: the result text (Markdown, max 8 lines, "Show more"), and
    "Show on canvas" (select and zoom to `placedIds`).
  - build: `AiPlanRows` (reuse from `BuildPanel.tsx`, move it to its own file) + **Arrange cards** and
    **Run after building** checkboxes + Apply / Discard. Apply calls `applyAiPlan` as the Build panel
    did. The "Node types the AI may use" choice moves to a small "Build options" popover in the
    header menu (same `loadAllowedTypes` / `saveAllowedTypes`).
  - node-assist: the reply, the change rows (before → after), Apply / Discard (`applyNodeAssistChanges`),
    and for each `need` a "Build it" button that runs a `build` task in the same thread.
  - error: the message and Retry.
- The drawing agent must not get confused by task items: find every place that reads the chat
  history for the model (start with `shared/schema/PromptPartDefinitions.ts` and
  `client/parts/ChatHistoryPartUtil.ts`) and turn a task item into one short text line,
  e.g. `[Task Summarize on 2 texts: done] <first 300 chars of text>`, or skip it where only actions
  matter. `getAgentHistorySections` must keep working.

## Entry points (all open the dock)

`openAgentPanel(options?: { prefill?: string; run?: AgentRequest; sheet?: 'rewrite' | 'presets' })` in
`client/agent/agentPanelState.ts` (an atom; App reads it to open the dock).

- Context menu AI submenu, image items, Rewrite (Alt+B), Rewrite presets (main menu),
  Build with AI, Ask about selection (Ctrl+Shift+K): call `openAgentPanel` with the matching route.
- The ✦ button on a card and its error banner "Fix with AI": select the card, open the panel; the
  error case runs `node-assist` with "Fix this error: <message>" at once.
- `openBuildPanel(goal)` callers (`CanvasExtras`, `ChatPlanMessage`): run a `build` task in the panel.
- Remove `BuildPanel`, `FillChatCard`, `NoteDialog`, `ChatPlanMessage`, `chatPlan.ts`, the mode chip,
  and the `RewriteDialogs` modals (keep `CompareModal`). Remove dead atoms. Keep the logic functions
  (`buildWithAI`, `applyAiPlan`, `runNodeAssist`, `applyNodeAssistChanges`, `runRewrite`, `runAI`
  reworked to return the result instead of only toasting).

## Agent action: build a workflow

Add an agent action `build-workflow` `{ goal: string }` (schema in
`shared/schema/AgentActionSchemas.ts`, util in `client/actions/BuildWorkflowActionUtil.ts`,
registered in `client/modes/AgentModeDefinitions.ts`). It runs `buildWithAI(editor, goal)` and pushes
a `build` task item (not applied). Tell the model in the action description to use it when the user
asks for a pipeline / workflow of cards instead of drawing shapes. This is how a free-text request
with nothing selected ("load sales.xlsx and chart it") becomes cards.

## Tests

- Unit: `tests/agentScope.test.ts`, `tests/agentRouting.test.ts`.
- E2E `tests/e2e/agent-dock.spec.ts` (mock `**/api/generate-text` and the agent endpoint with
  `page.route`, as `tests/e2e/examples-new-cards.spec.ts` does):
  - the dock's right edge equals the viewport's right edge, the canvas gets narrower when it opens and
    wider when it closes, the width drag persists after reload;
  - the scope chip reads Canvas / Card: … / 2 texts as the selection changes;
  - Summarize on two text shapes: a task message appears and a text shape is placed with a derived link;
  - free text with one card selected: assist change rows, Apply changes the card;
  - free text with two cards: a plan message, Apply adds the planned cards;
  - Rewrite (Alt+B) opens the sheet inside the dock; Rewrite makes a variant;
  - Fix with AI on a card error runs at once;
  - Ctrl+Shift+K opens the dock and focuses the input;
  - no `FloatingPanel` for chat, build or fill exists any more, and no `.ai-dialog` modal opens for
    these features.
- Update the existing specs that used the old surfaces: `wp23-ui-chat`, `wp28-agent-chat`,
  `wp32-agent-chat-reliability`, `wp37-ui-polish`, `ai-catalog-ports` (search `tests/e2e` for
  `BuildPanel`, `FillChatCard`, `chat-float`, `chat-mode-chip`, `rewrite-dialog`, `Build with AI`).
  Keep what they check; change only how they reach it.

## Done means

`npx tsc --noEmit -p .` clean, `npx vitest run` green, your new spec and the updated specs pass with
`CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=2000 E2E_WEB_PORT=5202 E2E_API_PORT=8802 npx playwright test <files>`.
Do not run the whole e2e suite (the reviewer does). Do not commit.
