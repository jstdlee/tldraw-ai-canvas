# AI Canvas

One infinite canvas for drawing **and** AI workflows. It is built on [tldraw](https://tldraw.dev) 5.5
and merges four official tldraw starter kits into one app:

| From kit | What you get |
| --- | --- |
| **Agent** | Chat panel (right). The agent reads the canvas (screenshot + shapes) and draws, moves, labels and arranges shapes. |
| **Image pipeline** | Typed nodes and wires (left library): prompt → generate → upscale → preview, ControlNet, IP-Adapter, style transfer, blend, adjust, router, iterator, capture. |
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

## AI providers

You define the providers. Keys stay on this machine in `data/ai-config.json` (mode 600). The page
never receives them.

| Type | Use for | Offline |
| --- | --- | --- |
| OpenAI-compatible | Ollama, LM Studio, vLLM, llama.cpp, Magpie, any `/v1` gateway | yes, when local |
| OpenAI, Anthropic, Google | chat, vision, agent | no |
| ComfyUI | image generation (built-in checkpoint graph or your own API-format workflow), upscale | yes |
| Replicate | image generation, upscale | no |

- **Fetch models** reads the provider's `/v1/models`. When the provider reports input types
  (Magpie does), image-capable models are marked *vision*.
- Every model dropdown also lists **all live models** of every enabled provider. You can use a
  model without adding it first.
- Each model has jobs: *agent, chat, vision, image, upscale*. Set a default model per job.
- Nodes that call a language model have **Model settings**: system prompt, temperature, max tokens.

## Nodes

| Group | Nodes |
| --- | --- |
| Input | Image model, Prompt, Load image, Capture (canvas area → image) |
| Text | **AI text** (summarize, bullets, translate, rewrite, fix, simplify, keywords, title, extract JSON, classify, Q&A, explain, image prompt, custom) · **Text tools** (template, find & replace, regex, JSON path, split/join, append, count, trim, sort, unique, case, strip HTML, slug, URL / Base64 encode-decode) |
| Image & chat | Generate, Generate text, Chat message, ControlNet, Blend, Adjust, Upscale, Style transfer, Concat, IP-Adapter, Router, Iterator, Number |
| Web | **HTTP request** (GET/POST/PUT/PATCH/DELETE, headers, body, web page → readable text, image responses become images) · **Download URL** (saves to `data/downloads`) |
| Output | Preview, **Text view**, **Save to file** (`data/exports`) |

Each node's ⋮ menu has **Place image / text on canvas**, so results become normal tldraw shapes.

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

## License

tldraw SDK: [tldraw license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md) — free for
development; a production deployment needs a license key. Starter-kit code: MIT (`LICENSE.md`).
