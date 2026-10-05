import { describe, expect, it } from "vitest";
import { buildViewData } from "../../../src/graph/neighbourhood";
import { layout, type UiState } from "../../../src/webview/layout";
import { DOCUMENT_SERVICE, analysisOf, graphOf, serviceGraph } from "../helpers/fixtures";

const ui = (patch: Partial<UiState> = {}): UiState => ({ selected: DOCUMENT_SERVICE, layer: 1, open: {}, ...patch });
const view = () => buildViewData(serviceGraph(), DOCUMENT_SERVICE);
const CONTROLLER = "src/api/controllers/DocumentController.ts";
const COLUMN_X = [16, 277, 538];
const NODE_X = [63, 324, 585];
const cyclicView = () => buildViewData(graphOf([analysisOf("src/a/A.ts", ["src/a/B.ts"]), analysisOf("src/a/B.ts", ["src/a/A.ts"])]), "src/a/A.ts");

describe("layout", () => {
  it("puts the callers above the open file and three columns below it", () => {
    const { inner } = layout(view(), ui());
    expect(inner.floors.map((floor) => [floor.title, floor.x, floor.y, floor.w, floor.h])).toEqual([
      ["Imports this file", 16, 16, 768, 112],
      ["Same folder", 16, 142, 768, 112],
      ["Imported by this file", COLUMN_X[0], 268, 245, 334],
      ["Tests", COLUMN_X[1], 268, 245, 334],
      ["Issues", COLUMN_X[2], 268, 245, 334],
    ]);
    const at = (id: string) => {
      const node = inner.nodes.find((candidate) => candidate.id === id);
      return node && [node.x, node.y];
    };
    expect([at(CONTROLLER), at("src/jobs/SendReminderJob.ts")]).toEqual([[240, 50], [408, 50]]);
    expect(inner.nodes.find((node) => node.id === DOCUMENT_SERVICE)).toMatchObject({ x: 290, y: 176, w: 220 });
    expect(["src/db/repositories/DocumentRepository.ts", "src/integrations/storage/StorageClient.ts", "src/auth/PermissionPolicy.ts", "src/types/document.types.ts"].map(at)).toEqual([
      [NODE_X[0], 302], [NODE_X[0], 376], [NODE_X[0], 450], [NODE_X[0], 524],
    ]);
    expect(at("test/services/DocumentService.spec.ts")).toEqual([NODE_X[1], 302]);
    expect(at("expected:src/services/IDocumentService.ts")).toEqual([NODE_X[2], 302]);
  });

  it("puts expected files and circular imports in the issues column", () => {
    const { inner } = layout(cyclicView(), ui({ selected: "src/a/A.ts" }));
    expect(inner.floors.find((floor) => floor.key === "issues")?.cls).toBe("annex");
    expect(inner.nodes.find((node) => node.id === "src/a/B.ts")).toMatchObject({ x: NODE_X[2], tag: "Circular import" });
    expect(layout(view(), ui()).inner.nodes.find((node) => node.id === "expected:src/services/IDocumentService.ts")?.x).toBe(NODE_X[2]);
  });

  it("puts packages and the file under test in the imported-by-this-file column", () => {
    const spec = "test/a/A.spec.ts";
    const graph = graphOf([analysisOf(spec, ["src/a/A.ts", "pkg:vitest"]), analysisOf("src/a/A.ts")]);
    const { inner } = layout(buildViewData(graph, spec), ui({ selected: spec }));
    expect(inner.nodes.filter((node) => node.x === NODE_X[0]).map((node) => node.tag).sort()).toEqual(["Package", "Under test"]);
  });

  it("keeps an empty column with its title and an empty text", () => {
    const floors = layout(cyclicView(), ui({ selected: "src/a/A.ts" })).inner.floors;
    expect(floors.filter((floor) => floor.cls === "empty").map((floor) => [floor.title, floor.emptyText])).toEqual([
      ["Imports this file", "No file imports A.ts."],
      ["Imported by this file", "A.ts imports no project files."],
      ["Tests", "No test imports A.ts."],
    ]);
  });

  it("draws wires only from the callers to the open file", () => {
    const wires = layout(view(), ui()).inner.wires;
    expect(wires.map((wire) => wire.d)).toEqual(["M316 106 C316 141, 400 141, 400 176", "M484 106 C484 141, 400 141, 400 176"]);
    expect(layout(cyclicView(), ui({ selected: "src/a/A.ts" })).inner.wires).toEqual([]);
  });

  it("shows four nodes and a footer toggle when a floor has more", () => {
    const callers = Array.from({ length: 6 }, (_, index) => analysisOf(`src/c/C${index}.ts`, ["src/x.ts"]));
    const crowded = buildViewData(graphOf([analysisOf("src/x.ts"), ...callers]), "src/x.ts");
    const closed = layout(crowded, ui({ selected: "src/x.ts" })).inner.floors[0];
    expect(closed).toMatchObject({ h: 142, toggle: { text: "Show 2 more", icon: "plus", y: 128 } });
    const opened = layout(crowded, ui({ selected: "src/x.ts", open: { callers: true } }));
    expect(opened.inner.floors[0]).toMatchObject({ h: 216, toggle: { text: "Show fewer", icon: "minus" } });
    expect(opened.inner.nodes.filter((node) => node.id.startsWith("src/c/"))).toHaveLength(6);
  });

  it("caps a column at four nodes with a footer toggle and gives every column the same height", () => {
    const dependencies = Array.from({ length: 6 }, (_, index) => `src/d/D${index}.ts`);
    const crowded = buildViewData(graphOf([analysisOf("src/x.ts", dependencies), ...dependencies.map((path) => analysisOf(path))]), "src/x.ts");
    const closed = layout(crowded, ui({ selected: "src/x.ts" })).inner;
    expect(closed.floors.find((floor) => floor.key === "deps")).toMatchObject({ y: 220, h: 364, toggle: { text: "Show 2 more", icon: "plus", y: 554 } });
    expect(closed.nodes.filter((node) => node.id.startsWith("src/d/"))).toHaveLength(4);
    expect(closed.floors.find((floor) => floor.key === "tests")?.h).toBe(364);
    const opened = layout(crowded, ui({ selected: "src/x.ts", open: { deps: true } })).inner;
    expect(opened.floors.find((floor) => floor.key === "deps")).toMatchObject({ h: 512, toggle: { text: "Show fewer", icon: "minus" } });
    expect(opened.nodes.filter((node) => node.id.startsWith("src/d/")).map((node) => node.y)).toEqual([254, 328, 402, 476, 550, 624]);
  });

  it("brightens the wires of the selected node and fades the rest", () => {
    const wires = layout(view(), ui({ selected: CONTROLLER })).inner.wires;
    expect(wires.filter((wire) => wire.cls.endsWith(" hi"))).toHaveLength(1);
    expect(wires.every((wire) => wire.cls.endsWith(" hi") || wire.cls.endsWith(" lo"))).toBe(true);
  });

  it("shrinks the immediate layer into a frame for the second layer", () => {
    const result = layout(view(), ui({ layer: 2 }));
    expect(result.outer?.frame).toEqual({ x: 166, y: 172, w: 468, h: 369 });
    expect(result.outer?.transform).toBe("translate(176px, 182px) scale(0.56)");
    expect(["src/api/routes.ts", "src/jobs/scheduler.ts"].map((id) => result.outer?.nodes.find((node) => node.id === id)?.x)).toEqual([240, 408]);
    expect(result.outer?.floors.map((floor) => floor.title)).toEqual(["Second layer: imports the callers", "Second layer: imported by the immediate layer"]);
    expect(layout(view(), ui()).outer).toBeNull();
  });

  it("starts each second-layer wire below the frame at the column node it comes through", () => {
    const startOfHighlightedWire = (selected: string) => {
      const wire = layout(view(), ui({ layer: 2, selected })).outer?.wires.find((candidate) => candidate.cls.endsWith(" hi"));
      const [x, y] = wire!.d.slice(1).split(" ").map(Number);
      return { x, y };
    };
    const schema = startOfHighlightedWire("src/db/schema.ts");
    expect(schema.x).toBeCloseTo(176 + (NODE_X[0] + 76) * 0.56);
    expect(schema.y).toBe(541);
    expect(startOfHighlightedWire("test/fixtures/documents.fixture.ts").x).toBeCloseTo(176 + (NODE_X[1] + 76) * 0.56);
  });
});
