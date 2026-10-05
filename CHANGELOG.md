# Changelog

## 0.1.0

- Map of the open file in a panel beside the editor: files that import it, files and packages it imports, its tests, and a second layer one step further out.
- Checks from the code: files the folder pattern expects but that are missing, and circular imports.
- Scan with AI: a summary and things worth checking for the open file, from a local Ollama model.
- Cloud scan through the Claude Code or Codex CLI, with a prompt before the first scan in a workspace.
- Team rules in `.wayfinder/rules.md`, your own rules in `wayfinder.ai.instructions`, and `wayfinder.ai.scope` to also send direct imports, callers and tests.
- Commands: Show map for this file, Choose AI model, Create AI rules file.
