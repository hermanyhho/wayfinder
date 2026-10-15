import { execFile } from "node:child_process";
import type { FileChange } from "../shared/viewData";

const GIT_TIMEOUT_MS = 5000;
const GIT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const CHANGE_BY_STATUS: Record<string, FileChange> = { A: "added", D: "deleted" };

export interface DiffEntry {
  /** relative to the folder git ran in */
  path: string;
  change: FileChange;
  linesAdded: number;
  linesRemoved: number;
}

export type BranchDiff =
  | { state: "notRepo" }
  | { state: "noBase" }
  | { state: "diffFailed" }
  | { state: "diff"; branch: string; base: string; files: DiffEntry[]; untracked: string[] };

// numstat lines carry no change status, so the change comes from the matching raw line
export function parseDiff(stdout: string): DiffEntry[] {
  const changeByPath = new Map<string, FileChange>();
  const counts: { path: string; linesAdded: number; linesRemoved: number }[] = [];
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    if (line.startsWith(":")) {
      changeByPath.set(line.slice(tab + 1), CHANGE_BY_STATUS[line[tab - 1]] ?? "modified");
      continue;
    }
    const [added, removed, path] = line.split("\t");
    // git prints "-" instead of line counts for a binary file
    counts.push({ path, linesAdded: Number(added) || 0, linesRemoved: Number(removed) || 0 });
  }
  return counts.map((count) => ({ ...count, change: changeByPath.get(count.path) ?? "modified" }));
}

function runGit(root: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["-c", "core.quotePath=false", ...args], { cwd: root, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_OUTPUT_BYTES }, (error, stdout) => {
      resolve(error ? null : stdout);
    });
  });
}

async function baseBranchOf(root: string): Promise<string | undefined> {
  const originHead = (await runGit(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]))?.trim();
  if (originHead) return originHead;
  for (const name of ["main", "master"]) {
    if ((await runGit(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`])) !== null) return name;
  }
  return undefined;
}

/** files changed since HEAD left the base branch, committed or not, relative to root */
export async function branchDiff(root: string): Promise<BranchDiff> {
  const branch = (await runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]))?.trim();
  if (!branch) return { state: "notRepo" };
  const base = await baseBranchOf(root);
  const mergeBase = base && (await runGit(root, ["merge-base", "HEAD", base]))?.trim();
  if (!base || !mergeBase) return { state: "noBase" };
  const [diff, untracked] = await Promise.all([
    runGit(root, ["diff", "--raw", "--numstat", "--no-renames", "--relative", mergeBase]),
    runGit(root, ["ls-files", "--others", "--exclude-standard"]),
  ]);
  if (diff === null || untracked === null) return { state: "diffFailed" };
  return { state: "diff", branch, base, files: parseDiff(diff), untracked: untracked.split("\n").filter(Boolean) };
}
