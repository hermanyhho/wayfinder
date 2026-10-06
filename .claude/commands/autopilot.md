---
description: Run the Wayfinder dev cycle unattended across a long session.
argument-hint: "[duration|Npr]"
---

Run the Wayfinder dev cycle unattended: batches run in a loop and the run ends with one report.

Optional argument, the stop condition:
- a duration: `4h`, `90m`, `2h30m`. The loop stops at the end of the current batch once the time is used up.
- a PR count: `10pr`. Stop after this many PRs.
- empty: stop when no issues are left or escalations make it unsafe to go on.

`$ARGUMENTS`

The user is away from the keyboard and wants to come back to a set of PRs to review plus a short report. Every batch costs tokens (see `/dev-cycle` "Cost awareness").

**Keep the session alive at the end.** Show the report and wait.

## 0. Record the session start, MANDATORY first step

Run this before anything else:

```bash
echo "SESSION_START_EPOCH=$(date +%s)"
echo "SESSION_START_ISO=$(date -Iseconds)"
echo "SESSION_ID=$(date +%Y-%m-%d-%H%M)"
mkdir -p .wayfinder-autopilot-sessions
ls -la .wayfinder-autopilot-sessions/ | head -1
```

Keep `SESSION_START_EPOCH`, `SESSION_START_ISO` and `SESSION_ID`. Sections 5, 7 and 8 use them. If a line fails, stop and report the error.

## 1. Pre-flight: refuse if work is outstanding

Run in parallel:

```bash
git status --porcelain
git branch --show-current
gh pr list --author "@me" --state open --json number,title,url,reviewDecision,isDraft,headRefName
gh pr list --state open --search "review-requested:@me" --json number,title,url --limit 20
```

**Refuse to start if any of these is true:**

- `git status --porcelain` is not empty.
- The current branch is not `main`.
- The user has open PRs that are not merged.
- The user is a requested reviewer on an open PR.

Then output this and **stop**:

```
🛑 Autopilot won't start. Wrap-up needed first.

Outstanding work I found:
- <one line per item: "PR #12 'feat(graph): ...' is open and needs your review at <url>">
- <"uncommitted changes in src/webview/layout.ts: commit or stash before autopilot">
- <"current branch is feat/issue-4-resolve-imports: merge or abandon before autopilot">

Review or merge these first, then run /autopilot again.
```

Do not offer to commit, push or clean up for the user.

## 2. Parse the stop condition

- Duration: compute `SESSION_BUDGET_SECONDS`. Stop at the end of the batch once `now - SESSION_START_EPOCH >= SESSION_BUDGET_SECONDS`.
- `Npr`: stop once this run has opened N PRs.
- Empty: no budget.

Hard caps, whatever the argument:

- **Max 8 batches per run.**
- **Max 2 batches in a row with an escalation.** Then stop.

Tell the user in one line what you parsed and which caps apply.

## 3. Load context once

Read once at the start, not every batch:

- `AGENTS.md`
- `docs/superpowers/plans/2026-10-04-wayfinder-map.md` (skim the task list and the design reference table)
- `git log --oneline -15`
- All open issues:
  ```bash
  gh issue list --state open --limit 100 --json number,title,labels,body
  ```

Parse each body for `RANK: HIGH|MEDIUM|LOW`, `Best after:` and `Overlap risk:`.

## 4. Plan the batch schedule

For each open issue:

1. **Prereqs:** if `Best after:` names an issue that is still open, mark it *blocked*.
2. **Primary files:** start from `Overlap risk:`, then confirm in the code.
3. **Rank:** HIGH, then MEDIUM, then LOW. Inside a rank, foundation issues first, because they unblock others.

Split the unblocked issues into **batches of up to 3** with no shared primary file. Files that force serial work are listed in `/dev-cycle` section 3.

Order batches by rank, then smallest change first inside a rank.

Write the schedule down (for the report):

```
Planned batches (up to 8):
1. #3 (HIGH), #4 (HIGH), #8 (LOW)   touches: src/graph/analyzeSource.ts, src/graph/resolveImport.ts, src/workspace/gitFacts.ts
2. ...

Blocked (waiting on prereqs): #7 (after #5, #6)
Not picked this run: #16 (LOW, discussion)
```

Do not wait for confirmation.

## 5. Run the loop, one batch at a time

For each batch:

1. **Check stop conditions first.** Do not start a batch you cannot finish.
2. **Run the batch with `/dev-cycle` sections 4 to 7** in `.claude/commands/dev-cycle.md`:
   - Section 4: one `Agent` call per issue in a single message, `subagent_type: "wayfinder-implementer"`, **`isolation: "worktree"`**, with allowlist and denylist. Record each worktree path and branch.
   - Section 5: fast path or full path per worktree, review chains in parallel.
   - Section 6: up to **2 retries** per issue, then escalate.
   - Section 7: commit, push and open the PR from inside each worktree, `Closes #<N>`, then `git worktree remove`.
3. **Record per issue:** PR URL and number, issue it closes, fast or full path, retries and why, escalation and why, primary files.
4. **Append one telemetry line, MANDATORY:**

   ```bash
   cat >> .wayfinder-autopilot-sessions/<SESSION_ID>.jsonl <<'EOF'
   {"batch": <n>, "issues": [<#>, ...], "duration_s": <int>, "implementer_tokens": [<int>, ...], "review_tokens": [<int>, ...], "retry_tokens": [<int>, ...], "escalations": <int>, "tool_calls_total": <int>}
   EOF
   ```

   - Use the real session id and values. One JSON object per batch on one physical line.
   - Take token counts and tool-call counts from the agent results as they return.
   - `review_tokens` must not be empty. An empty list means a reviewer was skipped, which breaks the `/dev-cycle` hard rule: flag it.
   - If a figure is unknown, write what you have and add `"incomplete": true`. Never skip the line.
   - Run `wc -l .wayfinder-autopilot-sessions/<SESSION_ID>.jsonl` and report the count.
5. **Pause about 30 seconds**, then the next batch. Not longer: the prompt cache lasts 5 minutes.

## 6. Stop conditions

Stop cleanly on any of:

- Time budget used up (after the current batch).
- PR cap reached (after the current batch).
- 8 batches done.
- 2 batches in a row with an escalation.
- No unblocked, non-overlapping issues left.
- A `gh` or `git` auth, rate-limit or network error that fails twice.

Never stop in the middle of a batch with an unreviewed diff. Abort only before a batch starts.

## 7. End-of-session report

```
✅ Autopilot run complete.

⏱  Ran for: 3h 42m  (started 2026-10-05 08:14, ended 2026-10-05 11:56)
📦 Batches completed: 4 of 6 planned
✅ PRs opened: 9

🔍 Review order (top first):

1. #PR-21 feat(graph): analyse imports, exports and usage lines
   Closes #3. Foundation: the graph tasks build on it.
   Touches: src/graph/analyzeSource.ts, test/unit/graph/analyzeSource.test.ts
   <PR url>

2. ...

⚠️  Needs your attention:
- Issue #9 escalated after 2 retries: <reviewer blocker>. Branch `feat/issue-9-...` is local only, not pushed.
- Issue #11 dropped this round: overlapped with #10 in src/webview/layout.ts.

🚫 Not picked this run:
- #16 (LOW, discussion)

When ready, /clear this session and run /autopilot-review. It reads .wayfinder-autopilot-sessions/<SESSION_ID>.md and walks the PRs one at a time.
```

Review order:
1. Foundations first (other PRs follow their patterns).
2. Then changes the user must check in the Extension Development Host (webview, layout, panel, editor marks).
3. Then small fast-path diffs.

Each entry has: PR number and title, the issue it closes, one sentence on why it sits there, primary files, PR URL.

## 8. Write the session report to disk, MANDATORY

Use the Write tool to save the section 7 report to `.wayfinder-autopilot-sessions/<SESSION_ID>.md` with these sections, in order:

- **Session metadata:** `SESSION_ID`, start, end, duration, batches completed.
- **Recommended review order:** per PR: number, title, `Closes #<N>`, branch, URL, reason for its position, primary files.
- **Escalations:** reviewer feedback that blocked them and the local branch name.
- **Dropped / not picked:** overlap, blocked, skipped.
- **Cross-PR notes:** real cross-PR concerns only, for example "#21 and #22 both extend `src/shared/viewData.ts`: merge #21 first."

Omit a section with no content. Then check:

```bash
ls -la .wayfinder-autopilot-sessions/<SESSION_ID>.md
wc -l .wayfinder-autopilot-sessions/<SESSION_ID>.md
```

If the file is missing or empty, write it again.

## 9. Final message, then wait

```
✅ Autopilot run complete. <N PRs opened, M escalations, K dropped>

Session report saved to .wayfinder-autopilot-sessions/<SESSION_ID>.md

When ready to verify and merge, /clear this session, then run:
    /autopilot-review
```

Then stop and wait. No further tool calls, no summary, no goodbye.

## Hard rules

- **The pre-flight check is not negotiable.**
- **One commit per issue. `Closes #<N>` in the PR body.**
- **Never force-push, never push to main, never amend a pushed commit, never `--no-verify`.**
- **Never `git add -A` or `git add .`.** List files.
- **Max 2 retries per issue, max 2 escalating batches in a row, max 8 batches per run.**
- **Do not delete branches**, including escalated ones.
- **Load AGENTS.md and the plan once.**
- **Pause about 30 seconds between batches.**
- **Do not end the session.** Wait for the user.
