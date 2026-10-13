# WP28 — Agent chat: plain replies, no pre-drawing, polished panel

Read `RULES.md` first. Owner feedback (2026-10-14). Agent chat: floating panel
(`client/App.tsx` FloatingPanel "chat"), `client/components/ChatPanel.tsx`, `ChatInput.tsx`,
`chat-history/*`, `ChatPlanMessage.tsx`, the agent in `client/agent/TldrawAgent.ts`, actions in
`client/actions/*`, prompt parts, and the server agent route (`server/`).

## A. "hi" with nothing selected gets no proper reply
Reproduce with the real default model (Magpie :3425, agent model from the AI defaults — local
router, allowed). Find why a greeting gives no proper reply (e.g. the system prompt forces canvas
actions, the response parser drops a plain message, the stream ends on a non-JSON answer, or the
model id is wrong). Fix so small talk and questions get a normal text reply in the chat with no
canvas change. Unit-test the parser / routing part.

## B. No pre-drawing
Owner: "when I start a chat, the canvas immediately adds connections to the objects, and they
disappear when the chat is done if there is no further action". Find what draws them (agent
context highlights, viewport/"looking at" overlays, area/shape context items, temporary arrows,
or placeholder shapes created before the model answers). Rule: the canvas changes only when the
agent takes a real action (create/update/connect/delete) or the user confirms a plan. Context
markers, if kept at all, must be subtle, not look like connections, and only for items the user
added on purpose. Do not break the area tool (`c`) or the "Building with N cards" plan flow.

## C. Polish the chat panel
Make it look like a first-class tldraw panel (use tldraw tokens `--tl-color-*`, radius, shadow,
type scale; light and dark):
- header: title, model name chip (click → AI providers), new chat, history, close; drag area clear;
- messages: user bubbles right, assistant left with a small avatar/icon, markdown rendered,
  code blocks styled with copy, tool/action steps as compact collapsible rows, timestamps subtle;
- empty state with 3–4 suggestion chips (drawing vs building with cards);
- input: auto-growing textarea, send/stop icon button, mode chip (Drawing / Building with N cards),
  attachment/context chips in one tidy row;
- plan messages (`ChatPlanMessage`) styled as cards with clear Apply / Open in Build panel / Revise;
- consistent spacing, no overflow at the minimum panel size (300×260).
Screenshots light/dark in the report.

## Tests
e2e with the model mocked (Playwright route on the agent endpoint): "hi" with nothing selected →
an assistant text bubble, and the canvas shape count is unchanged during and after the reply; a
drawing request (mocked actions) still creates shapes. Unit tests for the parser fix.
