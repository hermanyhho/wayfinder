---
description: Turn a rough idea into one or more well-shaped GitHub issues for Wayfinder.
argument-hint: "[seed idea]"
---

Turn a rough idea into GitHub issues for Wayfinder. Ask questions first, draft the issues, ask Y/N, then create them on approval.

User input (optional): `$ARGUMENTS`

**Never run `gh issue create` before the user approves the drafts.**

## 1. Load context

Read in parallel:

- `AGENTS.md`
- the plan `docs/superpowers/plans/2026-10-04-wayfinder-map.md` (scope of plan 1, deviations, plan 2 follow-up)
- open issues:
  ```
  gh issue list --state open --limit 100 --json number,title,labels,body
  ```
- closed issues, in case it already shipped or was rejected:
  ```
  gh issue list --state closed --limit 50 --json number,title,labels
  ```

Use this to ground your questions, not to repeat it back.

## 2. Ask questions

Restate the idea in 2 or 3 lines, then use `AskUserQuestion` with 1 to 3 questions at a time:

- **Where it lives:** map, panel, editor gutter, command palette, settings.
- **Input:** what the user does to use it, and what must already exist (open file, finished scan).
- **Output:** what success looks like.
- **Value:** daily-use improvement, occasional extra, or a foundation for other issues.
- **Overlap:** does an existing floor, panel section or command already partly do this?
- **AI or not:** can it come from the code alone, or does it need a model (plan 2)? Prefer the code-only version first.

Keep asking until every field in section 5 can be filled.

## 3. Check against the plan

Say so plainly if the idea:

- needs AI but is meant for plan 1 (code only),
- changes something the approved design fixed (`docs/design/wayfinder-mockup.dc.html`) without the user asking for a design change,
- duplicates an open issue (link it, ask whether to extend it).

## 4. Split into issues

- One issue per concern.
- Split when ranks differ or when the files do not overlap (so `/dev-cycle` can run them in parallel).
- Do not split work that ships as one PR.
- Order by prereqs, then rank.

Find the real file paths with `Grep`/`Glob`. They drive `Overlap risk`.

## 5. Draft each issue

```markdown
## Why

<the user-facing problem or opportunity, one paragraph>

## What

- <concrete change>

## Acceptance criteria

- [ ] <testable result>

## Priority hint

**RANK: HIGH** - <one-line reason>

**Best after:** <prereq issues, or "no prereqs">
**Overlap risk:** <file paths likely touched, parallel-work warnings>
```

Ranks: **HIGH** unblocks 3 or more issues or fixes daily friction. **MEDIUM** clear value with a prereq. **LOW** blocked, niche, subsumed or needs discussion.

Acceptance criteria must be testable: "opening formatDate.ts shows 4 caller nodes and a 'Show 2 more' footer button" is good, "add a toggle" is not.

## 6. Labels

Run `gh label list` and pick at most 2 or 3 that apply (for example `enhancement`, `discussion`, `plan-2`).

## 7. Show the drafts

One command per issue, in dependency order:

```
### Issue 1 of 2: RANK HIGH: feat(graph): ...

gh issue create \
  --title "feat(graph): ..." \
  --label enhancement \
  --body "$(cat <<'EOF'
## Why
...
EOF
)"
```

Then: issue count and ranks, suggested order, duplicates or rejections, and anything you assumed.

## 8. Ask, then create

End with: **`Create these issues now? [Y/n]`** and wait.

- `Y`, `yes` or empty: run the commands exactly as shown. Report each URL with title and rank.
- `N`: ask what to change, revise, show again, ask again.
- Anything else: treat it as a change request, not approval.

If one creation fails, stop and report which one and the error.

## Hard rules

- **No `gh issue create` before approval.**
- **One issue per concern.**
- **Never skip `## Priority hint`.**
- **Heredocs for bodies.**
- **Titles in Conventional Commits style,** lowercase, under 70 characters.
- **Small idea, small issue.** No padding.
