# WP7 — Node-specific AI assistant, and "Build with AI"

Feedback items: #9 (each node's AI is a specialist for that node; AI on a selection builds what the
goal needs — adds nodes, wires them, fills them), #13 (the AI dialog and its "abilities" dump are
poor; the AI must use the selection, or nothing, and the whole catalogue to build the user's goal).
Read `RULES.md` first. WP1–WP6 are done: use the kit (`client/ui/`), `shared/placement.ts` +
`client/pipeline/placeNode.ts` (WP3), `TABLE_OPS` (WP5), group helpers (WP4).

## Today (read first)

- `client/pipeline/assist.ts`: one generic system prompt (`ASSIST_SYSTEM`) for every case; nodes
  summarised as strings ≤ 400 chars; objects dropped; `applyPlan` adds nodes at viewport centre +
  x/y (overlaps), wires are not validated against real ports; `askModel` uses the default chat model.
- `shared/nodeAssist.ts`: `extractJsonObject`, `parseAssistPlan`, `allowedProps`.
- `shared/nodeCatalog.ts`: `NODE_PORTS` (type → in/out/fields), `catalogPrompt()` (flat text).
  No purpose text, no field kinds, no enums.
- `client/pipeline/components/CanvasExtras.tsx`: `FillChatCard` (per-node), `AssistDialog`
  (multi-node, with "Show abilities" that dumps `catalogPrompt()` in a `<pre>`).
- `client/clips/canvasFeatures.ts` `aiAskSelection`: 1 node → fill card; 2+ nodes → compose
  dialog; other shapes → `window.prompt`; nothing selected → warning.
- Server: `POST /api/generate-text` (`server/index.ts` ~L271) resolves `body.model` with
  capability `chat` (or `vision`).

## Part A — Node specs (`shared/nodeSpecs.ts`)

One rich, static description per node type. It is the single source for prompts and validation.

```ts
export type FieldKind = 'text' | 'longtext' | 'code' | 'sql' | 'number' | 'boolean' | 'enum' | 'model' | 'json' | 'url'
export interface FieldSpec { key: string; kind: FieldKind; label: string; description: string; options?: string[]; default?: unknown }
export interface PortSpec { id: string; dataType: string; description: string }
export interface NodeSpec {
  type: string
  title: string                 // user-facing name (DataPipe, Database, …)
  group: string                 // NODE_CATEGORY group id
  purpose: string               // one sentence: what it does
  useWhen: string               // one sentence: when to pick it
  inputs: PortSpec[]
  outputs: PortSpec[]
  fields: FieldSpec[]
  assistant: {                  // the node's own specialist
    role: string                // e.g. "You configure one DataPipe step: choose the operation and its parameters from the input columns."
    chips: string[]             // 3–5 quick requests shown as chips, e.g. "Keep rows where…", "Total per group"
    rules?: string[]            // extra rules, e.g. "Only use column names from the input headers."
  }
}
export const NODE_SPECS: Record<string, NodeSpec>
export function specPrompt(types?: string[]): string     // compact text for prompts
```

- Cover **every registered, non-hidden node type** (see `client/pipeline/nodes/nodeTypes.tsx` and
  `NODE_PORTS`). Read each node file to write correct purpose, fields, enum options and port
  descriptions. DataPipe (`table`) fields: describe `op` with options from `TABLE_OPS` and say the
  params depend on the op (include `TABLE_OPS` param lists in its spec text via `specPrompt`).
- Keep `NODE_PORTS` (other code and tests use it). Test `tests/nodeSpecs.test.ts`: for every type
  in `NODE_PORTS`, `NODE_SPECS[type]` exists, its input/output ids equal `NODE_PORTS` in/out, and its
  field keys ⊇ `NODE_PORTS.fields`; every enum has ≥ 2 options; `specPrompt()` is < 40 000 chars.

## Part B — Plan format, validation, layout (pure, in `shared/`)

`shared/aiPlan.ts`:

```ts
export interface PlanNode { ref: string; type: string; label?: string; props: Record<string, unknown>; after?: string }
export interface PlanUpdate { id: string; props: Record<string, unknown>; label?: string }
export interface PlanWire { from: string; fromPort: string; to: string; toPort: string }
export interface AiPlan { summary: string; add: PlanNode[]; update: PlanUpdate[]; wires: PlanWire[]; notes: string[] }
export interface CanvasNodeInfo { id: string; type: string; label: string; inputs: string[]; outputs: string[]; wiredInputs: string[] }
export function parseAiPlan(text: string): AiPlan     // tolerant JSON extraction (reuse extractJsonObject); missing arrays → []
export function validatePlan(plan: AiPlan, existing: CanvasNodeInfo[], specs: Record<string, NodeSpec>, allowedTypes?: string[]):
  { plan: AiPlan; errors: string[] }                   // returns a cleaned plan + human-readable errors
```

Validation rules (each violation → one error line naming the item, and the item is dropped from
the cleaned plan):
- `add[].type` exists in specs, is allowed, is not hidden; `ref` unique and not an existing id.
- `props` keys exist in the spec fields; enum values are in `options`; numbers are numbers;
  booleans are booleans. Unknown keys are dropped (error line).
- `update[].id` is an existing node id.
- Wires: `from`/`to` resolve to an existing id or an `add` ref; `fromPort` is an output of that
  node; `toPort` is an input of that node; an input gets at most one wire (also counting existing
  wires in `wiredInputs`); no self-wire; no cycle (except through `loop`/`for_each` style nodes —
  check which types exist; if none, forbid all cycles).
- Data types: text→text, number→number|text, image→image, `any` matches all.

`shared/planLayout.ts`:

```ts
export function layoutPlan(plan: AiPlan, existing: { id: string; x: number; y: number; w: number; h: number }[],
  sizeOf: (type: string) => { w: number; h: number }, gap?: number): Record<string, { x: number; y: number }>
```

Layered layout: build the graph of existing + new nodes from wires; layer = longest path from a
source; new nodes go in the column of their layer, to the right of their upstream node
(`max(upstream.right) + gap`), stacked top-down within a column; new nodes with no wires go below
the selection. Then pass each through `findFreeSpot` (WP3) against existing boxes so nothing
overlaps. Existing nodes never move.

Tests: `tests/aiPlan.test.ts` (each validation rule; a valid 3-node plan passes unchanged) and
`tests/planLayout.test.ts` (chain → increasing x; no overlaps with existing; deterministic).

## Part C — Context gathering (`client/pipeline/aiContext.ts`)

```ts
export function describeCanvasNode(editor, shape): CanvasNodeInfo & { props: Record<string, unknown>; error?: string; inputSamples: Record<string, string>; outputSample?: string }
export function nodeAssistContext(editor, shape): string   // type-specific extra context
```

- `props`: all fields (strings cut to 2000 chars; objects/arrays as JSON cut to 2000 chars).
  **Never include secrets:** drop keys matching `/key|token|secret|password|authValue/i`.
- `inputSamples`: for each connected input, the first 1500 chars of its current value
  (`getNodeInputPortValues`); images → `"<image>"`.
- Type-specific (`nodeAssistContext`):
  - `table` (DataPipe): input headers + first 5 rows (parsed with `parseTable`), the current op spec.
  - `database`: table list with columns (from `node.tables`) and row counts.
  - `chart`: input headers + 3 rows.
  - `code`: language, last error, input sample.
  - `http`: last status / first 500 chars of last output.
  - `jev`: current kind, options, connected context sample.
  - others: nothing extra.
- The run error (WP1 run state or `node.error`) is always included.

## Part D — Per-node specialist (replaces `FillChatCard` behaviour)

`runNodeAssist(editor, shapeId, request): Promise<NodeAssistResult>` in `client/pipeline/assist.ts`:

- System prompt = `NODE_SPECS[type].assistant.role` + that node's spec only (purpose, fields with
  kinds/options, ports) + its rules + output format:
  `{"say":"one or two sentences","props":{…changed fields only…},"needs":[{"type":"<node type>","why":"…"}]}`.
  `needs` = upstream/downstream nodes the goal requires that this node cannot do alone.
- User prompt = request + `describeCanvasNode` JSON + `nodeAssistContext`.
- Validate `props` with the same field rules as `validatePlan`; on errors ask **once** more with
  the error list; then drop what is still invalid.
- Do **not** apply immediately. Return `{ say, changes: [{ key, label, before, after }], needs, errors }`.

UI (`FillChatCard` in `CanvasExtras.tsx`, rebuilt with the kit; anchored next to the node as now):

```
┌ ✦ AI · DataPipe ───────────────────────── × ┐
│ [Keep rows where…] [Total per group] [Clean numbers]   ← spec chips (click = fill the box)
│ ┌───────────────────────────────────────────┐ │
│ │ What should this node do?                 │ │
│ └───────────────────────────────────────────┘ │
│                                   [Ask ⏎]     │
│ ── answer ─────────────────────────────────── │
│ Filter rows where city = Paris.               │
│  Operation   select → filter                  │  ← diff list
│  Column      — → city                         │
│  Value       — → Paris                        │
│ Needs: a Chart node to show it  [Build it]    │  ← hands the goal to Part E with this node selected
│                        [Discard]  [Apply]     │
└───────────────────────────────────────────────┘
```

- Opened by the card's AI button (WP1) and by "Fix with AI" on the error banner (prefilled
  "Fix this error: …").
- Keep drafts per node (`$assistDrafts`).
- Apply = one history step (`markHistoryStoppingPoint('ai node')`), sets fields, marks out of date.
- Busy state with a small spinner; errors shown inline (kit error style), never `alert`.

## Part E — "Build with AI" (replaces `AssistDialog` and `window.prompt` paths)

`buildWithAI(editor, goal, opts)` in `client/pipeline/aiBuild.ts`:

1. Scope: selected node shapes (may be 0). Non-node selected shapes (notes, text, markdown) are
   read with `shapeText` and sent as "Notes on the canvas". With nothing selected, scope = empty
   (build from scratch), plus a list of all nodes on the page (id, type, label only, max 60) so
   the model can reuse them if the goal mentions them.
2. Prompt: system = "You are a workflow builder for this canvas…" + rules (use only catalogue
   types; reuse selected nodes when they fit; prefer the fewest nodes; every new node fully
   configured; wire every needed input; never invent fields or ports; DataPipe = one operation per
   node, chain several for several steps; put user-only steps — uploading a file, entering an API
   key — in `notes`) + `specPrompt(allowedTypes)` + the JSON format of `AiPlan` with one small
   worked example. User prompt = goal + selected nodes (`describeCanvasNode`) + notes text.
3. Model: capability **agent** (strongest JSON follower). Add optional `capability?: 'chat' |
   'agent'` to `/api/generate-text` (`server/index.ts`) and `apiGenerateText` params; server uses
   `resolveModel(body.model, body.capability ?? (images ? 'vision' : 'chat'))`. The panel has a
   model `UiSelect` (models with `agent` or `chat`; remembered in localStorage).
   `temperature: 0.2`, `maxTokens: 6000`.
4. `parseAiPlan` → `validatePlan`; if errors, one repair call ("Your plan had these problems: …
   Return the full corrected plan."); then validate again and keep the cleaned plan + remaining
   errors as warnings.
5. Return the plan for **preview**; do not touch the canvas yet.
6. `applyAiPlan(editor, plan)`: one history step; create nodes with defaults + props (WP3 sizes;
   positions from `layoutPlan`); set labels (`props.label`); update existing nodes; create wires
   (reuse the binding code from today's `applyPlan`, but only for validated wires); select the new
   + touched nodes; zoom to fit them if off screen. Optional "Run after building" checkbox →
   `startExecution(editor, new Set(ids))`.

### Panel UI (`client/pipeline/components/BuildPanel.tsx`)

A floating tldraw-style panel (not a modal backdrop): fixed at the right side under the top bar,
width 400, `--tl-color-panel`, `--tl-shadow-3`, radius `--tl-radius-4`, draggable header not
needed. Opened by: `aiAskSelection` (Ctrl/Cmd+K → keep the existing shortcut if any) when the
selection is 0 or 2+ nodes or non-node shapes; the main menu item "Build with AI"; the per-node
card's "Build it".

```
┌ ✦ Build with AI ───────────────────────────── × ┐
│ Using: [3 selected nodes ×] [2 notes ×]   or  "Empty canvas — builds from scratch"
│ ┌──────────────────────────────────────────────┐ │
│ │ Goal: e.g. "Load sales.xlsx, keep 2026 rows, │ │
│ │ total by region, show a bar chart"           │ │
│ └──────────────────────────────────────────────┘ │
│ Model [gpt-5.6 (agent) ▾]        [Plan ⏎]       │
│ ▸ Node types the AI may use (38)                 │  ← collapsible; chips per group with icons;
│   [Input ✓] [Text ✓] [AI ✓] [Data ✓] [Net ✗] …   │    click toggles a whole group; expand a
│                                                  │    group to toggle single types
│ ── Plan ─────────────────────────────────────── │
│ Load the file, filter 2026, sum per region, chart│  ← summary
│  + DataPipe  "Filter 2026"   op=filter …         │  ← each step: icon, title, key props
│  + DataPipe  "Total by region" op=groupby …      │
│  + Chart     "Sales by region"                   │
│  ⇢ Load CSV.output → Filter 2026.data            │  ← wires
│  ✎ Load CSV: fileName …                          │  ← updates
│  ⚠ You need to upload sales.xlsx in "Load CSV"   │  ← notes / warnings
│ [Revise: ______________________] [Revise]        │  ← sends goal + previous plan + change
│                         [Cancel]  [Apply plan]   │
│ ☐ Run after building                             │
└──────────────────────────────────────────────────┘
```

- Remove `AssistDialog`, the `AbilityList` `<pre>` and its CSS. `runCompose` callers switch to the
  panel. Keep `$aiNote` (explain/answer dialogs elsewhere still use it), but `aiAskSelection` with
  non-node shapes now opens the panel with those shapes as notes instead of `window.prompt`.
- Allowed-types state persists in localStorage (`oh-my-tldraw:ai-types`).
- Esc closes the panel when its textarea is focused (stop propagation so tldraw does not get it).

## Part F — Clean-up

- Delete `ASSIST_SYSTEM`, old `askModel`/`applyPlan`/`runCompose` once unused; keep exports other
  files still import (grep first).
- `shared/nodeAssist.ts`: keep `extractJsonObject` and `allowedProps` if still used; remove the
  rest when unused, update its tests.
- `shared/nodeSpec.ts` (`NODE_SPEC_PROMPT`, unused) → delete.

## Done when

- typecheck + tests (new: nodeSpecs, aiPlan, planLayout) pass.
- Planner checks with a real model: (1) DataPipe AI "keep rows where score > 3" → diff shows
  op=filter, column=score, `>`, 3 → Apply works. (2) Empty canvas, goal "fetch
  https://example.com, summarise it, decide with JEV if it is about cats" → plan with HTTP →
  Summarize → JEV, wired, laid out left→right, no overlap; Apply; Run works. (3) Select 2 existing
  nodes + goal → plan reuses them and adds what is missing. (4) A bad model answer (simulate by
  allowing only some types) shows warnings instead of breaking.
