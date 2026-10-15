import type { AffectedFile, BranchView, ChangedFile, TestToRun } from "../shared/viewData";
import type { BranchDiff } from "../workspace/branchDiff";
import { dependentsOf, type Graph } from "./buildGraph";
import { isTestFile, testsOf } from "./patterns";

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

const byPath = <File extends { path: string }>(first: File, second: File) => first.path.localeCompare(second.path);

// tests are listed under Tests to run, so they get no card in the columns
function importersOf(graph: Graph, targets: string[], excluded: Set<string>): AffectedFile[] {
  const viaByImporter = new Map<string, string[]>();
  for (const target of targets) {
    for (const { from } of dependentsOf(graph, target)) {
      if (excluded.has(from) || isTestFile(from)) continue;
      viaByImporter.set(from, [...(viaByImporter.get(from) ?? []), target]);
    }
  }
  return [...viaByImporter].map(([path, via]) => ({ path, via })).sort(byPath);
}

function testsToRunFor(graph: Graph, changedPaths: string[]): TestToRun[] {
  const coveredByTest = new Map<string, string>();
  for (const path of changedPaths.filter((changed) => !isTestFile(changed))) {
    for (const test of testsOf(graph, path)) if (!coveredByTest.has(test)) coveredByTest.set(test, path);
  }
  for (const test of changedPaths.filter(isTestFile)) if (!coveredByTest.has(test)) coveredByTest.set(test, test);
  return [...coveredByTest].map(([test, covers]) => ({ test, covers })).sort((first, second) => first.test.localeCompare(second.test));
}

export function buildBranchView(graph: Graph, diff: BranchDiff): BranchView {
  if (diff.state === "notRepo") return { state: "none", reason: "This folder is not in a git repository, or the repository has no commits yet." };
  if (diff.state === "noBase") return { state: "none", reason: "No base branch found. Wayfinder compares with the branch origin/HEAD points to, then main, then master." };
  if (diff.state === "diffFailed") return { state: "none", reason: "Could not read the branch diff." };
  // deleted files are no longer in the graph, so only their extension says whether the map would cover them
  const isShown = (file: ChangedFile) => (file.change === "deleted" ? SOURCE_FILE.test(file.path) : graph.files.has(file.path));
  const untracked: ChangedFile[] = diff.untracked.map((path) => ({ path, change: "added", linesAdded: graph.files.get(path)?.lineCount ?? 0, linesRemoved: 0 }));
  const changed = [...diff.files, ...untracked].filter(isShown).sort(byPath);
  const otherFileCount = diff.files.length + untracked.length - changed.length;
  if (!changed.length) {
    const others = otherFileCount ? ` ${otherFileCount} other file${otherFileCount === 1 ? "" : "s"} changed.` : "";
    return { state: "none", reason: `No source file changed on ${diff.branch} since it left ${diff.base}.${others}` };
  }

  const presentPaths = changed.filter((file) => file.change !== "deleted").map((file) => file.path);
  const changedPaths = new Set(changed.map((file) => file.path));
  const importsChanged = importersOf(graph, presentPaths, changedPaths);
  const importerPaths = importsChanged.map((file) => file.path);
  const oneStepFurther = importersOf(graph, importerPaths, new Set([...changedPaths, ...importerPaths]));
  return {
    state: "changes",
    branch: diff.branch,
    base: diff.base,
    changed,
    importsChanged,
    oneStepFurther,
    untested: presentPaths.filter((path) => !isTestFile(path) && testsOf(graph, path).length === 0),
    testsToRun: testsToRunFor(graph, presentPaths),
    otherFileCount,
  };
}
