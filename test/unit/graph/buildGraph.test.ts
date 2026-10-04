import { describe, expect, it } from "vitest";
import { dependenciesOf, dependentsOf, removeFile, setFile } from "../../../src/graph/buildGraph";
import { analysisOf, directResolver, graphOf } from "../helpers/fixtures";

describe("import graph", () => {
  it("merges several imports of the same file into one dependency", () => {
    const graph = graphOf([analysisOf("src/a.ts", ["src/b.ts", "src/b.ts", "pkg:lodash"]), analysisOf("src/b.ts")]);
    expect(dependenciesOf(graph, "src/a.ts")).toEqual([{ from: "src/a.ts", to: "src/b.ts", names: ["b"], typeOnly: false, line: 1 }]);
    expect(dependentsOf(graph, "src/b.ts").map((dependency) => dependency.from)).toEqual(["src/a.ts"]);
    expect(graph.packages.get("src/a.ts")).toEqual([{ name: "lodash", line: 3 }]);
  });

  it("replaces a file's edges when the file is read again", () => {
    const graph = graphOf([analysisOf("src/a.ts", ["src/b.ts"]), analysisOf("src/b.ts")]);
    setFile(graph, analysisOf("src/a.ts", []), directResolver);
    expect(dependentsOf(graph, "src/b.ts")).toEqual([]);
  });

  it("removes a deleted file but keeps the files that still import it", () => {
    const graph = graphOf([analysisOf("src/a.ts", ["src/b.ts"]), analysisOf("src/b.ts")]);
    removeFile(graph, "src/b.ts");
    expect(graph.files.has("src/b.ts")).toBe(false);
    expect(dependentsOf(graph, "src/b.ts").map((dependency) => dependency.from)).toEqual(["src/a.ts"]);
  });

  it("drops a deleted importer from the dependents of the files it imported", () => {
    const graph = graphOf([analysisOf("src/a.ts", ["src/b.ts"]), analysisOf("src/c.ts", ["src/b.ts"]), analysisOf("src/b.ts")]);
    removeFile(graph, "src/a.ts");
    expect(dependenciesOf(graph, "src/a.ts")).toEqual([]);
    expect(dependentsOf(graph, "src/b.ts").map((dependency) => dependency.from)).toEqual(["src/c.ts"]);
  });
});
