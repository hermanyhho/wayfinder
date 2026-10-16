import type { BranchView } from "../shared/viewData";
import { MAX_SOURCE_CHARS, type NeighbourSource, numberedLinesWithin } from "./scanFile";

export const IMPACT_SYSTEM_PROMPT = `You review the changes on a git branch for a developer, before a review or a push.
Reply with JSON only, in this form:
{"summary": "<two or three plain sentences: what the branch changes, what it could break, and which of the tests to run matter most>", "findings": [{"file": "<a path from the diff or the sources you were given>", "line": <line number>, "text": "<one sentence: what a change could break here>"}]}
Point a finding at the line in a file that imports a changed file where it uses the changed code, or at the changed line itself.
Only name files and line numbers you were given. Return an empty findings list when nothing could break.`;

export type ImpactSources = { diff: string; newFiles: NeighbourSource[]; dependents: NeighbourSource[] };

type BranchChanges = Extract<BranchView, { state: "changes" }>;
type DiffLine = { text: string; file?: string; line?: number };

const HUNK_START = /^@@ -\d+(?:,\d+)? \+(\d+)/;

// the model cannot count lines from hunk headers, so every line of the new version gets its line number
function numberedDiffLines(diff: string): DiffLine[] {
  let file: string | undefined;
  let nextLine = 0;
  return diff.split(/\r?\n/).map((text) => {
    if (text.startsWith("diff --git ")) {
      file = undefined;
      nextLine = 0;
    } else if (!nextLine && text.startsWith("--- a/")) file = text.slice(6);
    else if (!nextLine && text.startsWith("+++ b/")) file = text.slice(6);
    const hunk = HUNK_START.exec(text);
    if (hunk) nextLine = Number(hunk[1]);
    else if (nextLine && (text.startsWith("+") || text.startsWith(" "))) return { text: `${nextLine}| ${text}`, file, line: nextLine++ };
    return { text, file };
  });
}

const listed = (items: string[]) => (items.length ? items.map((item) => `- ${item}`) : ["- none"]);

export function buildImpactPrompt(branch: BranchChanges, sources: ImpactSources): { prompt: string; lineCountByFile: Map<string, number>; cutFiles: string[] } {
  const lineCountByFile = new Map<string, number>();
  const cutFiles = new Set<string>();
  const diffLines = sources.diff.trim() ? numberedDiffLines(sources.diff.trimEnd()) : [];
  let remainingChars = MAX_SOURCE_CHARS;
  let shownDiffCount = 0;
  while (shownDiffCount < diffLines.length && diffLines[shownDiffCount].text.length < remainingChars) {
    const { text, file, line } = diffLines[shownDiffCount];
    remainingChars -= text.length + 1;
    if (file && line) lineCountByFile.set(file, Math.max(line, lineCountByFile.get(file) ?? 0));
    shownDiffCount++;
  }
  const cutDiffLines = diffLines.slice(shownDiffCount);
  for (const { file } of cutDiffLines) if (file) cutFiles.add(file);
  if (cutDiffLines.length) remainingChars = 0;

  const sourceBlocks: string[] = [];
  const labelled = [...sources.newFiles.map((source) => ({ label: "New file", ...source })), ...sources.dependents.map((source) => ({ label: "Source of", ...source }))];
  for (const { label, file, source } of labelled) {
    const header = `${label} ${file}, with line numbers:`;
    const lines = numberedLinesWithin(source, remainingChars - header.length);
    if (lines.shownCount < lines.totalCount) {
      cutFiles.add(file);
      remainingChars = 0;
    }
    if (!lines.shownCount) continue;
    sourceBlocks.push(header, lines.text);
    lineCountByFile.set(file, lines.shownCount);
    remainingChars -= header.length + lines.text.length + 2;
  }

  const prompt = [
    `Branch ${branch.branch}, compared with ${branch.base}.`,
    "Changed files:",
    ...listed(branch.changed.map((file) => `${file.path} (${file.change}, +${file.linesAdded} -${file.linesRemoved})`)),
    "Files that import a changed file:",
    ...listed(branch.importsChanged.map((file) => `${file.path} (imports ${file.via.join(", ")})`)),
    "Files one step further, names only:",
    ...listed(branch.oneStepFurther.map((file) => file.path)),
    "Tests to run, names only:",
    ...listed(branch.testsToRun.map((test) => `${test.test} (${test.covers === test.test ? "changed on this branch" : `covers ${test.covers}`})`)),
    cutFiles.size ? `Cut or left out to fit: ${[...cutFiles].join(", ")}.` : "",
    shownDiffCount ? "Diff of the changed files. Each line of the new version starts with its line number:" : "",
    diffLines
      .slice(0, shownDiffCount)
      .map((diffLine) => diffLine.text)
      .join("\n"),
    ...sourceBlocks,
  ]
    .filter(Boolean)
    .join("\n");
  return { prompt, lineCountByFile, cutFiles: [...cutFiles] };
}
