# Wayfinder

See where the open file sits in your codebase, in a panel beside the editor.

![The Wayfinder map beside DocumentService.ts: three callers above, the files it imports, its members and its tests, and the side panel with the file's exports and connections](media/map.png)

## The map

| Column | Shows |
|---|---|
| **Imports this file** | Files that import the open file |
| **Imported by this file** | Files and packages it imports, grouped by kind. Circular imports are red |
| **Members** | Classes, functions, methods and more, with a visibility tag and how many files use each one |
| **Tests** | Test files that import it |

The columns change with the file:

- **Interface:** the third column is **Implemented by**, with the classes that implement it and the interfaces that extend it.
- **React component:** the first column has a **Component tree** tab, and Members gets a **Props** group.
- **Test file:** Members lists the test groups with their test cases nested under them, and the third column is **Tested code**.

![The map of EmployeeService.ts with ContractService.ts as a red circular import card](media/circular-import.png)

**Second layer** shows one more step out: who imports the callers, and what the imports use.

![The second layer around the immediate layer](media/second-layer.png)

## Use

Open a TypeScript or JavaScript file and press **Cmd+Alt+M** (Ctrl+Alt+M), or click the map button in the editor title bar.

| Key | Does |
|---|---|
| Cmd+Alt+M | Open the map, or go back to the editor |
| Arrow keys | Move between cards |
| Enter | Select a card, or jump to a member's line |
| Cmd+Enter | Open the file |
| `/` | Search the column |
| Cmd+Alt+Enter | Focus mode on or off |
| Alt+] / Alt+[ | Next or previous column in focus mode |

Use Ctrl in place of Cmd on Windows and Linux. To change a key, search `Wayfinder` in Keyboard Shortcuts. The `wayfinder.shortcut.*` settings turn shortcuts off.

**Focus mode** gives one column the full width, for long names.

![Focus mode with the Members column in the centre](media/focus-mode.png)

## Call chain

Put the cursor in a function and run **Wayfinder: Show call chain**, or click the call chain icon on a member card.

![Call chain for markSent: callers above, callees below, one row per layer](media/call-chain.png)

- Callers above, callees below, one row per depth, up to 3 levels each way.
- **deeper** loads one more level. The flip button swaps callers and callees.
- Only direct calls are shown. Calls through events, callbacks or dependency injection are not found.
- Works in any language whose extension gives VS Code a call hierarchy, for example C# (C# Dev Kit), Python (Pylance), Go or Java.

## Branch changes

Run **Wayfinder: Show branch changes**, or pick **Branch changes** in the map toolbar.

- Compares the branch with the branch `origin/HEAD` points to, else `main`, else `master`. Includes uncommitted and new files.
- Three columns: the changed files, the files that import them, and the files one step further.
- **Changed files without tests** lists changed files that no test imports.
- The side panel lists the tests to run. **Copy test files** copies their paths, separated by spaces.
- Click a card to open that file's map.

## AI scan

Optional. Adds a summary and things worth checking, under the facts from code.

1. Install [Ollama](https://ollama.com) and pull a model, for example `ollama pull qwen2.5-coder:1.5b`. Or log in to the Claude Code or Codex CLI.
2. Run **Wayfinder: Choose AI model**.
3. Press **Scan with AI** in the side panel.

<p>
  <img src="media/scanning.png" width="290" alt="The side panel while scanning, with the tooltip Scans with qwen2.5-coder:1.5b">
  <img src="media/ai-summary.png" width="290" alt="The Why tab after a scan, with an AI summary of DocumentService">
</p>

To explain one card in Members (a test group, test case, function, method or class), press the gold sparkle on the card. The answer opens under the card. Press the **AI** tag to hide or show it again without a new request.

Add team rules in `.wayfinder/rules.md` (**Wayfinder: Create AI rules file**), or your own in `wayfinder.ai.instructions`.

![Wayfinder settings](media/settings.png)

### Privacy

- The map and the checks run on your machine and send nothing.
- Ollama: code goes only to `wayfinder.ai.baseUrl`, by default your own machine.
- Claude Code or Codex: the open file goes to Anthropic or OpenAI. Wayfinder asks before the first cloud scan in a workspace.
- Explaining a card sends only that member's own lines.
- `wayfinder.ai.scope` set to `neighbours` also sends its imports, tests and callers.
- No model set means AI is off and nothing is sent.

## Limits

- The map covers TypeScript and JavaScript only. The call chain needs the language's extension to provide a call hierarchy.
- Uses the first workspace folder and its root `tsconfig.json` or `jsconfig.json`.
- Unsaved changes show after the file is saved.

## Develop

    npm install
    npm run build
    npm test
    npm run package    # builds wayfinder-<version>.vsix

Press F5 to start the Extension Development Host with `test/sample-project`.

Forked from MapMyCode (MIT).
