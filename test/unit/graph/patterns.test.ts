import { describe, expect, it } from "vitest";
import { removeFile } from "../../../src/graph/buildGraph";
import { circularWith, expectedFiles, isTestFile, sizeOutlier, subjectByFileNameOf, subjectOf, testsOf } from "../../../src/graph/patterns";
import { DOCUMENT_SERVICE, analysisOf, graphOf, serviceGraph } from "../helpers/fixtures";

describe("pattern rules", () => {
  it("recognises test files by name and folder", () => {
    expect(["a.spec.ts", "a.test.tsx", "src/__tests__/a.ts", "a_test.js"].every(isTestFile)).toBe(true);
    expect(isTestFile("src/specification.ts")).toBe(false);
  });

  it("finds the tests that import a file and the file a test is for", () => {
    const graph = serviceGraph();
    expect(testsOf(graph, DOCUMENT_SERVICE)).toEqual(["test/services/DocumentService.spec.ts"]);
    expect(subjectOf(graph, "test/services/DocumentService.spec.ts")).toBe(DOCUMENT_SERVICE);
  });

  it("expects an interface file when most siblings have one", () => {
    expect(expectedFiles(serviceGraph(), DOCUMENT_SERVICE)).toEqual([
      { path: "src/services/IDocumentService.ts", kind: "partner", reason: "4 of 4 files in src/services have a matching interface file." },
    ]);
  });

  it("expects a test when most siblings have one and this file has none", () => {
    const graph = serviceGraph();
    removeFile(graph, "test/services/DocumentService.spec.ts");
    expect(expectedFiles(graph, DOCUMENT_SERVICE)[0]).toEqual({
      path: "test/services/DocumentService.spec.ts",
      kind: "test",
      reason: "4 of 4 files in src/services have a test that imports them.",
    });
  });

  it("keeps the test folder when the sibling's name also appears in the folder name", () => {
    const graph = graphOf([
      analysisOf("src/x/Bar.ts"),
      ...["Foo", "Baz", "Qux"].flatMap((name) => [analysisOf(`src/x/${name}.ts`), analysisOf(`test/${name}/${name}.spec.ts`, [`src/x/${name}.ts`])]),
    ]);
    expect(expectedFiles(graph, "src/x/Bar.ts")[0]?.path).toBe("test/Foo/Bar.spec.ts");
  });

  it("expects nothing when the folder has fewer than 3 siblings", () => {
    const graph = graphOf([analysisOf("src/x/A.ts"), analysisOf("src/x/IB.ts"), analysisOf("src/x/B.ts")]);
    expect(expectedFiles(graph, "src/x/A.ts")).toEqual([]);
  });

  it("expects a .types file at exactly 3 siblings and 75% of them having one", () => {
    const files = ["A", "B", "C", "D", "E"].map((name) => analysisOf(`src/b/${name}.ts`));
    const typesFiles = ["B", "C", "D"].map((name) => analysisOf(`src/b/${name}.types.ts`));
    expect(expectedFiles(graphOf([...files, ...typesFiles]), "src/b/A.ts")).toEqual([
      { path: "src/b/A.types.ts", kind: "partner", reason: "3 of 4 files in src/b have a matching .types file." },
    ]);
    expect(expectedFiles(graphOf([...files.slice(0, 4), ...typesFiles]), "src/b/A.ts")).toHaveLength(1);
  });

  it("expects nothing when fewer than 75% of siblings have the file", () => {
    const files = ["A", "B", "C", "D"].map((name) => analysisOf(`src/b/${name}.ts`));
    const interfaces = ["B", "C"].map((name) => analysisOf(`src/b/I${name}.ts`));
    expect(expectedFiles(graphOf([...files, ...interfaces]), "src/b/A.ts")).toEqual([]);
  });

  it("finds circular imports", () => {
    const graph = graphOf([analysisOf("src/a.ts", ["src/b.ts"]), analysisOf("src/b.ts", ["src/a.ts"])]);
    expect(circularWith(graph, "src/a.ts")).toEqual(["src/b.ts"]);
  });

  it("flags a file much larger than its siblings", () => {
    const sizes = [1240, 120, 110, 130];
    const graph = graphOf(sizes.map((lineCount, index) => analysisOf(`src/s/F${index}.ts`, [], { lineCount })));
    expect(sizeOutlier(graph, "src/s/F0.ts")).toEqual({ lines: 1240, median: 120 });
    expect(sizeOutlier(graph, "src/s/F1.ts")).toBeNull();
  });
});

describe("when a test name has extra dotted parts before .test or .spec", () => {
  it("should find the imported subject of an integration test in __tests__", () => {
    const graph = graphOf([analysisOf("src/a/Foo.ts"), analysisOf("src/a/__tests__/Foo.int.test.ts", ["src/a/Foo.ts"])]);

    const subject = subjectOf(graph, "src/a/__tests__/Foo.int.test.ts");

    expect(subject).toBe("src/a/Foo.ts");
  });

  it("should prefer an exact base name match over a shorter one", () => {
    const graph = graphOf([analysisOf("src/a/Foo.ts"), analysisOf("src/a/Foo.types.ts"), analysisOf("src/a/Foo.types.test.ts", ["src/a/Foo.ts", "src/a/Foo.types.ts"])]);

    const subject = subjectOf(graph, "src/a/Foo.types.test.ts");

    expect(subject).toBe("src/a/Foo.types.ts");
  });
});

describe("when a test does not import the file it tests", () => {
  it("should find the subject one folder up when the test is in __tests__", () => {
    const graph = graphOf([analysisOf("src/a/Foo.ts"), analysisOf("src/a/__tests__/Foo.int.test.ts")]);

    const subject = subjectByFileNameOf(graph, "src/a/__tests__/Foo.int.test.ts");

    expect(subject).toBe("src/a/Foo.ts");
  });

  it("should find the subject next to an e2e spec", () => {
    const graph = graphOf([analysisOf("src/a/Foo.ts"), analysisOf("src/a/Foo.e2e.spec.ts")]);

    const subject = subjectByFileNameOf(graph, "src/a/Foo.e2e.spec.ts");

    expect(subject).toBe("src/a/Foo.ts");
  });

  it("should find nothing when no file nearby has the same base name", () => {
    const graph = graphOf([analysisOf("src/a/Bar.ts"), analysisOf("src/Foo.ts"), analysisOf("src/a/b/__tests__/Foo.int.test.ts")]);

    const subject = subjectByFileNameOf(graph, "src/a/b/__tests__/Foo.int.test.ts");

    expect(subject).toBeNull();
  });
});

describe("when several files nearby could be the subject by name", () => {
  it("should prefer the exact base name over a shorter prefix match", () => {
    const graph = graphOf([analysisOf("src/a/Foo.ts"), analysisOf("src/a/Foo.types.ts"), analysisOf("src/a/Foo.types.test.ts")]);

    const subject = subjectByFileNameOf(graph, "src/a/Foo.types.test.ts");

    expect(subject).toBe("src/a/Foo.types.ts");
  });

  it("should ignore other test files with the same base name", () => {
    const graph = graphOf([analysisOf("src/a/Foo.test.ts"), analysisOf("src/a/Foo.e2e.spec.ts")]);

    const subject = subjectByFileNameOf(graph, "src/a/Foo.e2e.spec.ts");

    expect(subject).toBeNull();
  });
});
