# Wayfinder agent guide

This is the provider-neutral guide for working in this repo. Any agent (Claude, Codex or another) starts here. `CLAUDE.md` is a short Claude adapter that points back to this file.

Wayfinder is a VS Code extension. It shows where the open file sits in the codebase: the files that import it, the files it imports, its tests, expected files that are missing, and a second layer behind those. The map comes from the code. An optional AI scan of the open file uses a local Ollama model, or Claude Code or Codex through their CLIs.

## Ground rules

- Code is the source of truth. Read the source before making or presenting a claim.
- Work items live in GitHub Issues, not in local task files. Reference the issue number in commits and PRs.
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`.
- Keep solutions small. No abstraction the current issue does not need.
- Plain language in comments and docs. No comment that describes what code does, only a non-obvious why.
- Unit tests for logic (graph, layout, panel model). No unit tests for presentational code (`src/webview/render.ts`, `styles.css`).
- Update docs in the same change when you change behaviour they describe.
- End every piece of implementation work with a manual verification checklist.

## Task tracking: GitHub Issues

- Issues: https://github.com/hermanyhho/wayfinder/issues
- Look there first. `gh issue list` from the terminal.
- Pick an open issue, reference `#<n>` in the commit and PR, close it with `Closes #<n>` in the PR body.
- New ideas, even rough ones, go straight into Issues. Use the `discussion` label when the idea is not scoped yet.
- Every issue ends with a priority hint:

  ```
  ## Priority hint

  **RANK: HIGH** - <one-line reason: foundation? daily friction? blocked? subsumed?>

  **Best after:** <prereq issues, or "no prereqs">
  **Overlap risk:** <files and areas touched, parallel-work warnings>
  ```

  HIGH: foundation that unblocks 3 or more issues, or a daily-friction fix. MEDIUM: clear value with a prereq. LOW: blocked, niche, subsumed or needs discussion.

## Working in parallel

When picking up more than one issue, run non-overlapping issues in parallel.

1. Pick candidate issues from the open issues.
2. Map each issue to the files it will touch. Start from `Overlap risk:`, then confirm in the code.
3. Batch at most 3 issues. No two issues in a batch may share a primary file.
4. Give each agent an explicit file allowlist and denylist.
5. Agents do not commit. The orchestrator runs `./check.sh`, reviews each diff, then commits one issue per commit with `#<n>`.

Needs serial work: anything changing `src/shared/viewData.ts` or `src/shared/messages.ts` (both sides read them), and two issues touching `src/webview/layout.ts`.

If unsure, run it serially.

## Always end with a manual verification checklist

Type checks and unit tests prove the code compiles and the logic holds. They do not prove the map looks right in VS Code.

- Numbered list, one concrete action and expected result per step.
- Use real entry points: press F5 to start the Extension Development Host on `test/sample-project`, open a named file, run "Wayfinder: Show map for this file".
- Compare against the matching canvas board in the plan's Task 15 table.
- Say which checks already passed (`./check.sh`) and which only the user can check (visuals, animation, theme).
- Five concrete checks beat fifteen vague ones.
- For code-only changes, say "Nothing to verify manually, code-only change."

## Development loop

1. Read the issue and the code it points at.
2. `git status --short --branch`.
3. Keep edits inside the issue.
4. Run the narrowest check first, then `./check.sh` (typecheck, unit tests, build).
5. Summarise what changed, what passed, and what still needs manual verification.

`./check.sh` and the npm scripts it calls (`typecheck`, `test`, `build`) only work after plan Task 1 (tooling and clean-up) has landed. Before that, the repo still has the MapMyCode build.

## Repo map

Planned layout (from the plan's file structure):

```
src/extension.ts       command wayfinder.showMap
src/shared/            types shared by the extension host and the webview
src/graph/             source analysis, import resolution, graph, pattern rules, view data
src/workspace/         workspace scan, tsconfig loading, git history
src/view/              webview panel host, editor gutter marks, call chain from VS Code call hierarchy
src/webview/           layout engine, panel model, HTML rendering, styles, webview entry
src/ai/                AI scan prompt, reply checks and AI status (pure)
src/providers/         AI providers: Ollama over HTTP, and the runner for the Claude Code and Codex CLIs
test/unit/             vitest unit tests, mirrors src/
test/sample-project/   small workspace for manual checks in the Extension Development Host
```

## Reference docs

- Plan: [`docs/superpowers/plans/2026-10-04-wayfinder-map.md`](docs/superpowers/plans/2026-10-04-wayfinder-map.md). Each task in it is one GitHub issue.
- Design reference: [`docs/design/wayfinder-mockup.dc.html`](docs/design/wayfinder-mockup.dc.html), a copy of the approved canvas engine. When the plan and the mockup disagree, the mockup wins, except for the deviations listed in the plan.
- Canvas boards: https://claude.ai/artifact/MUHcCKRXFR9PNH6rBNHAPB

## Workflow commands

Claude slash commands in `.claude/commands/`:

- `/dev-cycle [N]`: one supervised batch of up to N issues, from pick to PR.
- `/autopilot [4h|10pr]`: unattended batches, ends with a session report in `.wayfinder-autopilot-sessions/`.
- `/autopilot-review [Npr]`: walk the PRs from the last autopilot run, one at a time.
- `/bug-report [seed]`: turn a bug into a well-shaped issue.
- `/discovery [seed]`: turn a rough idea into one or more issues.

Other agents can follow the same files as plain specs.
