# WP31 — Agent card (pi agent SDK) with search, MCP servers and skills; providers by type

Read `RULES.md` first. Owner: "move the search provider configuration into the Add provider menu
by model type; tldraw should use search on demand, like an agent; add the MCP interface; add a
new Agent component that takes search, MCP sets (more than one), skill sets (more than one) and a
model as input to run an agent task, with the pi agent SDK at its core. Heavy, but balance it."

Balance: a solid, small core first; no plugin marketplace, no remote skill install.

## A. Providers dialog by type (`client/ai/AIProvidersDialog.tsx`, `aiConfig.tsx`)
"+ Add provider…" becomes grouped: **Models** (existing kinds), **Search** (Exa, Tavily, Brave),
**MCP server**. The separate "Search providers" section (WP24) moves into this list: each search
provider is an entry with its key (`UiSecretInput`, secret store). Migrate existing
`data/search-config.json` entries automatically; `/api/search` keeps working for the Web search
card. **Skills**: a list of skill folders (default `data/skills/`; each skill = a folder with
`SKILL.md` that has `name` + `description` front matter — the Agent Skills format) with a
"Rescan" button showing the found skills.

## B. MCP client (server side, `server/mcp.ts`)
Use `@modelcontextprotocol/sdk` client. Entry types: **stdio** (command, args, env with secret
refs, working dir) and **HTTP** (Streamable HTTP URL + headers with secret refs). Config in
`data/mcp-config.json` (mode 0600, only secret refs). API: list servers, test connection (list
tools), call tool. Connections are opened on demand and closed after idle; a call has a timeout
and honours abort. Never expose secrets to the client.

## C. Agent runner (server side, `server/agent/`)
Core: `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` (MIT; check their current README /
types in node_modules before coding). Model: map the chosen app provider/model (OpenAI-compatible
base URL, e.g. Magpie :3425, key via secret store) to a pi-ai model definition. Tools:
- `web_search` for each chosen search provider (reuse `server/search.ts`);
- every tool of each chosen MCP server (namespaced `server__tool`);
- skills: the chosen skills' names + descriptions go into the system prompt; a `read_skill`
  tool returns a skill's `SKILL.md` (and lists its files; `read_skill_file` for files inside
  that folder only — path traversal blocked).
Limits: max steps (default 12), max time, abort via the request signal (Stop). Stream progress
as SSE: step start, tool call (name, short args), tool result (truncated), text deltas, final.
POST `/api/agent/run`.

## D. `agent` card (group AI)
Inputs: `task` (text), `context` (any, optional), `model` (model port, like other LLM cards).
Fields (all wirable where it makes sense): model, **search** (multi-select of configured search
providers), **MCP servers** (multi-select), **skills** (multi-select), system prompt, max steps.
Body: the live step list (compact rows: tool icon, name, status, duration; expand for args/result)
and the final answer. Outputs: `output` (final answer text), `steps` (JSON transcript).
Register everywhere (registry, nodeGroups, catalog, descriptions, nodeSpecs with chips, examples,
wireFieldCoverage, output-dots).

## E. Canvas agent chat uses search on demand
When at least one search provider is configured, the canvas agent (chat) gets a `web_search`
action/tool it may call when the user asks for current information; results appear as a
compact step in the chat. No search when none is configured.

## Tests
Unit: provider/search-config migration; MCP config validation; skill scan (front matter,
traversal guard); pi-ai model mapping. Integration (vitest, no network): a fake MCP server over
stdio (a tiny node script in `tests/fixtures/`) — list + call; the agent runner with a fake model
(pi-ai faux/mock provider if available, or a local fake OpenAI-compatible HTTP server in the test)
that calls `web_search` (mocked) and one MCP tool, then answers. e2e: Agent card runs with
`/api/agent/run` mocked via Playwright and shows steps + output. Never call real external APIs.
