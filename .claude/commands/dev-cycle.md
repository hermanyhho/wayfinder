---
description: Run one batch of the Wayfinder dev cycle.
argument-hint: "[batch-size]"
---

Run one batch of the Wayfinder dev cycle. Optional argument: batch size N (default 3).

`$ARGUMENTS`

You are orchestrating the dev cycle. Rules for the repo are in `AGENTS.md`.

## Cost awareness

Each issue runs through up to 4 agents: implementer, then QA, simplifier and reviewer.

- **Full path** (most issues): about 120-180K tokens, about 250-350K with 2 retries.
- **Fast path** (tiny or docs-only diff): about 50-80K tokens. Skips the simplifier, see 5a.
- **Batch of 3:** 3 implementers start at once. That is the only point where requests per minute spike.
- **Retries are targeted** (section 6): no re-reading AGENTS.md, no exploring.
- **Prompt cache lasts 5 minutes.** Back-to-back batches inside 5 minutes are cheaper.

## 1. Pick the candidate pool

```
gh issue list --state open --limit 30 --json number,title,labels,body
```

Show a numbered list: issue number, title, RANK (from `RANK: HIGH|MEDIUM|LOW` in the body), labels.

If `$ARGUMENTS` is a number, use it as batch size N. Otherwise N=3.

Default selection: top N `RANK: HIGH` issues whose `Best after:` prereqs are closed. Fill with MEDIUM if fewer than N. Show the proposed batch and **wait for confirmation** before dispatching anything.

## 2. Map file footprints

For each picked issue, list the **primary** files it will touch (for example `src/graph/neighbourhood.ts`, `src/webview/layout.ts`). Start from `Overlap risk:`, then confirm by reading the code. Issue bodies can be out of date.

## 3. Reject overlapping batches

If two issues share a primary file, **drop the lower-RANK one** and say:

> "Issue #X and #Y both touch `path/to/file.ts`. Running both in parallel risks one overwriting the other. Dropping #Y from this batch, run it next round."

Files that force serial work: `src/shared/viewData.ts`, `src/shared/messages.ts`, `src/webview/layout.ts`, `package.json`.

## 4. Dispatch implementers in parallel

One message with one `Agent` call per issue: `subagent_type: "wayfinder-implementer"`, **`isolation: "worktree"`**. Each implementer gets its own git worktree and branch.

Each prompt MUST include:

- Issue number and full body (title, description, acceptance criteria)
- The matching task text from `docs/superpowers/plans/2026-10-04-wayfinder-map.md` when the issue points at a plan task
- **File allowlist:** what this agent may touch
- **File denylist:** files the other agents in this batch are touching
- Reminder: do NOT commit, push or open a PR. Leave changes uncommitted in the worktree.

When each call returns, **record the worktree path and branch name** from the result, keyed by issue number. Every later step runs against that worktree. If an agent made no changes, its worktree is removed automatically: treat that as an escalation (section 6).

Wait for all agents to return before moving on.

## 5. Fast path or full path

For each result, inspect the diff inside its worktree:

```
git -C <worktree-path> diff --stat HEAD
git -C <worktree-path> diff --name-only HEAD
```

Review chains for different worktrees run in parallel.

**Fast path** only if one of these is true:
- Fewer than 50 changed lines (additions plus deletions), OR
- **Every** changed file is `*.md`, `README.md` or under `docs/**`

Everything else is full path. These are **not** reasons to fast-path:
- "The diff is mechanical and the tests cover it"
- "`./check.sh` passed"
- "The implementer reported it is confident"
- A large diff of "obvious" lines (refactors, moves)

If unsure, use the full path.

**Hard rule:** on both paths the unified reviewer (5a step 2, 5b step 3) MUST run and its verdict must be followed.

## 5a. Fast path

1. Run `(cd <worktree-path> && ./check.sh --keep-going)`. On failure go to section 6.
2. **Dispatch the unified reviewer, MANDATORY:**
   ```
   Agent({
     subagent_type: "code-reviewer",
     prompt: "WORKING_DIRECTORY: <worktree-path>\n\n" + <UNIFIED_REVIEWER_PROMPT> + diff + issue context
   })
   ```
3. Reviewer CLEAN and check.sh green: section 7. Any BLOCKERS or check.sh red: section 6.

### UNIFIED_REVIEWER_PROMPT

```
SCOPE: Review ONLY the provided diff. You may read at most 2 files
beyond the diff IF needed to understand a specific concern. Do not
search beyond that. Do not re-read AGENTS.md or CLAUDE.md.

REVIEW FOUR LENSES:

1. CODE QUALITY: readability, descriptive naming, no premature
   abstraction, matches the patterns already in the file.

2. COMMENTS: flag comments that describe what code does, comments
   that no longer match the code, and inaccurate comments. Project
   rule: only a non-obvious why, plain language.

3. SILENT FAILURES: errors swallowed without surfacing, fallbacks
   that hide failures, missing error handling at the VS Code API or
   file-system boundary.

4. DESIGN MATCH (webview or layout changes only): sizes, colours,
   floor names and behaviour match docs/design/wayfinder-mockup.dc.html
   and the plan, except for the deviations the plan lists.

REPORT under 500 words. Format:
  BLOCKERS: must fix, with file:line, grouped by lens
  NITS: optional polish
  CLEAN: explicit "no concerns" when applicable
No preamble.
```

## 5b. Full path: QA, simplify, review, decide

Inside one worktree the steps run in order. Across worktrees the chains run in parallel. Every dispatch starts its prompt with `WORKING_DIRECTORY: <worktree-path>`.

1. **QA:** `Agent({ subagent_type: "wayfinder-qa", prompt: "WORKING_DIRECTORY: <worktree-path>\n\n<issue summary + diff summary>" })`. Failing `./check.sh` or critical coverage gaps count as a fail.
2. **Simplify:** `Agent({ subagent_type: "code-simplifier", prompt: "WORKING_DIRECTORY: <worktree-path>\n\n<diff + issue context>. cd into WORKING_DIRECTORY first. Simplify the recently modified code for clarity while keeping all behaviour. No comments that describe what code does. Do NOT touch files outside <allowlist>." })`. Then run `(cd <worktree-path> && ./check.sh --keep-going)`. A red check.sh here is a fail.
3. **Dispatch the unified reviewer, MANDATORY:** same call as 5a step 2.
4. **Decision:** reviewer CLEAN, QA green and check.sh green: section 7. Anything else: section 6.

## 6. Re-dispatch on failures: TARGETED MODE

Re-dispatch `wayfinder-implementer` with:

- **Blockers as bullets** taken from the reviewer report, one per actionable item, with file and line.
- **Exact file paths to edit**, taken from the existing diff, not the original allowlist.
- **Same denylist as before.**
- **Instruction (verbatim):** "edit only the listed files to address each bullet. Do NOT re-read AGENTS.md, CLAUDE.md or unrelated files. Do NOT explore the codebase. If a blocker requires reading a referenced file to understand it, read at most that one file. Do NOT commit. Report back with the diff and a one-line note per blocker addressed."
- **Forbid:** scope creep, refactoring code the blockers did not mention, new tests beyond what a blocker asks for.

Re-classify the new diff (section 5) and re-run the matching chain.

**Max 2 retries per issue.** After the second failure, stop on that issue and report the current state, the reviewer comments and what the implementer tried.

## 7. Commit and open the PR

From inside the implementer's worktree:

```
cd <worktree-path>
git branch -m feat/issue-<N>-<short-slug>          # only if the branch name differs
git add <specific files, never -A or .>
git commit -m "$(cat <<'EOF'
<conventional commit subject referencing #<N>>

<one paragraph explaining why>

Closes #<N>

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
git push -u origin feat/issue-<N>-<short-slug>
gh pr create --title "<title under 70 chars>" --body "$(cat <<'EOF'
## Summary
- <what changed and why>

## Surface area
- <one line, e.g. "2 graph modules, 1 type file, 9 new tests">

## Considered & skipped
- <thing>: <one-line reason>

## Worth eyeballing
- <judgement call>: <what I chose, why, where to change it>

## Test plan
- [ ] <items from the implementer's manual verification checklist>

Closes #<N>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR body rules:

- `## Surface area` is mandatory. `/autopilot-review` uses it to size the diff.
- Omit `## Considered & skipped` and `## Worth eyeballing` (heading included) when there is nothing real to put there.

After the PR opens, remove the local worktree (the branch stays on the remote):

```
git worktree remove <worktree-path>
```

If it complains about uncommitted state, investigate. Never `--force` a worktree removal.

## 8. Final summary

- **PRs opened:** list with URLs
- **Iterated more than once:** issue number and reviewer reasons
- **Escalated:** issue number and why
- **Dropped for overlap:** issue number and the shared file

## Hard rules

- **One commit per issue.**
- **Never force-push, never push to main, never amend a pushed commit.**
- **Never skip hooks** (`--no-verify`, `--no-gpg-sign`).
- **Never `git add -A` or `git add .`.** List files.
- **Stop on git problems** (uncommitted user changes, unexpected files, detached HEAD) and ask.
- **Max 2 retries per issue,** then escalate.
- **Always dispatch implementers with `isolation: "worktree"`.**
