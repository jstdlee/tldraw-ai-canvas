# WP30 — Card turns red after one run; wired output shows an error

Read `RULES.md` first. Owner: "bug: ran once then shows red, e.g. the network card – Subnet
calculator; also the connected output shows an error".

1. Reproduce in the browser (e2e, own ports): Network tools card (`net_tool`,
   `client/pipeline/nodes/types/UtilityNodes.tsx`) with Subnet calculator `192.168.1.10/24`,
   run it; then wire its output to another card (Prompt / Output / Text) and run again.
   Record what turns red (status ring, error banner, port, wire), the error text, and the console.
2. Find the root cause. Suspects: run status / `lastRunHash` cache (`execution/*`,
   `nodeRunState.ts` per-shape atoms from WP25), `runIssue.ts` (`missingRunInput` for net_tool
   asking for a target that is a field), server `/api/net` result shape, the output value type
   (JSON vs text) vs the downstream port type, or the spill/output-label path.
3. Fix the cause, not the symptom. Then check the same pattern on other cards without an
   upstream input (Number, Random, Prompt, HTTP, Web search, Database) — run each once and
   twice, wired and unwired; fix any that show the same bug.

## Tests
e2e: net_tool subnet runs twice → no error state, output text has the network/broadcast/hosts;
wired to an Output card → both green, value arrives. Plus a loop over the other source cards
(mock network where needed).
