# Contributing to Wayfinder

Wayfinder is a VS Code extension that maps where the open file sits in the codebase.

## Set up

```bash
npm install
npm run build
```

Press `F5` in VS Code to start the Extension Development Host. Open a TypeScript file and run "Wayfinder: Show map for this file".

## Before a pull request

- Run `./check.sh`. It runs the typecheck, unit tests and build.
- Keep one issue per pull request. Put `Closes #<n>` in the description.
- Use Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`.

## Workflow

[`AGENTS.md`](AGENTS.md) has the full workflow:

- Work items in GitHub Issues, each with a priority hint
- The repo map and the testing rules
- The `/dev-cycle` and `/autopilot` commands for agent-driven work
