---
description: Capture a bug as a well-shaped GitHub issue for Wayfinder.
argument-hint: "[seed description]"
---

Capture a bug as a GitHub issue for Wayfinder. Ask about reproduction and impact, look at the code, then hand back a `gh issue create` command for the user to run.

User input (optional): `$ARGUMENTS`

**Do NOT run `gh issue create` yourself.** The user reviews and runs it.

## 1. Load context

Read in parallel:

- `AGENTS.md` (repo map)
- `git log --oneline -30` (recent changes are likely causes)
- Existing bugs, to find duplicates:
  ```
  gh issue list --state all --label bug --limit 100 --json number,title,state,body
  ```

## 2. Ask the reproduction questions

Restate what you understood in two lines (or "no seed given"). Then use `AskUserQuestion` in small batches to fill the gaps:

- **Where it shows:** map floors, wires, panel, editor gutter marks, first scan, second layer animation, theme.
- **Open file:** which file was open, and roughly how many files import it and it imports.
- **Steps:** exact sequence of actions.
- **Expected vs actual:** include any error from the Output panel or the webview developer tools ("Developer: Open Webview Developer Tools").
- **Frequency:** always, sometimes (with any pattern), once.
- **Environment:** VS Code version, theme (light or dark), workspace size, monorepo or not, `tsconfig.json` paths in use.
- **Workaround:** anything already tried.

Skip what `$ARGUMENTS` already answers.

## 3. Look at the suspected code

Read the code before drafting. Typical places:

- wrong or missing connections: `src/graph/analyzeSource.ts`, `src/graph/resolveImport.ts`, `src/graph/buildGraph.ts`
- wrong floor or node kind: `src/graph/neighbourhood.ts`, `src/graph/patterns.ts`
- positions, wires, toggles: `src/webview/layout.ts`
- looks wrong: `src/webview/render.ts`, `src/webview/styles.css`
- map not updating: `src/workspace/WorkspaceIndex.ts`, `src/view/WayfinderPanel.ts`

Check `git log -p <file>` for changes that match "first noticed". Say plainly what you found: "looks like X" or "no clear cause from a quick read, needs investigation".

## 4. Check for duplicates

If a similar issue exists, link it and ask whether to extend it or open a new one.

## 5. One issue per bug

Split only when there are two independent symptoms, or a symptom plus separate hardening work (the hardening is its own `enhancement` issue).

## 6. Draft the body

```markdown
## Symptom

<what the user sees, one paragraph>

## Steps to reproduce

1. <setup>
2. <action>
3. <observed result>

## Expected

<what should happen>

## Environment

- VS Code: <version>
- Theme: <light / dark>
- Open file: <path, rough connection counts>
- Frequency: <always / N of M / once>
- First noticed: <date or commit if known>

## Suspected area

<file paths and short reasoning, or "needs investigation, no clear cause from a quick read">

## Priority hint

**RANK: HIGH** - <one-line reason>

**Best after:** <prereq issues, or "no prereqs">
**Overlap risk:** <files the fix would likely touch>
```

Ranks for bugs:

- **HIGH:** the map shows wrong connections, the panel or map does not load, or the extension slows the editor.
- **MEDIUM:** a feature is degraded but a workaround exists, or a visible cosmetic issue.
- **LOW:** edge case, rare path, or not reproduced yet.

## 7. Hand back the command

```
gh issue create \
  --title "fix(scope): short symptom" \
  --label bug \
  --body "$(cat <<'EOF'
## Symptom
...
EOF
)"
```

Then a short summary:

- the bug in one line, with its RANK
- where you think it lives
- duplicates or related issues
- what you assumed because the user did not answer

## Hard rules

- **Do NOT run `gh issue create`.**
- **Title: `fix(scope): ...`,** lowercase, under 70 characters.
- **Always add the `bug` label.**
- **Never invent reproduction steps.** If it does not reproduce reliably, say so.
- **Never skip `## Priority hint`.**
- **No fix proposals in the body.** Symptom, reproduction and suspected area only.
