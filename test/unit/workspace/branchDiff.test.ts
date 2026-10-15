import { describe, expect, it } from "vitest";
import { parseDiff } from "../../../src/workspace/branchDiff";

const rawLine = (status: string, path: string) => `:100644 100644 a244c54 f7755e3 ${status}\t${path}`;

describe("when reading git diff --raw --numstat output", () => {
  it("should give each file its line counts and its change", () => {
    const stdout = [
      rawLine("M", "src/services/DocumentService.ts"),
      rawLine("A", "src/services/AuditService.ts"),
      rawLine("D", "src/jobs/OldJob.ts"),
      "12\t3\tsrc/services/DocumentService.ts",
      "40\t0\tsrc/services/AuditService.ts",
      "0\t25\tsrc/jobs/OldJob.ts",
      "",
    ].join("\n");

    expect(parseDiff(stdout)).toEqual([
      { path: "src/services/DocumentService.ts", change: "modified", linesAdded: 12, linesRemoved: 3 },
      { path: "src/services/AuditService.ts", change: "added", linesAdded: 40, linesRemoved: 0 },
      { path: "src/jobs/OldJob.ts", change: "deleted", linesAdded: 0, linesRemoved: 25 },
    ]);
  });

  it("should count no lines for a binary file", () => {
    const stdout = `${rawLine("M", "media/icon.png")}\n-\t-\tmedia/icon.png\n`;

    expect(parseDiff(stdout)).toEqual([{ path: "media/icon.png", change: "modified", linesAdded: 0, linesRemoved: 0 }]);
  });

  it("should return no files when git printed nothing", () => {
    expect(parseDiff("")).toEqual([]);
  });
});
