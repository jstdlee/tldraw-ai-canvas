# Oh My tldraw

One infinite canvas for drawing **and** AI workflows. It is built on [tldraw](https://tldraw.dev) 5.5
and merges four official tldraw starter kits into one app:

| From kit | What you get |
| --- | --- |
| **Agent** | Chat panel (right). The agent reads the canvas (screenshot + shapes) and draws, moves, labels and arranges shapes. |
| **Image pipeline** | The typed node-and-wire system (left library). Its AI image-generation nodes were removed; image nodes now run in the browser. |
| **Branching chat** | **Chat message** node: wire one reply into several children to branch a conversation. |
| **Chat** | Chat with sketches: wire a **Capture** node (a canvas area) into a Chat node's **Attach** port. |

All default tldraw tools stay: draw, shapes, arrows, text, notes, frames, images, video, embeds,
pages, export, undo.

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:5173  (API server on 127.0.0.1:8790)
```

Production / offline:

```bash
npm run build
npm start            # app + API on http://127.0.0.1:8790
```

Then open **AI providers** (chat panel header, main menu, or any model dropdown).

### Desktop app (offline)

The desktop app is built by GitHub Actions (`.github/workflows/desktop.yml`), not on your machine:

- every push to `main` and every pull request: type check, tests, then installers as build artifacts
- a tag like `v0.1.0` (must match `package.json`): the same, plus a **GitHub release** with the files

| System | Files |
| --- | --- |
| Windows x64 | `oh-my-tldraw-<v>-windows-x64-setup.exe`, `oh-my-tldraw-<v>-windows-x64-portable.exe` |
| Linux x64 / arm64 | `.AppImage`, `.deb` |

The same build also ships as a [MyGo](https://mygo.egoist.dev/) app. MyGo uses the system webview and starts the same Node server beside it. `npm run build:mygo` writes that package under `mygo/out/`. Actions uploads one installer per system: a Linux `.deb` for amd64, a Linux `.deb` for arm64, and a Windows setup `.exe`.

The app starts the same local server inside itself on `127.0.0.1:47201` (a free port only when that
one is taken, so the canvas stays in the same browser storage) and keeps its data in the user-data
folder (Help → Open data folder). DuckDB ships with the desktop app; the MyGo build has no DuckDB. Local AI servers (Ollama, LM Studio, Magpie,
a System One API) work without internet; network tools use the system `ping`, `dig`, etc.

To release: bump `version` in `package.json`, commit, then `git tag v<version> && git push --tags`.

## AI providers

You define the providers. Keys stay on this machine in `data/ai-config.json` (mode 600) and in the
secret store `data/secrets.json` (mode 600). The page never receives them; cards keep only a
`secret:<id>` reference.

| Type | Use for | Offline |
| --- | --- | --- |
| OpenAI-compatible | Ollama, LM Studio, vLLM, llama.cpp, Magpie, OpenRouter, any `/v1` gateway | yes, when local |
| OpenAI, Anthropic, Google | chat, vision, agent, JEV, image | no |
| Cloudflare Workers AI | chat models and the **Clef / Clef Flash** decision models | no |
| JEV System One API | JEV decisions (Julia-1, Magpie `/v1/systemone`, other System One servers) | yes, when local |

Jobs: *agent, chat, vision, jev, image*. Set one default model per job in **AI providers**. At
start the app tests each default and shows one warning (and a red dot in the dialog) when a model
is gone or out of quota.

- **Fetch models** reads the provider's `/v1/models`. Image-capable and image-output models are
  marked when the provider reports it.
- Every model dropdown also lists **all live models** of every enabled provider.
- The **Model provider** card fetches models from any OpenAI-compatible URL and outputs the chosen
  model; wire it into the `model` input of an AI card.

## Cards

| Group | Cards |
| --- | --- |
| Sources | Prompt, **Read from** (upload CSV/TSV/XLS/XLSX/text/images, or read a URL), Load image (also from a URL input), Camera, Capture, Random, Number |
| Data | **DataPipe**, **Profile**, **Database**, **Chart** |
| Text | Text tools (~65 tools), Concat, Template |
| AI models | Generate text, **AI text**, Summarize, Chat message, Raw model, **Model provider**, **Generate image** |
| Decide | **JEV decision**, If / else, And / Or / Not, Router |
| Web | HTTP request, Download URL, Network tools, Video link |
| Image | Crop, Resize, Filter, Image tools (all run in the browser) |
| Flow & code | For each, **Code** (TypeScript / JavaScript in a worker), Sleep, group boxes |
| Output | Output (text, Markdown, Mermaid, image, link card, JSON), Save to file |

### Working with cards

- **Insert:** press `/` on the canvas (or Ctrl+Shift+I) and type. Search uses names, descriptions
  and keywords, forgives typos ("pivt" finds Pivot) and ranks recent cards higher. Preset entries
  insert a ready card, e.g. "DataPipe · Pivot", "Chart · Line", "Database · DuckDB". With a JEV
  model set, longer phrases ("turn monthly sales into a bar chart") are re-ranked by it.
- **Wire anything:** every field on a card has an input dot on its row. A wired value replaces the
  field (it must fit the field type); remove the wire and the typed value comes back.
- **Template variables:** `{{name}}` in a prompt adds an input called `name`. AI cards also take
  `model`, `system` and `params` (JSON, e.g. `{"temperature":0}`) inputs.
- **Run:** the Run button (or Enter in a prompt; Shift+Enter is a new line) first runs any stale
  card upstream, then the card, then the cards after it. Cards whose settings and inputs did not
  change are skipped and show **cached**; "Run without cache" is in the card menu.
- **Errors** show in a panel under the card, with Copy and **Fix with AI**.
- **Group as box** (Ctrl+Shift+P): selected cards become one box with every free input and final
  output. Double-click opens it in place; **Close to box** packs it again. Right-click → **Save as
  my node** keeps it in the library.
- **AI:** the sparkle button on a card asks an assistant that knows that card type and shows the
  changes before you apply them. **Build with AI** (right-click → AI, or Ctrl+Shift+K) plans cards
  and wires for a goal, from the selection or from nothing; you see the plan first.
- **Shortcuts:** Ctrl+E deletes the selection; Ctrl+B, C, then G / K / B / R / Y sets the colour of
  shapes and cards.

### Data: import → columns → chart

- **DataPipe** is one step on a table; chain steps with **Add next step**. Each operation shows
  only its own fields, with column pickers from the real headers and a preview grid.
  - Columns: keep, remove, rename. Rows: filter, keep matching, sort, remove duplicates, first N,
    repeat. Values: convert, find and replace, fill empty, split.
  - New column: **formula**, combine, date part, buckets, map values, rank, running total, percent
    of total.
  - Combine: append a second table, join by key. Summarise: **group by** (several keys, named
    summaries: count, distinct, sum, avg, min, max, median, first, last), **pivot** (with totals),
    columns to rows.
  - Formulas: `+ - * / %`, comparisons, `and or not`, `&` to join text, and functions such as
    `round`, `if`, `ifs`, `coalesce`, `upper`, `left`, `contains`, `year`, `month`, `datediff`,
    `dateadd`. A live preview shows the first rows while you type.
- **Profile** shows each column's type, empty count, distinct values, range and a small histogram.
- **Chart:** bar, horizontal bar, line, area, scatter, pie, donut, histogram, heatmap. Split series
  by a column, summarise on the fly, stack, sort, top N with "Other", titles and labels. The output
  is a PNG you can place on the canvas.
- **Database** has four sources:
  - **SQLite file** (opened in the browser; "Save file" keeps changes)
  - **Built-in Postgres** (PGlite in the browser)
  - **Postgres** server (host or a pasted `postgres://` URL; the password goes to the secret store)
  - **DuckDB** file (and `SELECT * FROM '/path/data.parquet'` reads local CSV / Parquet / JSON)

  Full SQL: read, insert, update, delete, create / alter / drop. Scripts with writes run in one
  transaction and roll back on the first error. `DROP`, `TRUNCATE`, and `DELETE` / `UPDATE` without
  `WHERE` ask "Run anyway" in the card first. Wire DataPipe rows into the card to load them into a
  table (insert, upsert on a key, or replace).

### JEV decisions

The JEV card asks a question about a context and returns probabilities: yes/no (with yes / no
branches), one of several options, or a score. JEV models come from a **System One API** provider
(Julia-1, Magpie), **Cloudflare Clef / Clef Flash**, or any chat model (asked for calibrated
probabilities as JSON).

### Files

- Main menu → Canvas tools → **Save canvas as JSON** (Ctrl+Shift+S) / **Open canvas JSON…**.
- My nodes are saved in `data/custom-nodes/` and can be exported / imported as `.node.json`.

## Daily canvas features

| # | Feature | How |
| --- | --- | --- |
| 1 | Link cards (title, picture, icon, click to open) | Paste a URL. The picture is stored locally. |
| 2 | Markdown clip (tables, code, clickable checklists, links) | Toolbar, Alt+M, or paste Markdown |
| 3 | Mermaid diagram clip (rendered locally) | Toolbar, Alt+G, or paste Mermaid code |
| 4 | Edit image: rotate, flip, filters, presets, resize, save as copy | Right-click an image, or Alt+E |
| 5 | Crop image | Double-click an image (tldraw) |
| 6 | Describe image (AI) | Right-click an image |
| 7 | Extract text from image (OCR, AI) | Right-click an image |
| 8 | Use image in a pipeline | Right-click an image → Load image node |
| 9 | Build with AI / ask about the selection | Right-click → AI, or Ctrl+Shift+K |
| 10 | Explain selection (AI reads a snapshot) | Right-click → AI |
| 11 | Summarize text | Right-click → AI |
| 12 | Translate text | Right-click → AI |
| 13 | Improve writing | Right-click → AI |
| 14 | Brainstorm ideas (checklist) | Right-click → AI |
| 15 | Canvas agent that draws and edits | Chat panel |
| 16 | Web page → Markdown clip | Right-click empty canvas |
| 17 | QR code from text or link | Right-click |
| 18 | Find text on the canvas | Ctrl+Shift+F |
| 19 | Insert date & time | Alt+D |
| 20 | Word / character count | Right-click, or Alt+W |
| 21 | Show/hide node library and agent chat | Shift+N, Shift+A, or top-right buttons |
| 22 | Save selected nodes as a reusable template | Template button in the toolbar |
| 23 | Export PNG/SVG, copy as image, pages, embeds | tldraw main menu |
| 24 | Text wrap on / off | Right-click a text shape, or Alt+T |
| 25 | Image keep ratio on / off | Right-click an image, or Alt+R |
| 26 | Group as box / save as my node | Right-click, Ctrl+Shift+P |
| 27 | Save / open canvas JSON | Ctrl+Shift+S, main menu |

## Layout

```
client/            React app
  App.tsx          one <Tldraw>: tools, menus, panels
  agent/ actions/ parts/ modes/ components/   agent kit (chat panel, canvas actions)
  pipeline/        node system: nodes/, connection/, ports/, execution/
  clips/           Markdown & Mermaid shapes, image editor, find bar, AI/menu actions
  ai/              provider settings dialog, model dropdowns
shared/            types and pure logic used by client and server
server/            Hono server: /stream (agent), /api/chat, /api/generate*, /api/http, ...
data/              runtime data (config, images, downloads, exports) — not committed
tests/             vitest (unit); tests/e2e: Playwright browser tests (npm run test:e2e, local only)
```

## Security notes

- The server listens on 127.0.0.1 only. It rejects other `Host` names and other web origins.
- The HTTP, Download and link-card features fetch any http(s) URL that you enter. Use them for
  your own work only.
- Network tools run `ping`, `tracepath`/`traceroute`, `dig` and `mtr` with `execFile` (no shell),
  fixed arguments, a time limit, and a target that must be a host name or IP address.
- Code nodes run in a Web Worker (no access to the page or canvas) with a 15 s limit.
- API keys, tokens and database passwords are kept in the server secret store; the canvas, backups
  and AI prompts carry only `secret:<id>` references.
- Database DuckDB paths must be absolute and inside your home folder or `/tmp`.

## License

tldraw SDK: [tldraw license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md) — free for
development; a production deployment needs a license key. Starter-kit code: MIT (`LICENSE.md`).
