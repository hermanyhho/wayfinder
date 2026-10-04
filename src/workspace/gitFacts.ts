import { execFile } from "node:child_process";
import type { Fact } from "../shared/viewData";

export function parseGitLog(stdout: string): Fact[] {
  return stdout
    .split("\n")
    .filter((line) => line.includes("\t"))
    .map((line) => {
      const [when, subject] = line.split("\t");
      return { label: when, value: subject };
    });
}

export function gitHistory(root: string, relativePath: string): Promise<Fact[]> {
  return new Promise((resolve) => {
    execFile("git", ["log", "-n", "3", "--follow", "--format=%cr%x09%s", "--", relativePath], { cwd: root, timeout: 3000 }, (error, stdout) => {
      resolve(error ? [] : parseGitLog(stdout));
    });
  });
}
