import { describe, expect, it } from "vitest";
import { setFile } from "../../../src/graph/buildGraph";
import { buildBranchView } from "../../../src/graph/branchChanges";
import type { BranchDiff, DiffEntry } from "../../../src/workspace/branchDiff";
import { DOCUMENT_SERVICE, analysisOf, directResolver, serviceGraph } from "../helpers/fixtures";

const INT_TEST = "src/services/__tests__/DocumentService.int.test.ts";

function graphWithIntegrationTest() {
  const graph = serviceGraph();
  setFile(graph, analysisOf(INT_TEST, [DOCUMENT_SERVICE]), directResolver);
  setFile(graph, analysisOf("src/services/AuditService.ts", [], { lineCount: 42 }), directResolver);
  return graph;
}

const modified = (path: string, linesAdded = 5, linesRemoved = 2): DiffEntry => ({ path, change: "modified", linesAdded, linesRemoved });
const diffOf = (files: DiffEntry[], untracked: string[] = []): BranchDiff => ({ state: "diff", branch: "feature/reminders", base: "origin/main", mergeBase: "abc123", files, untracked });

function changesFor(diff: BranchDiff) {
  const view = buildBranchView(graphWithIntegrationTest(), diff);
  if (view.state !== "changes") throw new Error(`expected changes, got: ${view.reason}`);
  return view;
}

describe("when a branch changes a service that other files import", () => {
  it("should list the changed file with its line counts", () => {
    const { changed } = changesFor(diffOf([modified(DOCUMENT_SERVICE, 12, 3)]));

    expect(changed).toEqual([{ path: DOCUMENT_SERVICE, change: "modified", linesAdded: 12, linesRemoved: 3 }]);
  });

  it("should list the files that import it, each via the changed file, without its tests", () => {
    const { importsChanged } = changesFor(diffOf([modified(DOCUMENT_SERVICE)]));

    expect(importsChanged).toEqual([
      { path: "src/api/controllers/DocumentController.ts", via: [DOCUMENT_SERVICE] },
      { path: "src/jobs/SendReminderJob.ts", via: [DOCUMENT_SERVICE] },
    ]);
  });

  it("should list the files one step further, each via the importer", () => {
    const { oneStepFurther } = changesFor(diffOf([modified(DOCUMENT_SERVICE)]));

    expect(oneStepFurther).toEqual([
      { path: "src/api/routes.ts", via: ["src/api/controllers/DocumentController.ts"] },
      { path: "src/jobs/scheduler.ts", via: ["src/jobs/SendReminderJob.ts"] },
    ]);
  });

  it("should list every test that imports it as a test to run", () => {
    const { testsToRun } = changesFor(diffOf([modified(DOCUMENT_SERVICE)]));

    expect(testsToRun).toEqual([
      { test: INT_TEST, covers: DOCUMENT_SERVICE },
      { test: "test/services/DocumentService.spec.ts", covers: DOCUMENT_SERVICE },
    ]);
  });

  it("should not list a changed importer again as an affected file", () => {
    const { importsChanged } = changesFor(diffOf([modified(DOCUMENT_SERVICE), modified("src/jobs/SendReminderJob.ts")]));

    expect(importsChanged.map((file) => file.path)).toEqual(["src/api/controllers/DocumentController.ts", "src/jobs/scheduler.ts"]);
  });
});

describe("when a changed file has no test", () => {
  it("should list it under the changed files without tests", () => {
    const { untested } = changesFor(diffOf([modified(DOCUMENT_SERVICE), modified("src/jobs/SendReminderJob.ts")]));

    expect(untested).toEqual(["src/jobs/SendReminderJob.ts"]);
  });
});

describe("when a test file changed", () => {
  it("should list it as a test to run that covers itself, and not as untested", () => {
    const { testsToRun, untested } = changesFor(diffOf([modified("test/services/DocumentService.spec.ts")]));

    expect({ testsToRun, untested }).toEqual({ testsToRun: [{ test: "test/services/DocumentService.spec.ts", covers: "test/services/DocumentService.spec.ts" }], untested: [] });
  });
});

describe("when a new file is not added to git yet", () => {
  it("should show it as added, with the line count from the map", () => {
    const { changed } = changesFor(diffOf([], ["src/services/AuditService.ts"]));

    expect(changed).toEqual([{ path: "src/services/AuditService.ts", change: "added", linesAdded: 42, linesRemoved: 0 }]);
  });
});

describe("when files outside the map changed", () => {
  it("should count docs and config as other files", () => {
    const { otherFileCount } = changesFor(diffOf([modified(DOCUMENT_SERVICE), modified("README.md"), modified("package.json")], ["notes.txt"]));

    expect(otherFileCount).toBe(3);
  });

  it("should keep a deleted source file without wires, and count a deleted doc as other", () => {
    const deleted = (path: string): DiffEntry => ({ path, change: "deleted", linesAdded: 0, linesRemoved: 30 });

    const view = changesFor(diffOf([deleted("src/jobs/OldJob.ts"), deleted("docs/old.md")]));

    expect({ changed: view.changed.map((file) => [file.path, file.change]), importsChanged: view.importsChanged, otherFileCount: view.otherFileCount }).toEqual({
      changed: [["src/jobs/OldJob.ts", "deleted"]],
      importsChanged: [],
      otherFileCount: 1,
    });
  });

  it("should say no source file changed when only other files changed", () => {
    const view = buildBranchView(graphWithIntegrationTest(), diffOf([modified("README.md")]));

    expect(view.state).toBe("none");
  });
});

describe("when git cannot compare the branch", () => {
  it("should say so outside a git repository", () => {
    expect(buildBranchView(serviceGraph(), { state: "notRepo" }).state).toBe("none");
  });

  it("should say so when there is no base branch", () => {
    expect(buildBranchView(serviceGraph(), { state: "noBase" }).state).toBe("none");
  });

  it("should not say no source file changed when git diff failed", () => {
    const noChanges = buildBranchView(graphWithIntegrationTest(), diffOf([]));

    const failed = buildBranchView(graphWithIntegrationTest(), { state: "diffFailed" });

    expect(failed).not.toEqual(noChanges);
  });
});

describe("when the diff has no files", () => {
  it("should say no source file changed", () => {
    expect(buildBranchView(graphWithIntegrationTest(), diffOf([])).state).toBe("none");
  });
});

describe("when a source file and its own test both changed", () => {
  it("should list the test once, as covering the source file", () => {
    const { testsToRun } = changesFor(diffOf([modified(DOCUMENT_SERVICE), modified("test/services/DocumentService.spec.ts")]));

    expect(testsToRun.filter((entry) => entry.test === "test/services/DocumentService.spec.ts")).toEqual([{ test: "test/services/DocumentService.spec.ts", covers: DOCUMENT_SERVICE }]);
  });
});

describe("when a deleted test file is the only change", () => {
  it("should not list it as a test to run", () => {
    const view = changesFor(diffOf([{ path: "test/services/Old.spec.ts", change: "deleted", linesAdded: 0, linesRemoved: 9 }]));

    expect(view.testsToRun).toEqual([]);
  });
});
