# Wayfinder: Claude adapter

**Read [AGENTS.md](AGENTS.md) first.** It is the provider-neutral guide: ground rules, task tracking, parallel work, verification checklist, repo map and reference docs. When you change a shared rule, edit AGENTS.md, not this file.

This file exists because Claude Code loads `CLAUDE.md` automatically.

## Claude-specific surface

- **Slash commands:** `.claude/commands/` holds `dev-cycle`, `autopilot`, `autopilot-review`, `bug-report` and `discovery`.
- **Agents:** `.claude/agents/wayfinder-implementer.md` (implements one issue, no commits) and `.claude/agents/wayfinder-qa.md` (runs checks, adds missing unit tests).
- **Worktree isolation:** `dev-cycle` runs each parallel implementer in its own git worktree (`isolation: "worktree"`), so agents in one batch cannot overwrite each other's files.
- **Reviewer:** `dev-cycle` uses the `code-reviewer` agent with the unified review prompt in `.claude/commands/dev-cycle.md`.
