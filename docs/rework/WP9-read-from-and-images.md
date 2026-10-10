# WP9 — "Read from" input, image URLs and paste, image generation card

Owner feedback (second round): File in and URL in become one "read from" input that supports file
upload and URL read; remove reading files from a server path; images accept a URL input; a pasted
image link previews and can be resized; a new image-generation card (Google, OpenAI, OpenRouter,
custom URL) with N images in a grid and enlarge on canvas. Read `RULES.md` first. WP1–WP8 done:
use the kit, the file store (`/api/files`, `client/pipeline/fileStore.ts`, WP5), `createNodeAt` (WP3).

## 1. "Read from" (replaces File in + URL in)

Facts: `file_in` (`client/pipeline/nodes/types/InputNodes.tsx` ~L49–164) has modes upload | path;
path mode calls `POST /api/file/read` (`server/batchRoutes.ts` ~L78–140) and is **broken** (client
reads `payload.output`, server returns `{text}`). Upload keeps text ≤ 1 MB. `url_in` (~L170–237)
normalises a URL and can fetch page text through `/api/http`.

- Keep type id `file_in`; `title`/`heading` = **"Read from"**. Add optional fields:
  `source?: 'upload' | 'url'` (default `'upload'`), `url?: string`, `fileUrl?: string`
  (file store), `fileSize?: number`, `asText?: 'auto' | 'text' | 'pagetext'`.
- UI: `UiSegmented` **Upload | URL**.
  - Upload: drop zone + button; file goes to the file store (limit 50 MB); show name, size, type,
    replace/clear. Output = text for text-like files (csv, tsv, txt, md, json, xml, html, code; UTF-8),
    an image URL (`/api/images/...` via `storeBlob`) for images, CSV of the first sheet for xls/xlsx
    (reuse `client/pipeline/excel.ts`, sheet picker when several), and for other binaries the file
    URL plus a note. SHA-256 action stays as an option in the ⋯ of the node? — keep it simple: an
    optional `UiCheckbox` "Output SHA-256 instead".
  - URL: `UiTextInput` + optional input port `url` (text) that overrides it. Read through the server
    (`/api/http`, existing). `asText`: auto (HTML → readable page text, else raw body), text (raw), pagetext.
    Images at a URL → imported with `/api/images/from-url` and output as image URL.
  - Preview area (`showsOutput = true`): first 2 000 chars (mono) or the image.
- Remove path mode: delete the path UI, delete `POST /api/file/read` and `readablePath` from the
  server if nothing else uses them (grep). Old nodes with `mode: 'path'` show a `UiEmpty` "Reading
  files from the server was removed. Upload the file or use a URL." and throw that on run.
- `url_in`: mark `hidden = true` (still runs in old canvases, not offered in the library/picker).
  Its card shows a small note "Replaced by Read from" with a button **Convert** that swaps the node
  to `file_in` with `source: 'url'` and the same URL (keep position and wires: update the `node`
  prop in place; wires bind by port id — map `url_in` port ids to the new ones).
- Update catalog (`shared/nodeCatalog.ts`), descriptions (`shared/nodeDescriptions.ts`), specs if
  present, examples using `url_in`/`file_in` path mode, and tests (`tests/improvements.test.ts`).

## 2. Image URL as input

- `load_image` (`LoadImageNode.tsx`): add an input port `url` (text). When wired, its value
  (http(s) image URL, data URL or `/api/images/...`) is imported on run (`apiImportImage`) and wins
  over the stored source. Remove the server **path** branch of `apiImportImage` for anything that is
  not `http(s)`, `data:` or `/api/images/` → error "Paste an image, upload one, or use an image URL."
  Delete `/api/images/from-path` and `importLocalImage` if unused afterwards.
- Port compatibility: allow a `text` output to connect to an `image` input
  (`arePortDataTypesCompatible` in `client/pipeline/ports/portCompatibility.ts`: `text → image` is
  allowed; not the other way). Image nodes' `execute` must then accept an image URL string from a
  text source: add a shared helper `toImageUrl(value)` in `client/pipeline/imageOps.ts` that imports
  remote URLs once (cache by URL) and throws a clear error for non-image text.

## 3. Paste an image link

In `client/clips/canvasFeatures.ts` (~L253–300): register a `url` external-content handler
(`editor.registerExternalContentHandler('url', …)`) that runs **before** the bookmark default:
- If the URL path ends with an image extension, or a quick server check says the content type is
  `image/*` (add `POST /api/images/probe {url}` → `{ isImage, mime, width?, height? }` with a HEAD,
  falling back to a ranged GET, 5 s timeout), import it with `/api/images/from-url`, create a tldraw
  **image asset + image shape** at the paste point with its natural aspect ratio (max 640 px wide).
  It is a normal tldraw image: resizable with handles, aspect locked (existing `RatioImageShapeUtil`).
- Otherwise fall back to the existing behaviour (bookmark).
- If the paste target is a selected `load_image` node, set its source instead (existing `pastePatch`).

## 4. Image generation card (new node `image_gen`)

Provider setup reuses the AI providers config (keys stay on the server).

### Config + server

- `shared/aiConfig.ts`: new capability `'image'` (`MODEL_CAPABILITIES`). New provider preset
  "OpenRouter" (`kind: 'openai-compatible'`, `baseURL: 'https://openrouter.ai/api/v1'`).
  `guessCapabilities`: ids matching `/gpt-image|dall-e|imagen|image-preview|flash-image|flux|sdxl|stable-diffusion|seedream|ideogram/i` → `['image']`.
  The filter that hides image models from chat lists (~L181) stays for chat; the image picker lists
  `image` models.
- `server/imageGen.ts` + `POST /api/generate-image`:
  `{ model?: string (model key), prompt: string, n: 1..8, size?: '1024x1024'|'1536x1024'|'1024x1536'|'auto', images?: string[] (reference images), negative?: string, seed?: number }`
  → `{ images: string[] /* /api/images/... */, usage? }`. Resolve with `resolveModel(model, 'image')`.
  Per provider kind:
  - `openai` and generic `openai-compatible` (custom URL): `POST {base}/images/generations`
    `{ model, prompt, n, size, response_format: 'b64_json' }` (gpt-image returns b64 by default; accept
    `url` too and download it). With reference images use `/images/edits` (multipart).
  - **OpenRouter** (`openai-compatible` whose base host is `openrouter.ai`): `POST {base}/chat/completions`
    `{ model, messages:[{role:'user', content:[{type:'text',text:prompt}, …images]}], modalities:['image','text'] }`;
    images come back in `choices[0].message.images[].image_url.url` (data URLs). Loop for n > 1
    if the model returns one image per call.
  - `google`: Gemini image models (`gemini-*-image*`): `POST {base}/models/{model}:generateContent`
    with `generationConfig.responseModalities: ['IMAGE','TEXT']`, read `inlineData` parts. Imagen
    models (`imagen-*`): `POST {base}/models/{model}:predict` `{ instances:[{prompt}], parameters:{ sampleCount:n, aspectRatio } }`,
    read `predictions[].bytesBase64Encoded`.
  - Store each image with the existing image store; return URLs. Errors: provider status + message,
    never the key. Timeout 120 s.
- `listProviderModels`: Google/OpenAI lists already include image models; OpenRouter `/models`
  includes `architecture.output_modalities` — mark `image` capability when it contains `"image"`.

### Node

- Type `image_gen`, title **"Generate image"**, group `image`. Ports: `prompt` (text, in),
  `image` (image, in, optional reference), `model` (model/text, in, optional — WP10 model card);
  outputs `output` (first image, image) and `images` (text: all URLs, one per line).
- Fields: `model` (ModelSelect filtered to `image`; with a "Set up providers…" item that opens the
  AI providers dialog), `prompt` (main text area, grows), `n` (`UiSegmented` 1 2 4 or number 1–8),
  `size` (UiSelect), optional `negative`, `seed`; results `images: string[]`, `lastUsage`.
- Body: prompt, settings row, then a **grid** of results (2 columns; 1 when n=1), each tile
  `object-fit: cover`, hover actions: Enlarge (ImageZoom dialog from WP8), Place on canvas
  (`placeImageOnCanvas` beside the node, natural size, resizable), Use as reference (copies URL to
  the `image` field), Download. `showsOutput = true`. Empty: `UiEmpty` "Write a prompt and press Run".
- Enter in the prompt runs the node (Shift+Enter = new line) — same rule as WP10.
- The removed stub `generate` stays a removed stub (do not reuse its id).

## Tests

- `tests/imageGen.test.ts`: request body builders per provider kind (pure functions in
  `server/imageGen.ts` exported for tests), response parsers for OpenAI b64, OpenRouter message
  images, Gemini inlineData, Imagen predictions.
- `tests/readFrom.test.ts`: file-kind detection helper (text / image / sheet / binary by name+mime).
- Port compatibility: text→image allowed, image→text not.

## Planner check

Read from: upload CSV, XLSX (sheet), PNG; URL of a web page and of a raw CSV. Old path-mode node shows
the removal note. Paste `https://…/x.png` on the canvas → resizable image. Generate image with an
OpenAI-compatible and an OpenRouter model, n=4 grid, enlarge, place on canvas.
