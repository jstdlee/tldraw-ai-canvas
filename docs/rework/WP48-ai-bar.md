# WP48 — One AI bar, one agent, preview then Apply

Read `docs/rework/RULES.md` first. tldraw is 5.6.0. WP44 (the right dock) is in place; read
`client/components/AgentDock.tsx`, `ChatPanel.tsx`, `ChatInput.tsx`, `chat-history/ChatTaskMessage.tsx`,
`client/agent/agentTasks.ts`, `client/agent/agentPanelState.ts`, `shared/agentRouting.ts`,
`shared/agentScope.ts`, `client/agent/TldrawAgent.ts`, `client/actions/*`, `client/modes/AgentModeDefinitions.ts`.

## User decisions (2026-11-14)

1. **One AI entry: a bar on the selection.** A small "Ask AI" input appears just above the current
   selection (where tldraw's text toolbar sits). **Ctrl+K** opens it anywhere (at the selection, or
   at the canvas center with nothing selected). **Remove** the ✦ button on card corners
   (`NodeAiButton` in `NodeShapeUtil.tsx`) and the floating round button (`.agent-dock-button`).
   The dock stays on the right as the history; the existing "Agent" toggle in the top-right panel
   toggles it (Shift+A stays). The card error banner keeps a "Fix" button that opens the bar
   prefilled with "Fix this error: …".
2. **Preview, then Apply.** Every canvas change is shown as a preview first, with Apply and Adjust.
   A vague request gets **one** clarifying question first.

## The bar

- Component `client/components/AiBar.tsx`, rendered in `InFrontOfTheCanvas`. Anchored above the
  selection bounds in viewport space, follows pan/zoom, flips below when there is no room, never
  covers the selection. Width 420 px, one-line input that grows to 4 lines.
- It shows the scope as a short label at the left ("2 cards", "Text", "Canvas") and up to 4 suggested
  actions under the input as chips (reuse `getQuickActions`), plus "More…" for the rest.
- Enter sends. The dock opens (if closed) and the task appears in the thread; the bar shows a small
  progress line and closes when the task reaches preview, an answer or an error.
- Escape closes the bar. Clicking the canvas closes it. Opening a context menu closes it.
- It does not appear while a shape is being edited (text editing) or while dragging.
- The right-click AI submenu and Ctrl+Shift+K open the bar too (no separate code path).

## One agent

Today `routeAgentTask` sends free text to one of three hidden routes (node-assist, build, drawing
agent). Replace the free-text routing with **one agent** (`TldrawAgent`) that has every capability as
an action it can choose:

- existing drawing actions (create, move, label, …);
- `build-workflow` (exists): add / wire / update cards via `buildWithAI`;
- new `fill-card` `{ cardId, request }`: wraps `runNodeAssist` for one card's fields;
- new `edit-text` `{ shapeIds, instruction }`: wraps the text job / rewrite logic;
- new `ask-user` `{ question, options?: string[] }`: ends the turn with a question shown in the
  thread as chips (and in the bar if it is open). Tell the model: when the request is vague or
  could mean several different changes, ask **one** short question instead of guessing.
- `explain` / answer: a plain message.

Quick-action chips (Summarize, Translate…, Rewrite…, Describe image, …) keep their direct routes: they
are explicit and need no understanding step.

Context: the agent already gets the selection (`SelectedShapesPartUtil`). Make sure a selected card
is described with its type, its fields with current values, its ports and wires, and its error
(reuse `describeCanvasNode` in `client/pipeline/aiContext.ts`), and that the agent's prompt lists the
card catalog briefly (`specPrompt` / node catalog) so it can choose `build-workflow` or `fill-card`.
For `fill-card` the assist prompt must list the card's field options so the model picks an existing
option (it chose a JS-incompatible regex instead of the existing "Upper case" tool in testing).

## Preview, then Apply

- Every action that changes the canvas runs in **preview**: apply the change, mark the touched shapes
  (new shapes semi-transparent with a dashed outline; changed fields highlighted), and record the
  diff. The thread shows the task with **Apply**, **Adjust** (focuses the input; the next message
  revises the same preview) and **Discard**.
- Discard reverts exactly (use the diff, as `ChatHistoryGroupWithDiff` does today). Apply clears the
  marks; the whole change is **one** undo step.
- While a preview is open the user can still pan and zoom; editing a previewed shape counts as Apply.
- Build plans keep their plan rows; their preview is the ghost cards and wires placed on the canvas.
- Only one preview at a time; sending a new request while one is open asks "Apply the current
  change first?" (Apply / Discard).

## Bugs from the real-model test (fix all)

1. A drawing request that fails or returns nothing showed no message for 74 s: always end with a
   reply, an error, or "Nothing to change" within the idle timeout.
2. A provider error displayed as `[object Object]`: show the message text.
3. After Apply, build plan rows show raw ids (`shape:p1`): keep names.
4. When the default model for a capability is not in the models list, the app silently uses the
   first model with that capability: show a clear warning in the dock header ("Agent model not set,
   using X") and in AI providers.
5. "did not return canvas actions" errors: the agent should retry once with a format reminder before
   failing.

## Tests

- E2E `tests/e2e/ai-bar.spec.ts` with mocked model replies (`page.route`, as the WP44 specs do):
  bar appears above a selection and follows zoom; Ctrl+K opens it with nothing selected; no ✦ on
  cards and no round button; Enter shows a task in the dock; a vague request returns an `ask-user`
  question with chips, clicking a chip continues; a build reply shows ghost cards, Discard removes
  them exactly, Apply keeps them, one Ctrl+Z undoes the Apply; a fill-card reply highlights the
  changed field; error text is readable; Fix on a card error opens the bar prefilled.
- Update existing specs that used the ✦ button, the round button or the old routing
  (`agent-dock.spec.ts`, `wp23`, `wp28`, `wp32`, `wp37`, `error-banner`, `ai-catalog-ports`).
- Unit tests for any pure logic (preview diff bookkeeping, prompt building).

## Done means

`npx tsc --noEmit -p .` clean, `npx vitest run` green, your spec and the updated specs pass with
`CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=2000 E2E_WEB_PORT=5207 E2E_API_PORT=8807 npx playwright test <files>`.
Do not run the whole e2e suite. Do not commit.
