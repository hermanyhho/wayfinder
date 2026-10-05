# Wayfinder

Shows where the open file sits in the codebase, in a panel beside the editor. The map's editor group is locked, so files you open from the explorer open in the other group.

- **Imports this file:** files that import the open file.
- **Imported by this file:** project files and packages the open file imports.
- **Tests:** test files that import the open file.
- **Same folder:** files the folder pattern expects but that are missing, and circular imports.
- **Second layer:** one more step out in both directions.

Everything above comes from the code. **Scan with AI** can add a summary and things worth checking for the open file, from a local Ollama model. AI text is shown under the facts from code and never replaces them.

## Use

Open a TypeScript or JavaScript file and run **Wayfinder: Show map for this file**, or click the map button in the editor title bar.

## AI scan

1. Install [Ollama](https://ollama.com) and pull a model, for example `ollama pull qwen2.5-coder:1.5b`.
2. Set `wayfinder.ai.model` to that model name. Clicking "AI not set up" in the top bar, or "Open AI settings" in the side panel, opens these settings. `wayfinder.ai.baseUrl` defaults to `http://localhost:11434`.
3. The top bar shows `AI ready: <model>`. Press **Scan with AI** in the side panel.

Findings that name a file or line outside the import map are dropped. Results are kept until the file changes or the panel closes.

## Develop

    npm install
    npm run build
    npm test

Press F5 to start the Extension Development Host with `test/sample-project`.

## Limits

- TypeScript and JavaScript only.
- Uses the first workspace folder and its root `tsconfig.json` or `jsconfig.json`.
- Unsaved changes show after the file is saved.

Forked from MapMyCode (MIT).
