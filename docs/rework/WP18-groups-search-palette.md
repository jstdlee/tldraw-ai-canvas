# WP18 — One grouping everywhere, one search, insert from the palette

Read `RULES.md` first. Owner feedback: organise cards, the library drawer and the right-click
menu into the same feature groups; add a command-palette shortcut to search and insert cards;
search by name and description with text similarity (no RAG), with JEV as an optional helper.

## Part A — One taxonomy (`shared/nodeGroups.ts`)

Card groups, in workflow order (used by the library, the wire-drop picker, the palette, the
Build-with-AI type chips and the AI specs):

| Group | Cards |
|---|---|
| Sources | Prompt, Read from, Load image, Camera, Capture, Random, Number |
| Data | DataPipe, Profile, Database, Postgres (hidden), Chart |
| Text | Text tools, Concat, Template |
| AI models | Generate text, AI text, Summarize, Chat, Raw model, Model provider, Generate image |
| Decide | JEV decision, If / else, And / Or / Not, Router |
| Web | HTTP request, Download, Network tools, Video link |
| Image | Crop, Resize, Filter, Image tools |
| Flow & code | For each, Code, Sleep, Group boxes |
| Output | Output, Save to file |

Every non-hidden type belongs to exactly one group (test). Each group has an icon (kit icons).

## Part B — Menus follow the same order

- **Library drawer** (WP2): groups in this order; "My nodes" stays first.
- **Right-click menu** on the canvas (`client/clips/CanvasMenus.tsx`), sections in this order,
  each only when it applies:
  1. *Card* — Run, Run without cache, Group as box / Open group / Close to box / Ungroup box,
     Save as my node, Put output on canvas
  2. *AI* — Ask AI about this card, Build with AI…, Explain, Summarize / Translate / Improve
     selection text
  3. *Insert* — "Insert card…" (opens the palette in insert mode at the pointer), then a submenu
     per card group
  4. *Edit* — the tldraw edit items (cut, copy, paste, duplicate, delete) unchanged
  5. *Arrange* — tldraw arrange / align items, Text wrap, Image ratio
  6. *Canvas* — Find, Map view, Save canvas, Examples
  Remove duplicated entries between the context menu and the "Canvas tools" main-menu submenu;
  the main menu keeps only file and view items, with Canvas tools ordered the same way.
- Labels: verbs first ("Run card", "Group as box"), shortcuts shown with `kbd`.

## Part C — Insert from the palette

- Shortcut **`/`** on the canvas (not while typing) and **Ctrl/Cmd+Shift+I** anywhere open the
  palette in **insert mode** at the pointer position ("Insert card…" placeholder). Ctrl/Cmd+P
  stays the general palette; in it, card results appear in an "Insert" section.
- Results show icon, title, group, and the one-line description; ↑/↓, Enter inserts at the
  pointer (or the viewport centre) using `createNodeAt` (free spot) and selects it; Shift+Enter
  inserts and wires it to the selected card's output (first compatible port).
- **Deep entries:** sub-modes are searchable and insert a pre-configured card:
  "DataPipe · Pivot", "DataPipe · Group and summarise", "DataPipe · Formula column" (one entry per
  `TABLE_OPS` op), "Chart · Line" (per chart kind), "Database · DuckDB", "JEV · Yes / no",
  "Text tools · <op>", "AI text · Translate" …, built from the registries, not hand lists.

## Part D — One search engine (`shared/cardSearch.ts`, pure, tested)

Used by the library search, the wire-drop picker, the palette and Build-with-AI chips.

- Documents: one per card type and one per deep entry; fields: title, group, description,
  keywords, op/kind names, port names.
- Scoring: BM25 over word tokens (lower-case, split camel/snake, simple English stemming:
  -s/-es/-ing/-ed) **plus** character-trigram similarity on the title (handles typos and partial
  words: "pivt", "sumary"), **plus** prefix boost on title words, **plus** recency (WP8
  `pickerRank` recency), **plus** port-type compatibility when there is a source port.
  Weights in one table at the top of the file. Index built once at load (< 2 ms for ~150 docs).
- Synonyms table (small, hand-written): sum→total/aggregate, filter→where, join→merge/lookup,
  pivot→crosstab, csv→table, llm→ai/model, decide→judge/classify, chart→plot/graph, sql→query.
- **JEV helper (optional):** when JEV is configured and the query is a phrase of ≥ 3 words
  ("turn monthly sales into a bar chart"), after 400 ms ask JEV `choice` over the top 8 results
  (as WP8 does) and blend 0.6 local / 0.4 JEV; show the ✦ mark. Off switch in settings. Never
  blocks typing; local results show first.
- Replace `shared/pickerRank.ts` ranking and `shared/libraryFilter.ts` filtering with this engine
  (keep their exports as thin wrappers so tests still pass, then update tests).

## Tests

`cardSearch.test.ts`: "pivot" → DataPipe · Pivot first; "pivt" (typo) still finds it; "sum by
region" → Group and summarise; "plot" → Chart; "duck" → Database · DuckDB; recency changes ties;
port compatibility filters. `nodeGroups` covers every type.

## Planner check

`/` on canvas → type "pivot" → Enter inserts a DataPipe already set to Pivot at the pointer.
Right-click menu sections in the stated order. Library and picker show the same groups.
