---
description: Walk through PRs from the most recent autopilot session for verification and merge.
argument-hint: "[Npr]"
---

Walk through the PRs from the latest `/autopilot` run, one at a time, so the user can check and merge them. Starts with a clean context.

Optional argument:
- `Npr` (for example `3pr`): walk at most N PRs, then recommend a fresh session for the rest.
- empty: walk every PR in the session report.

`$ARGUMENTS`

You switch branches. The user checks each change in the Extension Development Host and gives a verdict.

**Clean start.** This command runs after `/clear`. The session report and the PR descriptions are the handoff. Do not re-read `AGENTS.md`, do not explore.

## 0. Find the session, MANDATORY

```bash
echo "REVIEW_SESSION_ID=$(date +%Y-%m-%d-%H%M)-review"
mkdir -p .wayfinder-autopilot-sessions
ls -t .wayfinder-autopilot-sessions/*.md 2>/dev/null | head -1
```

Keep `REVIEW_SESSION_ID` for the telemetry in section 3 step 6.

If a session report exists, read it: review order, escalations, dropped issues, cross-PR notes.

If none exists, fall back to:

```bash
gh pr list --author "@me" --state open --json number,title,url,headRefName --limit 20
```

Say which one you found: "Session 2026-10-05-0814: 5 PRs in recommended order" or "No session report found, using your N open PRs."

## 0.5. Clean merged `worktree-agent-*` branches on origin

Worktree isolation leaves a `worktree-agent-<hex>` branch on origin. Squash-merging the user-facing PR does not delete it.

```bash
git fetch origin --prune
git for-each-ref --format='%(refname:short)' refs/remotes/origin/ | grep '^origin/worktree-agent-' || true
```

For each candidate, strip `origin/` and delete it only if a merged PR exists for that head branch:

```bash
if [ -n "$(gh pr list --state merged --head worktree-agent-<hex> --json number --jq '.[].number')" ]; then
  git push origin --delete worktree-agent-<hex>
fi
```

- Only touch `worktree-agent-*` branches on origin.
- A merged PR is the only safe signal. Squash merges mean the branch tip is never an ancestor of `main`, so ancestry checks do not work.
- Never `--force`.
- If the sweep errors, print one warning line and carry on.
- If there are far more candidates than expected, stop and report instead of deleting.

Print one summary line, for example: `Pre-walk sweep: deleted 3 merged worktree-agent-* branches on origin; kept 1 with no merged PR: a1b2c3d.`

## 1. Pre-flight

```bash
git status --porcelain
git branch --show-current
git pull --ff-only origin main
```

If the tree is dirty or you are not on `main`, stop and tell the user.

Tell the user:
- "Nothing is merged yet. I'll check out one branch at a time."
- "For each PR: run `npm run build`, then press F5 (Run Extension). It opens test/sample-project. Reload the Extension Development Host window after each branch switch."
- The walk order. Confirm it before starting.

## 2. Parse the PR cap

- `Npr`: stop after N verdicts. A verdict is merged, left open, or skipped. Fix-up rounds do not count until they end in one of those.
- empty: no cap.

Say what you parsed in one line.

## 3. Walk PRs in order

For each PR:

1. **Switch:** `git switch <branch-name>`. Say: "Ready for PR #N, <title>. You're on `<branch>`."
2. **Load context:** `gh pr view <N> --json body,title`. Read `## Summary`, `## Surface area`, `## Considered & skipped` (do not re-argue these), `## Worth eyeballing` (highest-value checks), `## Test plan`.
3. **Give the 4 to 6 most important checks**, not the whole list:
   - The main behaviour the PR is named after.
   - Items from `## Worth eyeballing`.
   - Regression tests the reviewers asked for.
   - Edge cases: unused file, file with many callers, circular import, test file, first scan, light theme.
   - For webview or layout changes: name the canvas board from the plan's Task 15 table to compare with.
   - Skip what `./check.sh` already covers.
   - Say if `npm run build` must run again (any change under `src/`).
4. **Wait for the verdict:**
   - **"good, merge":** `gh pr merge <N> --squash --delete-branch`, then `git switch main`, `git pull --ff-only origin main`, next PR. If the merge fails, report and ask. Never force.
   - **"good, don't merge yet" / "next":** leave it open, `git switch main`, next PR.
   - **"broken: <what failed>":** do not merge. TARGETED MODE fix-up (as in `/dev-cycle` section 6):
     1. Read the failing code path and confirm the report. Read at most 2 files beyond it.
     2. Dispatch `wayfinder-implementer` with the user's report as the only blocker, the exact file paths, and: "edit only the listed files to address the blocker. Do NOT re-read AGENTS.md, CLAUDE.md or unrelated files. Do NOT explore. If a blocker requires reading a referenced file, read at most that one file. Report back with the diff and a one-line note." No scope creep, no refactoring, no extra tests.
     3. When `./check.sh` is green, commit the listed files and `git push origin <branch>` so the PR updates. Never close and reopen the PR.
     4. Re-run the failing check.
     5. Max 2 fix-ups per PR, then leave it for the user.
   - **"+ PR#X":** load PR X's diff and description next to the current one to compare. Do not switch branches.
   - **"skip / show me later":** stay on the branch and wait.
5. **Merge conflicts on later PRs:** fetch `main`, switch to the PR branch, merge `main` in (merge commit, no force-push), resolve, run `./check.sh`, push, merge again. If the conflict is in logic rather than in lists or imports, ask the user first.
6. **Append telemetry, MANDATORY:**

   ```bash
   cat >> .wayfinder-autopilot-sessions/<REVIEW_SESSION_ID>.jsonl <<'EOF'
   {"pr": <N>, "verdict": "<merged|open|skipped|escalated>", "fix_ups": <count>, "fix_up_tokens": [<int>, ...], "fix_up_tool_uses": [<int>, ...], "conflict_regions": <int>, "merge_sha": "<sha or null>", "duration_s": <int>}
   EOF
   ```

   One line per PR. Unknown figures: write what you have and add `"incomplete": true`.
7. **Cap check:** if the PR cap is reached, stop the walk (section 4). Stay on `main`.

## 4. When the walk ends

It ends when every PR is merged or left open, when the user says "stop" or "done", or when the PR cap is reached. If the user goes quiet, wait.

1. Switch to `main` and confirm a clean tree.
2. **Clean-up check, MANDATORY:**
   ```bash
   git fetch origin --prune
   git stash list
   ```
   Report any leftover stash or local branch from this session in one line each. Never touch branches, stashes or files that existed before this session.
3. Say what landed and what is still open, for example: "Merged: #21, #23. Open: #22 (retest tomorrow)."
4. If the cap stopped the walk:
   ```
   📍 Reviewed <PR_CAP> of <total> PRs this session. Remaining (in order): #<n1>, #<n2>, ...

   For the rest, /clear this session and run /autopilot-review again. The session report keeps the order.
   ```
5. Wait. No further summary.

## Hard rules

- **Clean start.** Read `AGENTS.md` only if a fix-up needs a convention from it.
- **One PR at a time.**
- **Never force-push, never push to `main`, never amend a pushed commit, never `--no-verify`.**
- **Fix-ups use TARGETED MODE, max 2 per PR.**
- **Do not delete branches** for skipped or escalated PRs. The only exception is the section 0.5 sweep.
- **Never `git add -A` or `git add .`.** List files.
