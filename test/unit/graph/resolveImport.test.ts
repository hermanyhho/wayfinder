import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createResolver } from "../../../src/graph/resolveImport";

const files = new Map([
  ["/repo/src/a.ts", ""],
  ["/repo/src/b.ts", ""],
  ["/repo/src/lib/index.ts", ""],
]);
const host = { fileExists: (path: string) => files.has(path), readFile: (path: string) => files.get(path) };
const options: ts.CompilerOptions = { baseUrl: "/repo", paths: { "@/*": ["src/*"] }, moduleResolution: ts.ModuleResolutionKind.Node10, allowJs: true };
const resolve = createResolver("/repo", options, host);
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
    const hostWithPackage = { fileExists: (path: string) => filesWithPackage.has(path), readFile: (path: string) => filesWithPackage.get(path) };
    const resolveWithPackage = createResolver("/repo", options, hostWithPackage);
    expect(resolveWithPackage("zod", from)).toEqual({ kind: "package", name: "zod" });
  });
});
