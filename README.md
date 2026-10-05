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

The app starts the same local server inside itself on a free `127.0.0.1` port and keeps its data
in the user-data folder (Help → Open data folder). Local AI servers (Ollama, LM Studio, Magpie,
a System One API) work without internet; network tools use the system `ping`, `dig`, etc.

To release: bump `version` in `package.json`, commit, then `git tag v<version> && git push --tags`.

## AI providers

You define the providers. Keys stay on this machine in `data/ai-config.json` (mode 600). The page
never receives them.

| Type | Use for | Offline |
| --- | --- | --- |
| OpenAI-compatible | Ollama, LM Studio, vLLM, llama.cpp, Magpie, any `/v1` gateway | yes, when local |
| OpenAI, Anthropic, Google | chat, vision, agent, JEV | no |
| JEV System One API | JEV decisions (Julia-1 and other `/v1/systemone` servers) | yes, when local |

Jobs: *agent, chat, vision, jev*. Tip: the canvas agent needs a model that follows a long JSON
format; through Magpie, `group/auto-gpt-5-6-luna` works well, while Grok often refuses
"JSON only" replies.

- **Fetch models** reads the provider's `/v1/models`. When the provider reports input types
  (Magpie does), image-capable models are marked *vision*.
- Every model dropdown also lists **all live models** of every enabled provider. You can use a
  model without adding it first.
- Nodes that call a language model have **Model settings**: system prompt, temperature, max tokens.

## Nodes

| Group | Nodes |
| --- | --- |
| Input | Prompt, Number, Random (number, pick, shuffle, coin, dice, UUID, password, colour), Load image, Camera, Capture (canvas area) |
| Text & AI | **AI text** (14 jobs), **Summarize** (text, URL, image, video frames), **Text tools** (~65 tools: build, find & extract, clean up, order, case, count & diff, encode & SHA-256, CSV/JSON/Markdown, URL), Generate text, Chat message, Concat |
| Image (runs in the browser) | Crop, Resize (fit / exact stretch / scale / width / height), Filter (presets, sliders, rotate, flip), **Image tools** (info, convert png/jpeg/webp, pixelate, border, round corners, watermark, pad to square, data URL) |
| Logic & code | **JEV decision**, If / else, And / Or / Not, For each (per line / separator / paragraph / JSON / regex), Router, **Code** (TypeScript / JavaScript in a worker, AI writes and explains it) |
| Web | HTTP request, Download URL, **Network tools** (ping, traceroute, dig, DNS, reverse DNS, TCP ports, whois, HTTP headers & redirects, my IPs, subnet calculator, subnet split, IP info) |
| Output | **Output** (text, Markdown, Mermaid, image, link card, JSON), Save to file |

Every node can be resized, collapsed (⌃ icon) and copied (copy icon, bottom right).

### Wires and arrows

- Node wires connect typed ports. For each has a loop-back **Result** port: wire `item → … → Result`.
- A **tldraw arrow** from any shape (text, note, Markdown, image, video, link card) to a node feeds
  that shape in. An arrow from a node to a shape writes the result into it; an arrow that ends on
  empty canvas creates a shape there and binds to it.
- Any AI node reads a URL input: web pages are fetched as text, image URLs as images.

### JEV decisions

The JEV node asks a question about a context (often an LLM's output) and returns probabilities:
yes/no (with yes / no branches), one of several options, or a score. With "filter", an LLM then
applies the decision to the input text. JEV models come from:

- a **System One API** provider (e.g. Julia-1 `POST /v1/systemone`, default `http://127.0.0.1:8011`), or
- any chat model (it is asked for calibrated probabilities as JSON).

### Pack, My nodes, files

- Select nodes → right-click **Pack into one node** (Ctrl+Shift+P). The packed node shows a thumbnail,
  the outside inputs and the final outputs. Double-click to unpack.
- Right-click a packed node → **Save as my node…**. It appears under **My nodes** in the library
  (saved in `data/custom-nodes/`), and can be exported / imported as `.node.json`.
- Main menu → Canvas tools → **Save canvas as JSON** (Ctrl+Shift+S) / **Open canvas JSON…**.

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
| 9 | Ask AI about the selection | Right-click → AI, or Ctrl+Shift+K |
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
| 26 | Pack nodes / save as my node | Right-click, Ctrl+Shift+P |
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
tests/             vitest
```

## Security notes

- The server listens on 127.0.0.1 only. It rejects other `Host` names and other web origins.
- The HTTP, Download and link-card features fetch any http(s) URL that you enter. Use them for
  your own work only.
- Network tools run `ping`, `tracepath`/`traceroute`, `dig` and `mtr` with `execFile` (no shell),
  fixed arguments, a time limit, and a target that must be a host name or IP address.
- Code nodes run in a Web Worker (no access to the page or canvas) with a 15 s limit.

## License

tldraw SDK: [tldraw license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md) — free for
development; a production deployment needs a license key. Starter-kit code: MIT (`LICENSE.md`).
