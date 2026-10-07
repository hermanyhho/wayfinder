import { describe, expect, it } from "vitest";
import { buildViewData } from "../../../src/graph/neighbourhood";
import { answerFor, groupChecks, panelFor } from "../../../src/webview/panelModel";
import { DOCUMENT_SERVICE, analysisOf, graphOf, serviceGraph } from "../helpers/fixtures";

const view = () => buildViewData(serviceGraph(), DOCUMENT_SERVICE);
const CONTROLLER = "src/api/controllers/DocumentController.ts";

describe("panel content", () => {
  it("summarises the open file's connections", () => {
    const model = panelFor(view(), DOCUMENT_SERVICE);
    expect(model).toMatchObject({ rel: "Current file", color: "green", canOpen: false, connectionsTitle: "Connections" });
    expect(model.connections).toContainEqual({ label: "used by", value: "DocumentController.ts, SendReminderJob.ts" });
    expect(model.connections).toContainEqual({ label: "missing", value: "IDocumentService.ts" });
  });

  it("shows where a caller calls the open file", () => {
    const model = panelFor(view(), CONTROLLER);
    expect(model).toMatchObject({ rel: "Imports the open file", connectionsTitle: "Where it calls DocumentService.ts", canOpen: true });
    expect(model.connections).toContainEqual({ label: "DocumentController.ts:27", value: "return this.service.listForEmployee(actor, id)" });
  });

  it("answers Context with the same facts the panel shows for the file", () => {
    expect(answerFor(view(), DOCUMENT_SERVICE, "context")).toEqual(panelFor(view(), DOCUMENT_SERVICE).facts);
  });

  it("answers Why with importers and git history, and Checks with the rule results", () => {
    const git = [{ label: "3 weeks ago", value: "add remindUnsigned" }];
    expect(answerFor(view(), DOCUMENT_SERVICE, "why", git)).toEqual([
      { label: "Imported by", value: "DocumentController.ts, SendReminderJob.ts" },
      ...git,
    ]);
    expect(answerFor(view(), DOCUMENT_SERVICE, "checks", [])).toContainEqual({
      label: "Missing",
      value: "IDocumentService.ts: 4 of 4 files in src/services have a matching interface file.",
    });
    expect(answerFor(view(), "src/db/schema.ts", "checks", [])).toEqual([{ label: "Result", value: "No differences found against the files in the same folder." }]);
  });

  it("groups missing files and circular imports as issues, apart from the other checks", () => {
    const missing = { label: "Missing", value: "IDocumentService.ts" };
    const cycle = { label: "Circular import", value: "B.ts" };
    const size = { label: "Size", value: "900 lines" };
    expect(groupChecks([size, missing, cycle])).toEqual({ issues: [missing, cycle], others: [size] });
  });

  it("treats a node's own Cycle check as an issue and returns empty groups for no checks", () => {
    const cycle = { label: "Cycle", value: "A.ts -> B.ts -> A.ts" };
    expect(groupChecks([cycle])).toEqual({ issues: [cycle], others: [] });
    expect(groupChecks([])).toEqual({ issues: [], others: [] });
  });
});

describe("when a test file is open", () => {
  const TEST = "src/a/__tests__/Foo.int.test.ts";
  const connectionsOfTest = (imports: string[]) => panelFor(buildViewData(graphOf([analysisOf("src/a/Foo.ts"), analysisOf("src/a/Bar.ts"), analysisOf(TEST, imports)]), TEST), TEST).connections;

  it("should list the tested file under tests, not under uses", () => {
    const connections = connectionsOfTest(["src/a/Foo.ts", "src/a/Bar.ts"]);

    expect(connections).toContainEqual({ label: "uses", value: "Bar.ts" });
    expect(connections).toContainEqual({ label: "tests", value: "Foo.ts" });
  });
});
