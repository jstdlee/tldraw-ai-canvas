# WP10 — Model provider card, input parameters for LLM cards, Enter to run

Owner feedback (second round): a model provider card that fetches models from a custom
OpenAI-compatible `/v1/models` URL and outputs the chosen model; Raw model, AI text, Generate
text and Chat accept input parameters; Enter runs Chat, Generate text and AI text.
Read `RULES.md` first. WP1–WP9 are done.

## 0. Secrets stay on the server

Today Raw model stores `apiKey` in the canvas (sent to the server per call). New code must not.

- `shared/secrets.ts` `resolveSecret`: also accept `secret:<id>` references.
- Server store `data/secrets.json` (mode 0600) + `POST /api/secrets { value }` → `{ ref: 'secret:<id>' }`
  and `DELETE /api/secrets/:id`. Values are never returned by any route.
- Kit component `UiSecretInput({ value: ref, onChange(ref) })`: shows "Key saved ••••" when a ref
  exists (Replace / Remove), else a password input; on blur/Enter it posts the value and keeps only the ref.
- Raw model: switch its key field to `UiSecretInput` (store ref in a new optional field `keyRef`);
  if an old node has `apiKey`, move it to the store on first run and clear `apiKey`
  (`updateNode`). Server `raw-model` route: `apiKey` (legacy) → `keyRef`/`keyName` → env.

## 1. Model provider card (new node `model_source`)

- Title **"Model provider"**, group `llm`. No inputs. Output `model` with data type **`model`**
  (the unused `PortDataType` `'model'` — give it a clear colour in `PORT_TYPE_COLORS`).
- Fields: `baseURL` (default `https://api.openai.com/v1`), `keyRef?` (`UiSecretInput`),
  `models: string[]` (last fetched list), `model: string` (chosen), `filter: string`,
  `kind?: 'chat' | 'image'` (what the model is for; default chat), `error`.
- UI: Base URL input with presets menu (OpenAI, OpenRouter, Groq `https://api.groq.com/openai/v1`,
  Together, DeepSeek, Cloudflare (from the provider config), Ollama `http://127.0.0.1:11434/v1`,
  LM Studio `http://127.0.0.1:1234/v1`, Custom). Key. **Fetch models** button →
  `POST /api/providers/models` with an ad-hoc provider `{ kind: 'openai-compatible', baseURL, keyRef }`
  (extend the route so a `keyRef` is resolved on the server). Then a searchable `UiSelect` of the
  models (filter box above long lists), the chosen model shown big, model count, last fetched time.
  `showsOutput = true` (it shows the chosen model).
- Output value: a JSON string `{"kind":"adhoc","baseURL":"…","model":"…","keyRef":"secret:…"}`
  (no key inside). Helper `parseModelValue(value): { key?: string; adhoc?: {...} }` in
  `shared/modelRef.ts`: a plain string = a configured model key (today's behaviour).

## 2. Server accepts ad-hoc models

- `server/config.ts`: `resolveModelRef(ref: string | object | undefined, capability)` → when the
  ref parses as adhoc, build a provider `{ id: 'adhoc', kind: 'openai-compatible', baseURL, apiKey: resolveSecret(keyRef), enabled: true }`
  and a model `{ key: 'adhoc/<model>', model, capabilities: [capability] }`; else `resolveModel`.
  Validate `baseURL` is http(s). Use it in `/api/generate-text`, `/api/chat`, `/api/raw-model`,
  `/api/generate-image` (WP9), `/api/jev` (chat path).

## 3. Input parameters on LLM cards (AI text, Generate text, Chat, Raw model, Generate image)

Two kinds of parameters, the same on every LLM card:

**a) Template variables.** Any `{{name}}` in the card's prompt/instruction/message/system text
creates an input port named `name` (data type `any`) on the card, below the existing ports, in
order of first appearance; max 12. On run, each `{{name}}` is replaced by the wired value (text;
images are passed as attachments, not inlined; unwired → empty string and a warning in the usage
line). Pure helpers in `shared/templateVars.ts`: `findVars(texts: string[]): string[]`,
`fillVars(text, values): string`. Port ids `var:<name>`; ports are recomputed from the fields
(`getPorts(shape, node)` already receives `node`); body height grows one row per variable.
Show variable rows with `PortRow` (label `{{name}}`, connected value preview).

**b) Settings ports.** Add optional input ports to each LLM card:
- `model` (data type `model`, also accepts text) — overrides the card's model picker
  (shows "from <node>" in the picker when wired).
- `system` (text) — overrides/sets the system prompt.
- `params` (text, JSON) — object with any of `temperature`, `maxTokens`, `thinking`, `topP`,
  `seed`, `n` (image), `size` (image); invalid JSON → run error "params must be JSON, e.g. {"temperature":0.2}".
These rows live inside the existing collapsible "Model settings" section (WP1 kit `UiSection`), so
the card stays short; when one of them is wired the section shows a small badge "2 wired".

Apply to: `generate_text` (`GenerateTextNode.tsx`), `text_ai` (`TextAINode.tsx`), `chat`
(`ChatNode.tsx`), `raw_model` (`RawModelNode.tsx`: it already has a text `model` port — keep the id,
widen to `model`/text), `image_gen` (WP9). Shared code in `client/pipeline/nodes/types/llmSettings.tsx`
(ports + rows + request building) so the five cards behave the same. `shared/nodeCatalog.ts`
`NODE_PORTS` lists the fixed ports only (`model`, `system`, `params`); variable ports are dynamic —
update the port-map test to allow `var:*` ports.

Also: `generate_text` has no result area today although the code comment says it has one — add the
standard `NodeTextResult` (grows; `showsOutput = true`).

## 4. Enter runs the card

- Chat (message), Generate text (prompt field if it has one, else the input preview is not
  editable — add a prompt field `promptText` optional used when the `prompt` port is not wired),
  AI text (instruction): **Enter = run**, **Shift+Enter = new line**, Ctrl/Cmd+Enter = run too.
  Ignore Enter while an IME composition is active (`e.nativeEvent.isComposing`).
- Run = `startExecution(editor, new Set([shape.id]))` (from `execution/executionState.ts`) — so
  downstream nodes run too. Fix Chat (`ChatNode.tsx` ~L293), which today calls `sendChat` directly.
- Kit: add `onSubmit?: () => void` and `submitOn?: 'enter' | 'mod-enter'` to `UiTextArea`; it
  handles the key logic and still stops propagation to the canvas.
- Show a hint under those fields: "Enter to run · Shift+Enter new line" (text-3, 0.75em).

## Tests

`tests/templateVars.test.ts` (find/dedupe/order/limit, fill, missing), `tests/modelRef.test.ts`,
`tests/secrets.test.ts` (`secret:` ref resolution with a temp store path; values never in route output if testable).

## Planner check

Model provider: Ollama-style or OpenRouter URL → Fetch models → pick → wire into Generate text →
run. `{{topic}}` in AI text creates a `topic` port; wire a Prompt into it; run. `params`
`{"temperature":0}` wired works. Enter runs Chat / Generate text / AI text and the downstream node.
Raw model key moves to the server store (canvas JSON has no key).
