import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeSource } from "../../../src/graph/analyzeSource";
import { buildViewData } from "../../../src/graph/neighbourhood";
import { DOCUMENT_SERVICE, analysisOf, graphOf, serviceGraph } from "../helpers/fixtures";

const kinds = (view: ReturnType<typeof buildViewData>) =>
  Object.fromEntries(view.nodes.map((node) => [node.id, `${node.kind}${node.secondLayer ? " (second)" : ""}`]));

describe("buildViewData", () => {
  it("places every connection of the typical service sample", () => {
    expect(kinds(buildViewData(serviceGraph(), DOCUMENT_SERVICE))).toEqual({
      [DOCUMENT_SERVICE]: "here",
      "src/api/controllers/DocumentController.ts": "caller",
      "src/jobs/SendReminderJob.ts": "caller",
      "test/services/DocumentService.spec.ts": "test",
      "src/db/repositories/DocumentRepository.ts": "dependency",
      "src/integrations/storage/StorageClient.ts": "dependency",
      "src/auth/PermissionPolicy.ts": "dependency",
      "src/types/document.types.ts": "types",
      "expected:src/services/IDocumentService.ts": "expected",
      "src/api/routes.ts": "caller (second)",
      "src/jobs/scheduler.ts": "caller (second)",
      "src/db/schema.ts": "dependency (second)",
      "src/config/storage.config.ts": "dependency (second)",
      "src/auth/roles.ts": "dependency (second)",
      "test/fixtures/documents.fixture.ts": "dependency (second)",
    });
  });

  it("connects second-layer files through the immediate layer", () => {
    const view = buildViewData(serviceGraph(), DOCUMENT_SERVICE);
    expect(view.nodes.find((node) => node.id === "src/api/routes.ts")?.via).toEqual(["src/api/controllers/DocumentController.ts"]);
    expect(view.edges).toContainEqual({ from: "src/api/routes.ts", to: "src/api/controllers/DocumentController.ts", style: "solid" });
    expect(view.edges).toContainEqual({ from: DOCUMENT_SERVICE, to: "expected:src/services/IDocumentService.ts", style: "dashed" });
  });

  it("collects usage lines, call sites and gutter marks", () => {
    const view = buildViewData(serviceGraph(), DOCUMENT_SERVICE);
    const repository = view.nodes.find((node) => node.id === "src/db/repositories/DocumentRepository.ts")!;
    expect(repository.usageInOpenFile.map((site) => site.line)).toEqual([1, 15]);
    const controller = view.nodes.find((node) => node.id === "src/api/controllers/DocumentController.ts")!;
    expect(controller.callSites).toEqual([
      { line: 1, text: 'import { DocumentService } from "src/services/DocumentService.ts"' },
      { line: 27, text: "return this.service.listForEmployee(actor, id)" },
    ]);
    expect(view.lineMarks).toContainEqual({ line: 15, nodeId: "src/db/repositories/DocumentRepository.ts" });
  });

  it("lists facts and pattern checks for the open file", () => {
    const center = buildViewData(serviceGraph(), DOCUMENT_SERVICE).nodes[0];
    expect(center.facts).toContainEqual({ label: "Size", value: "31 lines" });
    expect(center.facts).toContainEqual({ label: "Public methods", value: "listForEmployee, upload, remindUnsigned" });
    expect(center.checks).toContainEqual({ label: "Missing", value: "IDocumentService.ts: 4 of 4 files in src/services have a matching interface file." });
  });

  it("marks the file under test when a test file is open", () => {
    const view = buildViewData(serviceGraph(), "test/services/DocumentService.spec.ts");
    expect(view.nodes.find((node) => node.id === DOCUMENT_SERVICE)?.kind).toBe("subject");
  });

  it("shows both directions of a circular import", () => {
    const view = buildViewData(graphOf([analysisOf("src/a.ts", ["src/b.ts"]), analysisOf("src/b.ts", ["src/a.ts"])]), "src/a.ts");
    expect(view.nodes.find((node) => node.id === "src/b.ts")?.kind).toBe("cycle");
    expect(view.edges).toEqual([
      { from: "src/a.ts", to: "src/b.ts", style: "solid", label: "circular import" },
      { from: "src/b.ts", to: "src/a.ts", style: "solid" },
    ]);
  });

  it("explains what was checked when nothing connects to a file", () => {
    const view = buildViewData(graphOf([analysisOf("src/utils/currency.ts")]), "src/utils/currency.ts", { packageJsonText: '{"scripts":{}}' });
    expect(view.nodes).toHaveLength(1);
    expect(view.orphanChecks?.map((check) => check.label)).toEqual(["imports", "dynamic", "config"]);
  });
  it("adds a package node with its import line as a gutter mark", () => {
    const view = buildViewData(graphOf([analysisOf("src/a.ts", ["pkg:zod"])]), "src/a.ts");
    expect(view.nodes.find((node) => node.id === "package:zod")).toMatchObject({ kind: "package", name: "zod", usageInOpenFile: [{ line: 1 }] });
    expect(view.edges).toContainEqual({ from: "src/a.ts", to: "package:zod", style: "solid" });
    expect(view.lineMarks).toEqual([{ line: 1, nodeId: "package:zod" }]);
    expect(view.orphanChecks).toBeNull();
  });

  it("states the line numbers of both imports in a circular import", () => {
    const view = buildViewData(graphOf([analysisOf("src/a.ts", ["src/b.ts"]), analysisOf("src/b.ts", ["src/c.ts", "src/a.ts"])]), "src/a.ts");
    expect(view.nodes[0].checks).toContainEqual({ label: "Circular import", value: "b.ts: a.ts imports it on line 1. It imports a.ts on line 2." });
  });

  it("flags a file that no test imports, and not one that has a test", () => {
    const lonely = buildViewData(graphOf([analysisOf("src/a.ts")]), "src/a.ts");
    expect(lonely.nodes[0].checks).toContainEqual({ label: "Tests", value: "No test imports this file." });
    const service = buildViewData(serviceGraph(), DOCUMENT_SERVICE);
    expect(service.nodes[0].checks.map((check) => check.label)).not.toContain("Tests");
  });

  it("lists the members of the open sample DocumentService with their lines", () => {
    const text = readFileSync("test/sample-project/src/services/DocumentService.ts", "utf8");
    const view = buildViewData(graphOf([analyzeSource(DOCUMENT_SERVICE, text)]), DOCUMENT_SERVICE);
    expect(view.members.map(({ name, kind, line, exported }) => `${kind} ${name} line ${line}${exported ? " exported" : ""}`)).toEqual([
      "class DocumentService line 6 exported",
      "property documents line 8",
      "property storage line 9",
      "property permissions line 10",
      "method listForEmployee line 13 exported",
      "method upload line 18 exported",
    ]);
  });
});
