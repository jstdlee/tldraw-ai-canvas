# WP17 — Every parameter can be wired

Read `RULES.md` first. Owner rule: "the parameters on a component shall all support an external
point to be connected with, and overwrite the input on the component".

## Behaviour

- Every user-editable field of every card (text, number, select, checkbox, column picker, SQL,
  formula, model …) has an **input port** at its row. When a wire is connected, the wired value
  **overrides** the field: the control is disabled and shows `from <card> → <value preview>`;
  the stored field value is kept (unwire = old value back).
- Existing ports keep their ids and behaviour (e.g. `prompt`, `system`, `model`, `var:*`).
  Field ports use the id `field:<key>`. A field that already has a dedicated port (e.g. raw
  model `model`, LLM `system`) does not get a second one.
- Values are coerced to the field kind: number (`Number`, error if NaN), boolean (`true/false/1/0/yes/no`),
  select/enum (must be one of the options; case-insensitive match; error lists the options),
  column (any text), JSON fields parse JSON. Coercion errors throw (banner).

## Design

1. **Which fields.** `shared/nodeSpecs.ts` already lists every card's fields with kinds and
   enums. A field is wirable unless its spec says `wire: false` (add that flag only for
   internal / result fields — results, caches, file blobs, `keyRef`/secrets: **secrets are never
   wirable**). For DataPipe, wirable fields depend on the op: only the op's params are shown and
   get ports.
2. **Ports from the DOM.** Rows differ per card and per state, so port y positions come from the
   rendered rows, not hand-written numbers:
   - Kit components that render a field (`UiField`, `PortRow`, the row helpers) take
     `wire={{ shapeId, key }}`. They render a `Port` dot at the left edge of their row and
     register the row's offset (relative to the card) in a per-shape atom
     `fieldPortAnchors: Record<shapeId, Record<key, y>>` via a ResizeObserver / layout effect,
     in **page units** (divide by the camera zoom).
   - `getNodeTypePorts` (`client/pipeline/nodes/nodeTypes.tsx`) merges the definition's own
     ports with `field:<key>` ports at the registered y. Missing anchors (not rendered yet,
     collapsed card) fall back to the header row so existing wires never dangle.
   - Collapsed cards: all ports spread over the header/footer strip as today.
3. **Execution.** In `ExecutionGraph`, before calling `execute(shape, node, inputs)`, apply
   overrides: `node = { ...node, ...coerced(inputs['field:*']) }`. Card code then works
   unchanged. The same merged node is used for `getOutputInfo`.
4. **UI states.** Port dot hidden until hover of the row or the card is selected, always shown
   when wired. Wired control: disabled, `--tl-color-text-3`, with a small link icon and the
   source name; clicking the source name selects the source card.
5. **Picker / AI.** The wire-drop picker (WP8) and AI plan validator (WP7) accept `field:<key>`
   ports: when a wire is dropped on a card body, connect to the row under the pointer if it is a
   field port. `validatePlan` allows `field:<key>` for wirable fields.

## Tests

Coercion helper `shared/fieldCoerce.ts` (each kind, enum errors), override merge, `validatePlan`
with field ports. Old canvases: no `field:*` ports exist until wired; nothing moves.

## Planner check

Wire a Prompt into a DataPipe "Value" field (filter), a Number into Chart "Top", a text "desc"
into Sort "Order", a Prompt into Database SQL; run; unwire restores the old value; resize and
zoom keep ports on their rows; dark mode.
