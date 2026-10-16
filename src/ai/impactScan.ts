import type { BranchView } from "../shared/viewData";
import { MAX_SOURCE_CHARS, type NeighbourSource, numberedLinesWithin } from "./scanFile";

export const IMPACT_SYSTEM_PROMPT = `You review the changes on a git branch for a developer, before a review or a push.
Reply with JSON only, in this form:
{"summary": "<two or three plain sentences: what the branch changes, which importing files use the changed code, and which of the tests to run matter most>", "findings": [{"file": "<a path from the diff or the sources you were given>", "line": <line number>, "text": "<one sentence: what a change could break here>"}]}
Work in this order:
1. From the diff, list what changed in each changed file: an export, function or method that was added, removed or renamed, a parameter or return type that changed, or behaviour that changed.
2. For each file that imports a changed file, look in its source for the places that use what changed. A finding points at that line in the importing file.
3. Point a finding at a changed line only when the change breaks its own file, for example a call to something that no longer exists.
Code that was only added breaks nothing, unless something else changed with it. If no importer uses what changed, return an empty findings list and say so in the summary.
You see only the diff and the importers. Code you were not given exists: never report a method, import or type as missing or not implemented because it is not shown.
The diff shows only the changed lines and a few lines around them, so do not judge the rest of a changed file.
Only name files and line numbers you were given.`;

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
