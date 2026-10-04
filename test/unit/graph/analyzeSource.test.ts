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
});
