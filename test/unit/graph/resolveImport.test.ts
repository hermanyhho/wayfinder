import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createResolver } from "../../../src/graph/resolveImport";

const files = new Map([
  ["/repo/src/a.ts", ""],
  ["/repo/src/b.ts", ""],
  ["/repo/src/lib/index.ts", ""],
]);
const hostFor = (hostFiles: Map<string, string>) => ({ fileExists: (path: string) => hostFiles.has(path), readFile: (path: string) => hostFiles.get(path) });
const options: ts.CompilerOptions = { baseUrl: "/repo", paths: { "@/*": ["src/*"] }, moduleResolution: ts.ModuleResolutionKind.Node10, allowJs: true };
const resolve = createResolver("/repo", options, hostFor(files));
const from = "/repo/src/a.ts";

describe("createResolver", () => {
  it("resolves relative imports and tsconfig path aliases to files", () => {
    expect(resolve("./b", from)).toEqual({ kind: "file", path: "/repo/src/b.ts" });
    expect(resolve("@/lib", from)).toEqual({ kind: "file", path: "/repo/src/lib/index.ts" });
  });

  it("reports bare specifiers as packages, using the scope when there is one", () => {
    expect(resolve("date-fns/locale", from)).toEqual({ kind: "package", name: "date-fns" });
    expect(resolve("@scope/pkg/deep", from)).toEqual({ kind: "package", name: "@scope/pkg" });
  });

  it("reports node built-ins and unresolved imports", () => {
    expect(resolve("node:fs", from)).toEqual({ kind: "builtin" });
    expect(resolve("path", from)).toEqual({ kind: "builtin" });
    expect(resolve("./missing", from)).toEqual({ kind: "unresolved" });
    expect(resolve("@/nope", from)).toEqual({ kind: "unresolved" });
  });
});

describe("createResolver edge cases", () => {
  it("resolves a .js extension import to its .ts source file", () => {
    expect(resolve("./b.js", from)).toEqual({ kind: "file", path: "/repo/src/b.ts" });
  });

  it("reports an import found in node_modules as a package, not a file", () => {
    const filesWithPackage = new Map([...files, ["/repo/node_modules/zod/index.d.ts", ""]]);
    const resolveWithPackage = createResolver("/repo", options, hostFor(filesWithPackage));
    expect(resolveWithPackage("zod", from)).toEqual({ kind: "package", name: "zod" });
  });

  it("resolves a path alias named like a node built-in to the local file", () => {
    const filesWithAliases = new Map([...files, ["/repo/src/events.ts", ""], ["/repo/src/util/types.ts", ""]]);
    const aliasOptions = { ...options, paths: { events: ["src/events.ts"], "util/*": ["src/util/*"] } };
    const resolveWithAliases = createResolver("/repo", aliasOptions, hostFor(filesWithAliases));
    expect(resolveWithAliases("events", from)).toEqual({ kind: "file", path: "/repo/src/events.ts" });
    expect(resolveWithAliases("util/types", from)).toEqual({ kind: "file", path: "/repo/src/util/types.ts" });
  });

  it("reports an unresolved alias that is not a valid package name as unresolved", () => {
    expect(resolve("~/foo", from)).toEqual({ kind: "unresolved" });
    expect(resolve("#internal", from)).toEqual({ kind: "unresolved" });
  });
});
