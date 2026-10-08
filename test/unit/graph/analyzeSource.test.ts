import { describe, expect, it } from "vitest";
import { analyzeSource } from "../../../src/graph/analyzeSource";

const documentService = [
  'import { DocumentRepository } from "../db/repositories/DocumentRepository"',
  'import { StorageClient } from "../integrations/storage/StorageClient"',
  'import { PermissionPolicy } from "../auth/PermissionPolicy"',
  'import type { Document, NewDocument } from "../types/document.types"',
  "",
  "export class DocumentService {",
  "  constructor(",
  "    private readonly documents: DocumentRepository,",
  "    private readonly storage: StorageClient,",
  "    private readonly permissions: PermissionPolicy,",
  "  ) {}",
  "",
  "  async listForEmployee(actorId: string, employeeId: string): Promise<Document[]> {",
  "    await this.permissions.assertCanRead(actorId, employeeId)",
  "    return this.documents.findByEmployee(employeeId)",
  "  }",
  "",
  "  async upload(actorId: string, input: NewDocument, file: Buffer): Promise<Document> {",
  "    await this.permissions.assertCanWrite(actorId, input.employeeId)",
  "    const fileKey = await this.storage.put(file)",
  "    return this.documents.save({ ...input, fileKey })",
  "  }",
  "",
  "  async remindUnsigned(): Promise<number> {",
  "    const unsigned = await this.documents.findUnsigned()",
  "    for (const document of unsigned) {",
  "      await this.documents.markReminded(document.id)",
  "    }",
  "    return unsigned.length",
  "  }",
  "}",
].join("\n");

const lines = (sites: { line: number }[] | undefined) => (sites ?? []).map((site) => site.line);

describe("analyzeSource", () => {
  const analysis = analyzeSource("src/services/DocumentService.ts", documentService);

  it("lists static imports with their line and whether they are type-only", () => {
    expect(analysis.imports.map(({ specifier, line, typeOnly }) => ({ specifier, line, typeOnly }))).toEqual([
      { specifier: "../db/repositories/DocumentRepository", line: 1, typeOnly: false },
      { specifier: "../integrations/storage/StorageClient", line: 2, typeOnly: false },
      { specifier: "../auth/PermissionPolicy", line: 3, typeOnly: false },
      { specifier: "../types/document.types", line: 4, typeOnly: true },
    ]);
  });

  it("finds the lines that use an imported name, including through constructor fields", () => {
    expect(lines(analysis.usage.DocumentRepository)).toEqual([8, 15, 21, 25, 27]);
    expect(lines(analysis.usage.PermissionPolicy)).toEqual([10, 14, 19]);
    expect(lines(analysis.usage.StorageClient)).toEqual([9, 20]);
    expect(lines(analysis.usage.NewDocument)).toEqual([18]);
    expect(analysis.usage.DocumentRepository?.[1]).toEqual({ line: 15, text: "return this.documents.findByEmployee(employeeId)" });
  });

  it("lists exports, public methods, size and doc comment", () => {
    expect(analysis.exports).toEqual(["class DocumentService"]);
    expect(analysis.publicMethods).toEqual(["listForEmployee", "upload", "remindUnsigned"]);
    expect(analysis.lineCount).toBe(31);
    expect(analysis.hasDocComment).toBe(false);
  });

  it("records re-exports, dynamic imports and require calls", () => {
    const text = [
      'import chalk, * as all from "chalk"',
      'export { formatDate } from "./formatDate"',
      'const lazy = () => import("./lazy")',
      'const legacy = require("./legacy")',
      "/** Entry point. */",
      "export default function main() { return chalk }",
    ].join("\n");
    const result = analyzeSource("src/main.ts", text);
    expect(result.imports.map(({ specifier, dynamic }) => ({ specifier, dynamic }))).toEqual([
      { specifier: "chalk", dynamic: false },
      { specifier: "./formatDate", dynamic: false },
      { specifier: "./lazy", dynamic: true },
      { specifier: "./legacy", dynamic: true },
    ]);
    expect(result.imports[0].names).toEqual(["chalk", "all"]);
    expect(result.exports).toEqual(["function main"]);
    expect(result.hasDocComment).toBe(true);
    expect(lines(result.usage.chalk)).toEqual([6]);
  });

  it("marks imports type-only when every named binding is inline type, and re-exports by export type", () => {
    const text = [
      'import { type Alpha, type Beta } from "./types"',
      'import { type Gamma, delta } from "./mixed"',
      'export type { Epsilon } from "./epsilon"',
      'import legacy = require("./legacy")',
    ].join("\n");
    const result = analyzeSource("src/types.ts", text);
    expect(result.imports.map(({ specifier, typeOnly, names }) => ({ specifier, typeOnly, names }))).toEqual([
      { specifier: "./types", typeOnly: true, names: ["Alpha", "Beta"] },
      { specifier: "./mixed", typeOnly: false, names: ["Gamma", "delta"] },
      { specifier: "./epsilon", typeOnly: true, names: [] },
      { specifier: "./legacy", typeOnly: false, names: ["legacy"] },
    ]);
  });

  it("skips private and protected methods and tracks this.field usage for typed class properties", () => {
    const text = [
      'import { Clock } from "./Clock"',
      "export class Scheduler {",
      "  private clock: Clock = new Clock()",
      "  public run() { return this.clock.now() }",
      "  protected tick() {}",
      "  private reset() {}",
      "}",
    ].join("\n");
    const result = analyzeSource("src/Scheduler.ts", text);
    expect(result.publicMethods).toEqual(["run"]);
    expect(lines(result.usage.Clock)).toEqual([3, 4]);
  });

  it("lists the class, its constructor properties and its methods with their lines", () => {
    expect(analysis.members).toEqual([
      { name: "DocumentService", kind: "class", line: 6, endLine: 31, exported: true },
      { name: "documents", kind: "property", line: 8, endLine: 8, exported: false, className: "DocumentService" },
      { name: "storage", kind: "property", line: 9, endLine: 9, exported: false, className: "DocumentService" },
      { name: "permissions", kind: "property", line: 10, endLine: 10, exported: false, className: "DocumentService" },
      { name: "listForEmployee", kind: "method", line: 13, endLine: 16, exported: true, className: "DocumentService" },
      { name: "upload", kind: "method", line: 18, endLine: 22, exported: true, className: "DocumentService" },
      { name: "remindUnsigned", kind: "method", line: 24, endLine: 30, exported: true, className: "DocumentService" },
    ]);
  });

  it("lists top-level functions, arrow function consts, types and enums, and whether each is exported", () => {
    const text = [
      "export function formatDate() {}",
      "function helper() {}",
      "export const toUpper = (value: string) => value.toUpperCase()",
      "let counter = 0",
      "export interface Options {}",
      "type Mode = 'a' | 'b'",
      "export enum Color { Red }",
      "const LIMIT = 10",
      "export { helper, LIMIT as MAX }",
    ].join("\n");
    expect(analyzeSource("src/utils.ts", text).members).toEqual([
      { name: "formatDate", kind: "function", line: 1, endLine: 1, exported: true },
      { name: "helper", kind: "function", line: 2, endLine: 2, exported: true },
      { name: "toUpper", kind: "function", line: 3, endLine: 3, exported: true },
      { name: "counter", kind: "let", line: 4, endLine: 4, exported: false },
      { name: "Options", kind: "interface", line: 5, endLine: 5, exported: true },
      { name: "Mode", kind: "type", line: 6, endLine: 6, exported: false },
      { name: "Color", kind: "enum", line: 7, endLine: 7, exported: true },
      { name: "LIMIT", kind: "const", line: 8, endLine: 8, exported: true },
    ]);
  });

  it("ends each member at the last line of its declaration, not at its name", () => {
    const text = ["export const toUpper = (", "  value: string,", ") => value.toUpperCase()", "export interface Options {", "  size: number", "}"].join("\n");
    expect(analyzeSource("src/multiline.ts", text).members.map((member) => [member.name, member.line, member.endLine])).toEqual([
      ["toUpper", 1, 3],
      ["Options", 4, 6],
    ]);
  });

  it("marks default exports and members of a class that is not exported", () => {
    const text = [
      "class Internal {",
      "  public count = 0",
      "  run() {}",
      "}",
      "export default function main() {}",
    ].join("\n");
    expect(analyzeSource("src/main.ts", text).members).toEqual([
      { name: "Internal", kind: "class", line: 1, endLine: 4, exported: false },
      { name: "count", kind: "property", line: 2, endLine: 2, exported: false, className: "Internal" },
      { name: "run", kind: "method", line: 3, endLine: 3, exported: false, className: "Internal" },
      { name: "main", kind: "function", line: 5, endLine: 5, exported: true },
    ]);
  });

  it("ends functions, enums and arrow-function constants at their closing line", () => {
    const text = ["function run() {", "  return 1", "}", "enum Color {", "  Red,", "}", "const go = () => {", "  return 2", "}"].join("\n");
    expect(analyzeSource("src/spans.ts", text).members.map((member) => [member.name, member.line, member.endLine])).toEqual([
      ["run", 1, 3],
      ["Color", 4, 6],
      ["go", 7, 9],
    ]);
  });

  it("ends a constructor parameter property on its own line inside a multi-line constructor", () => {
    const text = ["class Box {", "  constructor(", "    private size: number,", "  ) {}", "}"].join("\n");
    expect(analyzeSource("src/ctor.ts", text).members.map((member) => [member.name, member.line, member.endLine])).toEqual([
      ["Box", 1, 5],
      ["size", 3, 3],
    ]);
  });

  it("marks a const exported when export default names it later", () => {
    const text = ["const fallback = 1", "export default fallback"].join("\n");
    expect(analyzeSource("src/fallback.ts", text).members).toEqual([{ name: "fallback", kind: "const", line: 1, endLine: 1, exported: true }]);
  });

  it("names an anonymous default class default and marks its public members exported", () => {
    const text = ["export default class {", "  protected hidden = 1", "  open() {}", "}"].join("\n");
    expect(analyzeSource("src/anonymous.ts", text).members).toEqual([
      { name: "default", kind: "class", line: 1, endLine: 4, exported: true },
      { name: "hidden", kind: "property", line: 2, endLine: 2, exported: false, className: "default" },
      { name: "open", kind: "method", line: 3, endLine: 3, exported: true, className: "default" },
    ]);
  });

  it("marks a public constructor parameter property of an exported class as exported", () => {
    const text = ["export class Box {", "  constructor(public readonly size: number, private secret: string, plain: string) {}", "}"].join("\n");
    expect(analyzeSource("src/box.ts", text).members).toEqual([
      { name: "Box", kind: "class", line: 1, endLine: 3, exported: true },
      { name: "size", kind: "property", line: 2, endLine: 2, exported: true, className: "Box" },
      { name: "secret", kind: "property", line: 2, endLine: 2, exported: false, className: "Box" },
    ]);
  });

  it("marks public methods exported when their class is exported by a later export list", () => {
    const text = ["class A { run() {} }", "export { A }"].join("\n");
    expect(analyzeSource("src/a.ts", text).members).toEqual([
      { name: "A", kind: "class", line: 1, endLine: 1, exported: true },
      { name: "run", kind: "method", line: 1, endLine: 1, exported: true, className: "A" },
    ]);
  });
});

describe("when a test file is analyzed", () => {
  const unlinkRelatedSpec = [
    'import { describe, expect, it, test } from "vitest"',
    "",
    "const helper = () => 1",
    "",
    'describe("Group/hooks/UnlinkRelated", () => {',
    '  test("unlinks the related group", () => {',
    "    expect(helper()).toBe(1)",
    "  })",
    '  test.skip("keeps the group when the hook fails", () => {})',
    '  describe("when nothing is linked", () => {',
    '    it.only("does nothing", () => {})',
    '    xit("logs a warning", () => {})',
    "  })",
    "})",
    'test.each([1, 2])("runs for %s", () => {})',
  ].join("\n");
  const membersOf = (path: string) => analyzeSource(path, unlinkRelatedSpec).members;

  it("should list suites and tests in source order after the declarations before them", () => {
    const members = membersOf("test/UnlinkRelated.spec.ts");

    expect(members.map((member) => [member.kind, member.name, member.line, member.endLine])).toEqual([
      ["function", "helper", 3, 3],
      ["suite", "Group/hooks/UnlinkRelated", 5, 14],
      ["test", "unlinks the related group", 6, 8],
      ["test", "keeps the group when the hook fails", 9, 9],
      ["suite", "when nothing is linked", 10, 13],
      ["test", "does nothing", 11, 11],
      ["test", "logs a warning", 12, 12],
    ]);
  });

  it("should record the title of the innermost describe each call is in", () => {
    const members = membersOf("test/UnlinkRelated.spec.ts");

    expect(members.map((member) => member.suiteTitle)).toEqual([
      undefined, undefined, "Group/hooks/UnlinkRelated", "Group/hooks/UnlinkRelated", "Group/hooks/UnlinkRelated", "when nothing is linked", "when nothing is linked",
    ]);
  });

  it("should mark .only as only and .skip or an x prefix as skip", () => {
    const members = membersOf("test/UnlinkRelated.spec.ts");

    expect(members.filter((member) => member.focus).map((member) => [member.name, member.focus])).toEqual([
      ["keeps the group when the hook fails", "skip"],
      ["does nothing", "only"],
      ["logs a warning", "skip"],
    ]);
  });

  it("should not list describe or test calls in a file that is not a test file", () => {
    const members = membersOf("src/UnlinkRelated.ts");

    expect(members.map((member) => member.name)).toEqual(["helper"]);
  });
});

describe("when a test file has an xdescribe", () => {
  it("should mark the suite as skip", () => {
    const source = ['xdescribe("legacy", () => {', '  it("still runs", () => {})', "})"].join("\n");

    const suite = analyzeSource("test/legacy.spec.ts", source).members.find((member) => member.kind === "suite");

    expect(suite?.focus).toBe("skip");
  });
});

describe("when a test file uses the names of another test framework", () => {
  const outlineOf = (sourceLines: string[]) =>
    analyzeSource("test/other.spec.ts", sourceLines.join("\n")).members.map((member) => [member.kind, member.name, member.suiteTitle, member.focus]);

  it("should list Mocha context as a suite", () => {
    const outline = outlineOf(['describe("cart", () => {', '  context("when empty", () => {', '    it("shows zero", () => {})', "  })", "})"]);

    expect(outline).toEqual([
      ["suite", "cart", undefined, undefined],
      ["suite", "when empty", "cart", undefined],
      ["test", "shows zero", "when empty", undefined],
    ]);
  });

  it("should list Mocha TDD suite as a suite and suite.only as only", () => {
    const outline = outlineOf(['suite.only("cart", () => {', '  test("adds an item", () => {})', "})"]);

    expect(outline).toEqual([
      ["suite", "cart", undefined, "only"],
      ["test", "adds an item", "cart", undefined],
    ]);
  });

  it("should list Playwright test.describe as a suite and mark .only and .skip", () => {
    const outline = outlineOf([
      'test.describe("login", () => {',
      '  test("signs in", async () => {})',
      '  test.describe.only("with a wrong password", () => {})',
      '  test.describe.skip("with two-factor", () => {})',
      "})",
    ]);

    expect(outline).toEqual([
      ["suite", "login", undefined, undefined],
      ["test", "signs in", "login", undefined],
      ["suite", "with a wrong password", "login", "only"],
      ["suite", "with two-factor", "login", "skip"],
    ]);
  });

  it("should mark Jasmine fdescribe and fit as only", () => {
    const outline = outlineOf(['fdescribe("cart", () => {', '  fit("adds an item", () => {})', "})"]);

    expect(outline).toEqual([
      ["suite", "cart", undefined, "only"],
      ["test", "adds an item", "cart", "only"],
    ]);
  });

  it("should not list test.describe with any other modifier", () => {
    const outline = outlineOf(['test.describe.serial("checkout", () => {})', 'test.describe.each([1])("runs %s", () => {})']);

    expect(outline).toEqual([]);
  });

  it("should keep the tag of an x or f call over its modifier", () => {
    const outline = outlineOf(['xit.only("stays skipped", () => {})', 'fdescribe.skip("stays only", () => {})']);

    expect(outline).toEqual([
      ["test", "stays skipped", undefined, "skip"],
      ["suite", "stays only", undefined, "only"],
    ]);
  });

  it("should not list calls on other objects that end in a test name", () => {
    const outline = outlineOf(['helper.describe("a", () => {})', 'this.test.describe("b", () => {})', 'foo.test("c", () => {})']);

    expect(outline).toEqual([]);
  });
});

describe("when a file declares and uses names", () => {
  const source = [
    'import { Gadget } from "./Gadget"',
    'export { Gadget as Widget } from "./Gadget"',
    "export function build() {",
    "  const local = 1",
    "  return local + other",
    "}",
    "class Box { size = 1 }",
    "service.remove(1)",
    "service.remove(2)",
  ].join("\n");
  const analysis = analyzeSource("src/build.ts", source);

  it("should list names that are read", () => {
    expect(analysis.referencedNames.has("other")).toBe(true);
    expect(analysis.referencedNames.has("local")).toBe(true);
    expect(analysis.referencedNames.has("service")).toBe(true);
  });

  it("should not list names that are only declared", () => {
    expect(analysis.referencedNames.has("build")).toBe(false);
    expect(analysis.referencedNames.has("Box")).toBe(false);
    expect(analysis.referencedNames.has("size")).toBe(false);
  });

  it("should list a name passed in a shorthand object property", () => {
    const shorthand = analyzeSource("src/helpers.ts", ["function helper() {}", "module.exports = { helper }"].join("\n"));

    expect(shorthand.referencedNames.has("helper")).toBe(true);
  });

  it("should record the first line of each property access", () => {
    expect(analysis.firstPropertyAccessLine.get("remove")).toBe(8);
    expect(analysis.firstPropertyAccessLine.has("missing")).toBe(false);
  });
});

describe("when a file declares classes and interfaces with implements and extends clauses", () => {
  const source = [
    'import type { IGroup, IAudited } from "./IGroup"',
    'import { BaseService } from "./BaseService"',
    "export class GroupService extends BaseService implements IGroup, IAudited {",
    "  IGroup() {}",
    "}",
    "export interface IDepartment extends IGroup {}",
    "class Plain {}",
  ].join("\n");
  const memberNamed = (name: string, kind: string) => analyzeSource("src/groups/GroupService.ts", source).members.find((member) => member.name === name && member.kind === kind)!;

  it("should record the names a class implements and extends", () => {
    const service = memberNamed("GroupService", "class");

    expect(service).toMatchObject({ implements: ["IGroup", "IAudited"], extends: ["BaseService"] });
  });

  it("should record the names an interface extends", () => {
    const department = memberNamed("IDepartment", "interface");

    expect(department.extends).toEqual(["IGroup"]);
  });

  it("should leave the clauses off a class without them and off a method named like an interface", () => {
    const plain = memberNamed("Plain", "class");
    const method = memberNamed("IGroup", "method");

    expect([plain, method].map((member) => [member.implements, member.extends])).toEqual([[undefined, undefined], [undefined, undefined]]);
  });
});

describe("when heritage clauses use generics or qualified names", () => {
  const classNamed = (source: string) => analyzeSource("src/groups/Service.ts", source).members.find((member) => member.kind === "class")!;

  it("should record the interface name without its type arguments", () => {
    const service = classNamed("export class Service implements IGroup<string>, IAudited<number> {}");

    expect(service.implements).toEqual(["IGroup", "IAudited"]);
  });

  it("should skip a qualified name because it cannot match a named import", () => {
    const service = classNamed("export class Service implements ns.IGroup, IAudited {}");

    expect(service.implements).toEqual(["IAudited"]);
  });
});
