# AI scan with Ollama: design

First part of #16. The open file can be scanned by a local Ollama model. The scan adds a summary and findings under the facts from code. It never replaces them.

Design boards: the "AI ready" boards at https://claude.ai/artifact/MUHcCKRXFR9PNH6rBNHAPB, copy in `docs/design/wayfinder-mockup.dc.html`.

## Scope

In:

- "Scan with AI" button in the side panel for the open file. The label changes to "Scanning" while a scan runs and to "Scan again" after a result.
- AI block under the facts from code: summary, then "Worth checking" findings, then the line "Every file and line named here exists in the import map."
- Loading bars while a scan runs. The old AI text is hidden during a rescan.
- AI status in the top bar: "AI ready: <model>" or "AI not set up". The reason shows next to the disabled button: "AI not set up: <reason>".
- Settings `wayfinder.ai.baseUrl` and `wayfinder.ai.model`.

Out, for later issues:

- Gold AI role labels on floors.
- Written AI answers under the "More about this file" asks.
- Scanning files other than the open file.
- Providers other than Ollama, and a `provider` setting.

## How a scan runs

1. The user presses "Scan with AI". The webview sends `{ type: "scan" }`.
2. The extension host reads the open file's text and builds the prompt: the file source plus the paths of the files in the current `ViewData`.
3. The host calls `OllamaProvider.chat` from `src/providers/index.ts` with `format: "json"` and `options.num_ctx: 8192`.
4. The model replies with `{ "summary": string, "findings": [{ "file": string, "line": number, "text": string }] }`.
5. The host parses the reply and drops every finding whose `file` is not a node in the `ViewData`, or whose `line` is outside that file.
6. The host sends `{ type: "ai", openFile, result }` to the webview, and the panel renders the AI block.

The extension host makes the request. The webview CSP stays as it is.

## Changes by file

| File | Change |
|---|---|
| `src/providers/index.ts` | `OllamaProvider` takes optional `format` and `numCtx` and sends them to `/api/chat`. Add `listModels()` that reads `/api/tags`. Other providers unchanged. |
| `src/ai/scanFile.ts` (new) | Pure functions: `buildScanPrompt(source, viewData)`, `parseScanReply(reply, lineCountByFile)` and `aiStatusFor(model, baseUrl, installedModels)`. |
| `src/shared/messages.ts` | Add `{ type: "scan" }` to `WebviewMessage`. Add `{ type: "aiStatus" }` and `{ type: "ai" }` to `HostMessage`. |
| `src/view/WayfinderPanel.ts` | Handle `scan`, check AI status on open and on settings change, keep results in memory. |
| `src/webview/main.ts`, `render.ts`, `styles.css` | AI status chip, button, loading bars and AI block, using the mockup's classes (`aistate`, `aibtn`, `aiblock`, `aih`, `aib`, `findings`, `skl`, `based`). |
| `package.json` | Contribute the two settings. |

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `wayfinder.ai.baseUrl` | `http://localhost:11434` | Where Ollama runs. |
| `wayfinder.ai.model` | empty | Ollama model name, for example `qwen2.5-coder:1.5b`. Empty means AI is not set up. |

## Status and errors

The host checks status when the panel opens and when either setting changes. It calls `/api/tags` and looks for the model in the list.

| Situation | What the user sees |
|---|---|
| Model set and listed by Ollama | "AI ready: <model>", button enabled |
| `wayfinder.ai.model` empty | "AI not set up: set wayfinder.ai.model", button disabled |
| Ollama does not answer | "AI not set up: Ollama is not running at <baseUrl>", button disabled |
| Model not in the list | "AI not set up: run ollama pull <model>", button disabled |
| No reply after 120 seconds | Scan stops: "The model took too long. Try again." |
| Reply is not valid JSON, or has no summary | "The model's reply could not be read. Try again." |

## Results in memory

- Results are kept in a `Map` in `WayfinderPanel`, keyed by file path, with a hash of the file text that was scanned.
- When the user returns to a file with a stored result and the text hash still matches, the panel shows the result and the button says "Scan again".
- If the hash differs, the result is dropped and the button says "Scan with AI".
- Results are lost when the panel closes.

## Size limit

- `num_ctx: 8192` lets the model read about 8192 tokens, roughly 24,000 characters.
- The prompt includes at most 20,000 characters of the file. When the file is longer, the prompt says that the file was cut and where.

## Tests

- `test/unit/ai/scanFile.test.ts`: the prompt includes the source and the neighbour paths, and marks a cut file; the parser accepts a valid reply, rejects invalid JSON and a missing summary, and drops findings with an unknown file or a line out of range.
- No unit tests for the webview rendering, following AGENTS.md.

## Manual check

With Ollama running and `wayfinder.ai.model` set to `qwen2.5-coder:1.5b`: open a file in `test/sample-project`, show the map, press "Scan with AI", and see loading bars, then the summary. Stop Ollama, reopen the panel, and see "AI not set up: Ollama is not running at http://localhost:11434".
