import { describe, expect, it } from "vitest";
import { buildViewData } from "../../../src/graph/neighbourhood";
import { answerFor, panelFor } from "../../../src/webview/panelModel";
import { DOCUMENT_SERVICE, serviceGraph } from "../helpers/fixtures";

const view = () => buildViewData(serviceGraph(), DOCUMENT_SERVICE);
const CONTROLLER = "src/api/controllers/DocumentController.ts";

describe("panel content", () => {
  it("summarises the open file's connections", () => {
    const model = panelFor(view(), DOCUMENT_SERVICE);
    expect(model).toMatchObject({ rel: "Open file", color: "green", canOpen: false, connectionsTitle: "Connections" });
    expect(model.connections).toContainEqual({ label: "used by", value: "DocumentController.ts, SendReminderJob.ts" });
    expect(model.connections).toContainEqual({ label: "missing", value: "IDocumentService.ts" });
  });

  it("shows where a caller calls the open file", () => {
    const model = panelFor(view(), CONTROLLER);
    expect(model).toMatchObject({ rel: "Imports the open file", connectionsTitle: "Where it calls DocumentService.ts", canOpen: true });
    expect(model.connections).toContainEqual({ label: "DocumentController.ts:27", value: "return this.service.listForEmployee(actor, id)" });
  });

  it("answers Context with the first four facts and the files it imports, leaving out missing files", () => {
    expect(answerFor(view(), DOCUMENT_SERVICE, "context")).toEqual([
      { label: "Exports", value: "class DocumentService" },
      { label: "Public methods", value: "listForEmployee, upload, remindUnsigned" },
      { label: "Size", value: "31 lines" },
      { label: "Doc comment", value: "none" },
      { label: "Imports", value: "DocumentRepository.ts, StorageClient.ts, PermissionPolicy.ts, document.types.ts" },
    ]);
  });

  it("answers Context for a caller with exactly one Imports row", () => {
    const importsRows = answerFor(view(), CONTROLLER, "context").filter((fact) => fact.label === "Imports");
    expect(importsRows).toHaveLength(1);
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
});
