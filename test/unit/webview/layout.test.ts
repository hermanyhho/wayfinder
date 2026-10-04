import { describe, expect, it } from "vitest";
import { buildViewData } from "../../../src/graph/neighbourhood";
import { layout, type UiState } from "../../../src/webview/layout";
import { DOCUMENT_SERVICE, analysisOf, graphOf, serviceGraph } from "../helpers/fixtures";

const ui = (patch: Partial<UiState> = {}): UiState => ({ selected: DOCUMENT_SERVICE, layer: 1, open: {}, ...patch });
const view = () => buildViewData(serviceGraph(), DOCUMENT_SERVICE);
const CONTROLLER = "src/api/controllers/DocumentController.ts";

describe("layout", () => {
  it("stacks the four floors and centres each row", () => {
    const { inner } = layout(view(), ui());
    expect(inner.floors.map((floor) => [floor.title, floor.y, floor.h])).toEqual([
      ["Imports this file", 16, 112],
      ["Same folder", 142, 112],
      ["Imported by this file", 268, 112],
      ["Tests", 394, 112],
    ]);
    const x = (id: string) => inner.nodes.find((node) => node.id === id)?.x;
    expect([x(CONTROLLER), x("src/jobs/SendReminderJob.ts")]).toEqual([196, 364]);
    expect(inner.nodes.find((node) => node.id === DOCUMENT_SERVICE)).toMatchObject({ x: 380, y: 176, w: 220 });
    expect(x("expected:src/services/IDocumentService.ts")).toBe(28);
    expect(x("test/services/DocumentService.spec.ts")).toBe(280);
  });

  it("routes the test wire along the right-hand lane", () => {
    const testWire = layout(view(), ui()).inner.wires.find((wire) => wire.cls.startsWith("pink"));
    expect(testWire?.d.startsWith("M356 484 V487")).toBe(true);
  });

  it("draws a circular import as two side-by-side wires on the same floor, labelled above", () => {
    const cyclic = buildViewData(graphOf([analysisOf("src/a/A.ts", ["src/a/B.ts"]), analysisOf("src/a/B.ts", ["src/a/A.ts"])]), "src/a/A.ts");
    const { inner } = layout(cyclic, ui({ selected: "src/a/A.ts" }));
    expect(inner.wires.map((wire) => wire.d)).toEqual(["M380 152 C280 152, 280 152, 180 152", "M180 168 C280 168, 280 168, 380 168"]);
    expect(inner.labels).toEqual([{ cls: "red", x: 280, y: 138, text: "circular import" }]);
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

  it("brightens the wires of the selected node and fades the rest", () => {
    const wires = layout(view(), ui({ selected: CONTROLLER })).inner.wires;
    expect(wires.filter((wire) => wire.cls.endsWith(" hi"))).toHaveLength(1);
    expect(wires.every((wire) => wire.cls.endsWith(" hi") || wire.cls.endsWith(" lo"))).toBe(true);
  });

  it("shrinks the immediate layer into a frame for the second layer", () => {
    const result = layout(view(), ui({ layer: 2 }));
    expect(result.outer?.frame).toEqual({ x: 166, y: 172, w: 468, h: 356 });
    expect(result.outer?.transform).toBe("translate(176px, 182px) scale(0.56)");
    expect(result.outer?.floors.map((floor) => floor.title)).toEqual(["Second layer: imports the callers", "Second layer: imported by the immediate layer"]);
    expect(layout(view(), ui()).outer).toBeNull();
  });
});
