# WP6 — Cloudflare Workers AI provider and the Clef decision model

Feedback item: #14 (use the JEV/LLM models the owner set up, including Cloudflare **Clef**).
Read `RULES.md` first. This WP touches only the provider config, the server and the provider
dialog. Do **not** touch node UI files other than what is named here.

## Facts (verified 2026-10-10)

- Workers AI REST: `https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/{model}`,
  header `Authorization: Bearer <token>`. JSON responses are wrapped: `{ result, success, errors }`.
  (Some newer models return the body unwrapped — accept both: `data.result ?? data`.)
- Clef models: `@cf/cloudflare/clef` (strong) and `@cf/cloudflare/clef-flash` (fast).
  Request body is **the same as System One** (`server/jev.ts` `systemOne`):
  `{ "model": "clef" | "clef-flash", "state": "<context>", "questions": { "<id>": { "type": "noul"|"choice"|"score", "instructions": "...", "criteria": {label: description} | [levels] } } }`.
  Response (verified):
  ```json
  {"model":"clef-flash","answers":{
    "q1":{"type":"noul","noul":0.9124},
    "q2":{"type":"choice","choice":"fried rice","probabilities":{"fried rice":0.96,"salad":0.03,"pizza":0.01},"confidence":0.89},
    "q3":{"type":"score","score":1.77,"legend":{"0":"poor","1":"ok","2":"good","3":"great"},"probabilities":{"0":0.05,"1":0.32,"2":0.44,"3":0.19},"confidence":0.11}},
   "usage":{"input_tokens":343,"output_tokens":0}}
  ```
- Chat models: OpenAI-compatible endpoint
  `https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1` (`/chat/completions`), model ids
  like `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `@cf/openai/gpt-oss-120b`, `@cf/qwen/...`.
- Model list: `GET https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/models/search?per_page=200`
  → `result: [{ name, task: { name }, description, properties: [...] }]`.

## Changes

### 1. Config (`shared/aiConfig.ts`)

- `ProviderKind` gets `'cloudflare'`.
- `ProviderConfig` gets optional `accountId?: string` (public config shows it; it is not secret).
- `PROVIDER_KINDS.cloudflare = { label: 'Cloudflare Workers AI (chat + Clef decisions)', needsApiKey: true, capabilities: ['agent','chat','vision','jev'], local: false }`
  (no `defaultBaseURL`; the URL is built from `accountId`).
- `PROVIDER_PRESETS` gets "Cloudflare Workers AI" (`kind: 'cloudflare'`, `enabled: true`).
- Export helper `cloudflareBase(accountId: string) = 'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/ai'`.
- Validate `accountId` as 32 hex chars where the config is saved (server) → `ConfigError` with a
  clear message.

### 2. Server

- `server/llm.ts` `getLanguageModel`: `cloudflare` → `createOpenAICompatible({ name: 'cloudflare', baseURL: cloudflareBase(id) + '/v1', apiKey })(model.model)`.
  `getProviderOptions`: same as `openai-compatible`.
- `listProviderModels` `cloudflare`: call the models search URL; map text-generation models
  (`task.name === 'Text Generation'`) to `{ id: name, label: name }` and **always** add the two
  Clef entries `{ id: '@cf/cloudflare/clef', label: 'Clef (decisions)' }` and
  `{ id: '@cf/cloudflare/clef-flash', label: 'Clef Flash (fast decisions)' }` at the top.
  Mark `vision: true` for models whose name contains `vision` or `llava` or task is
  'Image-to-Text'.
- Model capability defaults when a Cloudflare model is added (where the server/dialog assigns
  default capabilities): Clef ids → only `['jev']`; others → `['chat']`.
- `server/jev.ts` `decide`: if `provider.kind === 'cloudflare'` **and** `model.model` starts with
  `@cf/cloudflare/clef` → `clef(...)`; other Cloudflare models → `llmDecision` (chat path).
  Implement `clef()` by reusing the System One request/response code: refactor `systemOne` into
  `buildSystemOneBody(modelName, req, options, levels)` and `parseSystemOneAnswer(data, req, levels)`
  so both call them. Clef: model name `clef` or `clef-flash` (the suffix of the model id), POST to
  `cloudflareBase(accountId) + '/run/' + model.model`, unwrap `data.result ?? data`, timeout 60 s,
  error text `Cloudflare Clef <status>: <errors[0].message or body>`. `source` = `cloudflare/<model>`.
  For `score`, use `legend` when present to name levels.
- Also batch questions: add `decideMany(req: JevRequest & { questions: … })` **only if** the JEV
  node already sends several questions; otherwise skip.
- Never log the token. Error messages must not include the token.

### 3. Provider dialog (client)

Find the "AI providers" dialog (`grep -rn "PROVIDER_PRESETS" client`). For kind `cloudflare`:
show **Account ID** (text) instead of Base URL, and **API token** (password field, same as other
keys). Help text: "Token needs the Workers AI permission. Account ID is on the Cloudflare
dashboard home page." Use kit components (`UiField`, `UiTextInput`) for the new fields.

### 4. JEV node (`client/pipeline/nodes/types/JevNode.tsx`)

- The model picker already lists `jev`-capable models; make sure Clef models appear with their
  labels. If the node shows a "source" line, show `cloudflare/@cf/cloudflare/clef-flash` as
  `Clef Flash`.
- No other UI changes.

## Tests

`tests/clef.test.ts`: `buildSystemOneBody` for noul/choice/score; `parseSystemOneAnswer` with the
verified response above (noul → yes 0.9124; choice → "fried rice"; score → answer "good", levels
mapped from legend; probabilities normalised); wrapped `{ result: … }` unwrap.

## Planner check

The planner (not the coding agent) adds a Cloudflare provider in the app with the owner's token,
fetches models, ticks Clef Flash for JEV, and runs a JEV node with yes/no, choice and score.
The coding agent must not put any token in code, tests, or config files.
