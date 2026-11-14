# WP50 — AI cards: Document Q&A, Classify, Speech to text, Text to speech

Read `docs/rework/RULES.md` first. tldraw is 5.6.0. Read an existing AI card end to end before adding
one: `client/pipeline/nodes/types/TextAINode.tsx`, `GenerateTextNode.tsx`, `ExtractNode.tsx`,
`shared/nodeSpecs.ts`, `shared/nodeGroups.ts`, `shared/nodeCatalog.ts`, `shared/nodeDescriptions.ts`,
`client/pipeline/nodes/registry.ts`, `server/llm.ts`, `server/index.ts` (routes), `shared/aiConfig.ts`
(model capabilities), `client/ai/AIProvidersDialog.tsx`. Every new card must appear in the library, the
`/` insert palette, the AI catalog and the card help. All new cards go in the **AI models** group.

## Model capabilities

Add capabilities to `ModelCapability`: `embed`, `stt` (speech to text), `tts` (text to speech).
Old saved configs must keep loading (unknown capability lists stay valid). The AI providers dialog lets
the user mark a model with them and pick a default for each, like the existing ones. Calls go through
the server to OpenAI-compatible endpoints: `/v1/embeddings`, `/v1/audio/transcriptions`,
`/v1/audio/speech` (Magpie and Ollama serve OpenAI-compatible APIs). A card whose capability has no
model shows the existing "set up a model" message with a link to AI providers.

## New cards

1. **Document Q&A.** Inputs: `documents` (text, a table of texts, or file paths from Read from / HTTP),
   `question`. Fields: **Chunk size** (default 800 chars, overlap 100), **Top K** (default 5), **Model**
   (chat). Retrieval: with an `embed` model, embed chunks and the question, cosine similarity; without
   one, BM25 keyword ranking (pure TS in `shared/`). Cache chunk embeddings per document hash in the
   run cache so a second question does not re-embed. Outputs: `answer` (text, cites sources as [1],
   [2]…) and `sources` (table: rank, score, chunk text, document name). The answer must say when the
   documents do not contain the answer.
2. **Classify.** Input `input` (text or a table column). Fields: **Labels** (one per line, optional
   description after `:`), **Multi-label** (on/off), **Model**. Output `label` (or labels joined) and,
   for table input, a table with an added `label` column and a `confidence` column (model-reported,
   0–1). Use structured JSON output with validation and one retry, like Extract.
3. **Speech to text.** Input: audio (file path, URL, or data URL from Load file / Capture / Camera
   with audio, or a microphone button inside the card that records with `MediaRecorder`). Fields:
   **Language** (auto or code), **Model** (stt). Output: `text`, plus `segments` table when the model
   returns timestamps.
4. **Text to speech.** Input `text`. Fields: **Voice** (free text, with the model's known voices as
   suggestions when the API lists them), **Format** (mp3 / wav), **Model** (tts). Output: audio file
   path (saved under the data dir like downloads) and an audio player inside the card.

Schema rule: new fields optional; add each new type to `tests/nodeRequiredFields.json`.

## Tests

- Unit: BM25 ranking, chunking with overlap, cosine top-K, label parsing, capability config loading
  (old config without the new capabilities still loads).
- Server tests with a mocked OpenAI-compatible endpoint (as existing server tests do) for embeddings,
  transcription and speech.
- E2E `tests/e2e/ai-cards.spec.ts` with `page.route` mocks: Document Q&A with and without an embed
  model returns an answer with sources; Classify on text and on a table; Speech to text from a small
  WAV fixture; Text to speech produces a playable file; missing-model message for each.

## Done means

`npx tsc --noEmit -p .` clean, `npx vitest run` green, your spec passes with
`CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=2000 E2E_WEB_PORT=5209 E2E_API_PORT=8809 npx playwright test tests/e2e/ai-cards.spec.ts`
plus `ai-providers-dialog.spec.ts` and any spec you changed. Do not run the whole e2e suite. Do not commit.
