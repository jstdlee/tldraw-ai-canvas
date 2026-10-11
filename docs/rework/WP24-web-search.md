# WP24 — Web search card: Exa, Tavily, Brave Search

Read `RULES.md` first.

## Server

`server/search.ts` + `POST /api/search { provider, query, keyRef?, count?, options? }` →
`{ results: [{ title, url, snippet, published?, score?, content? }], provider, ms }`.
- **Exa:** `POST https://api.exa.ai/search` header `x-api-key`, body `{ query, numResults, type: 'auto', contents: { text: { maxCharacters } } }` (optional) → `results[].{title,url,text,publishedDate,score}`.
- **Tavily:** `POST https://api.tavily.com/search` header `Authorization: Bearer <key>`, body `{ query, max_results, search_depth: 'basic'|'advanced', include_answer }` → `results[].{title,url,content,score}`, optional `answer`.
- **Brave:** `GET https://api.search.brave.com/res/v1/web/search?q=…&count=…` header `X-Subscription-Token` → `web.results[].{title,url,description,age}`.
Check each provider's current docs (use the web) before coding; adapt field names if they changed.
Keys: from the secret store (`keyRef`, `resolveSecret`) or from a provider entry. Add a small
**Search providers** section to the AI providers dialog: one key per provider (UiSecretInput), saved
server-side (`data/search-config.json`, mode 0600, keys never sent to the client). The card uses the
saved key unless it has its own `keyRef`. Timeout 20 s, request signal passed through (Stop works).
Errors: provider status + message, never the key.

## Card `web_search` (group Web)

Fields: `provider` (exa / tavily / brave), `query` (main text, grows, Enter runs, `{{vars}}`
supported like LLM cards), `count` (1–20, default 5), provider options (Tavily depth + include
answer; Exa include text). Inputs: `query` (text, overrides). Outputs: `output` (Markdown list
"1. [title](url) — snippet"), `results` (JSON array), `urls` (one per line), `answer` (Tavily answer
when present). `showsOutput = true`: a compact result list in the card (title link, domain, snippet),
expand icon on it. Every field wirable (WP17), every output a dot (WP21). Register everywhere
(registry, nodeGroups `web`, catalog, descriptions, nodeSpecs with assistant chips, examples, tests,
wireFieldCoverage, cardSearch).

## Tests

Unit: request builders and response parsers for the three providers (fixtures copied from their
docs). e2e: card renders and runs with `/api/search` mocked by Playwright route interception. Never
call the real APIs in tests.

## Planner check

The owner enters keys in AI providers → Search providers; the planner runs one query per provider.
