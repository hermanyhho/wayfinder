import { describe, expect, it } from "vitest";
import { buildViewData } from "../../../src/graph/neighbourhood";
import { layout, memberAtLine, type UiState } from "../../../src/webview/layout";
import { DOCUMENT_SERVICE, analysisOf, graphOf, serviceGraph } from "../helpers/fixtures";

const ui = (patch: Partial<UiState> = {}): UiState => ({ selected: DOCUMENT_SERVICE, layer: 1, open: {}, ...patch });
const view = () => buildViewData(serviceGraph(), DOCUMENT_SERVICE);
const CONTROLLER = "src/api/controllers/DocumentController.ts";
const COLUMN_X = [16, 277, 538];
const NODE_X = [30, 291, 552];
const COLUMN_NODE_W = 217;
const cyclicView = () => buildViewData(graphOf([analysisOf("src/a/A.ts", ["src/a/B.ts"]), analysisOf("src/a/B.ts", ["src/a/A.ts"])]), "src/a/A.ts");

describe("layout", () => {
  it("puts the callers above the open file and three columns below it, members in the middle and tests on the right", () => {
    const { inner } = layout(view(), ui(), 800);
    expect(inner.floors.map((floor) => [floor.title, floor.x, floor.y, floor.w, floor.h])).toEqual([
      ["Imports this file", 16, 16, 768, 112],
      ["Same folder", 16, 168, 768, 112],
      ["Imported by this file (4)", COLUMN_X[0], 320, 245, 434],
      ["Members", COLUMN_X[1], 320, 245, 434],
      ["Tests (1)", COLUMN_X[2], 320, 245, 434],
    ]);
    const at = (id: string) => {
      const node = inner.nodes.find((candidate) => candidate.id === id);
      return node && [node.x, node.y];
    };
    expect([at(CONTROLLER), at("src/jobs/SendReminderJob.ts")]).toEqual([[240, 50], [408, 50]]);
    expect(inner.nodes.find((node) => node.id === DOCUMENT_SERVICE)).toMatchObject({ x: 290, y: 202, w: 220 });
    expect(["src/db/repositories/DocumentRepository.ts", "src/auth/PermissionPolicy.ts", "src/integrations/storage/StorageClient.ts", "src/types/document.types.ts"].map(at)).toEqual([
      [NODE_X[0], 414], [NODE_X[0], 488], [NODE_X[0], 562], [NODE_X[0], 676],
    ]);
    expect(inner.groupHeadings.map((heading) => [heading.text, heading.y])).toEqual([["Dependencies (3)", 388], ["Types (1)", 650]]);
    expect(at("test/services/DocumentService.spec.ts")).toEqual([NODE_X[2], 388]);
    expect(at("expected:src/services/IDocumentService.ts")).toBeUndefined();
  });

  it("puts a circular import in the imported-by-this-file column without a wire of its own", () => {
    const { inner } = layout(cyclicView(), ui({ selected: "src/a/A.ts" }), 800);
    const cycleNode = inner.nodes.find((node) => node.id === "src/a/B.ts");
    expect(cycleNode).toMatchObject({ x: NODE_X[0], tag: "Circular import" });
    expect(cycleNode?.cls.split(" ")).toContain("red");
    expect(inner.wires.filter((wire) => wire.cls.startsWith("red"))).toEqual([]);
  });

  it("places a circular import at the top of its column even when other imports come first", () => {
    const graph = graphOf([
      analysisOf("src/a/A.ts", ["src/a/C.ts", "src/a/D.ts", "src/a/B.ts"]),
      analysisOf("src/a/B.ts", ["src/a/A.ts"]),
      analysisOf("src/a/C.ts"),
      analysisOf("src/a/D.ts"),
    ]);
    const { inner } = layout(buildViewData(graph, "src/a/A.ts"), ui({ selected: "src/a/A.ts" }), 800);
    const firstColumn = inner.nodes.filter((node) => node.x === NODE_X[0]).sort((above, below) => above.y - below.y);
    expect(firstColumn.map((node) => node.id)).toEqual(["src/a/B.ts", "src/a/C.ts", "src/a/D.ts"]);
    expect(inner.wires.filter((wire) => wire.cls.startsWith("red"))).toEqual([]);
  });

  it("leaves missing expected files off the map", () => {
    const { inner } = layout(view(), ui(), 800);
    expect(inner.floors.map((floor) => floor.key)).toEqual(["callers", "mine", "deps", "members", "tests"]);
    expect(inner.nodes.some((node) => node.id.startsWith("expected:"))).toBe(false);
  });

  it("puts packages in the imported-by-this-file column and the tested file in the right column", () => {
    const spec = "test/a/A.spec.ts";
    const graph = graphOf([analysisOf(spec, ["src/a/A.ts", "pkg:vitest"]), analysisOf("src/a/A.ts")]);
    const { inner } = layout(buildViewData(graph, spec), ui({ selected: spec }), 800);
    expect(inner.nodes.filter((node) => node.x === NODE_X[0]).map((node) => node.tag)).toEqual(["Package"]);
    expect(inner.nodes.filter((node) => node.x === NODE_X[2]).map((node) => node.tag)).toEqual(["Tested file"]);
  });

  it("keeps an empty column with its title and an empty text", () => {
    const floors = layout(cyclicView(), ui({ selected: "src/a/A.ts" }), 800).inner.floors;
    expect(floors.filter((floor) => floor.cls === "empty").map((floor) => [floor.title, floor.emptyText])).toEqual([
      ["Imports this file", "No file imports A.ts."],
      ["Members", "A.ts defines no members."],
      ["Tests", "No test imports A.ts."],
    ]);
  });

  it("draws wires from the callers to the open file and from the open file to the top of each column", () => {
    const wires = layout(view(), ui(), 800).inner.wires;
    expect(wires.map((wire) => wire.d)).toEqual([
      "M316 106 C316 154, 400 154, 400 202",
      "M484 106 C484 154, 400 154, 400 202",
      "M400 266 C400 293, 139 293, 139 320",
      "M400 266 C400 293, 400 293, 400 320",
      "M400 266 C400 293, 661 293, 661 320",
    ]);
  });

  it("brightens the wire of the column that holds the selected node and fades the rest", () => {
    const wires = layout(view(), ui({ selected: "src/db/repositories/DocumentRepository.ts" }), 800).inner.wires;
    expect(wires.map((wire) => wire.cls.split(" ").pop())).toEqual(["lo", "lo", "hi", "lo", "lo"]);
    const testWires = layout(view(), ui({ selected: "test/services/DocumentService.spec.ts" }), 800).inner.wires;
    expect(testWires.slice(2).map((wire) => wire.cls.split(" ").pop())).toEqual(["lo", "lo", "hi"]);
  });

  it("makes column nodes as wide as their column minus 14px on each side", () => {
    const columnNodes = (width: number) => {
      const { inner } = layout(view(), ui(), width);
      const columns = inner.floors.filter((floor) => ["deps", "members", "tests"].includes(floor.key));
      return inner.nodes
        .filter((node) => node.y > columns[0].y)
        .map((node) => ({ node, column: columns.find((column) => node.x >= column.x && node.x < column.x + column.w)! }));
    };
    for (const width of [800, 1200]) {
      const placed = columnNodes(width);
      expect(placed.length).toBeGreaterThan(0);
      for (const { node, column } of placed) expect([node.x, node.w]).toEqual([column.x + 14, column.w - 28]);
    }
    expect(columnNodes(800)[0].node.w).toBe(COLUMN_NODE_W);
  });

  it("spreads floors and columns over the width it is given and keeps row nodes at 152px", () => {
    const { inner } = layout(view(), ui(), 1200);
    expect(inner.floors.map((floor) => [floor.key, floor.x, floor.w])).toEqual([
      ["callers", 16, 1168], ["mine", 16, 1168], ["deps", 16, 378], ["members", 410, 378], ["tests", 804, 378],
    ]);
    expect(inner.nodes.find((node) => node.id === CONTROLLER)).toMatchObject({ x: 440, w: 152 });
    expect(inner.nodes.find((node) => node.id === DOCUMENT_SERVICE)).toMatchObject({ x: 490, w: 220 });
    expect(inner.wires.slice(2).map((wire) => wire.d)).toEqual([
      "M600 266 C600 293, 205 293, 205 320",
      "M600 266 C600 293, 599 293, 599 320",
      "M600 266 C600 293, 993 293, 993 320",
    ]);
  });

  it("centres the second-layer frame at the width it is given", () => {
    const result = layout(view(), ui({ layer: 2 }), 1200);
    expect(result.outer?.frame).toMatchObject({ x: 254, w: 692 });
    expect(result.outer?.transform).toBe("translate(264px, 182px) scale(0.56)");
    expect(result.outer?.nodes.find((node) => node.id === "src/api/routes.ts")).toMatchObject({ x: 440, w: 152 });
  });

  it("shows four nodes and a footer toggle when a floor has more", () => {
    const callers = Array.from({ length: 6 }, (_, index) => analysisOf(`src/c/C${index}.ts`, ["src/x.ts"]));
    const crowded = buildViewData(graphOf([analysisOf("src/x.ts"), ...callers]), "src/x.ts");
    const closed = layout(crowded, ui({ selected: "src/x.ts" }), 800).inner.floors[0];
    expect(closed).toMatchObject({ h: 142, toggle: { text: "Show 2 more", icon: "plus", y: 128 } });
    const opened = layout(crowded, ui({ selected: "src/x.ts", open: { callers: true } }), 800);
    expect(opened.inner.floors[0]).toMatchObject({ h: 216, toggle: { text: "Show fewer", icon: "minus" } });
    expect(opened.inner.nodes.filter((node) => node.id.startsWith("src/c/"))).toHaveLength(6);
  });

  it("caps a group at four cards with its own toggle and gives every column the same height", () => {
    const dependencies = Array.from({ length: 6 }, (_, index) => `src/d/D${index}.ts`);
    const crowded = buildViewData(graphOf([analysisOf("src/x.ts", dependencies), ...dependencies.map((path) => analysisOf(path))]), "src/x.ts");
    const closed = layout(crowded, ui({ selected: "src/x.ts" }), 800).inner;
    expect(closed.floors.find((floor) => floor.key === "deps")).toMatchObject({ y: 272, h: 422, toggle: null });
    expect(closed.groupToggles).toEqual([{ key: "deps:dependency:more", x: NODE_X[0], y: 656, text: "Show 2 more", icon: "plus" }]);
    expect(closed.nodes.filter((node) => node.id.startsWith("src/d/"))).toHaveLength(4);
    expect(closed.floors.find((floor) => floor.key === "tests")?.h).toBe(422);
    const opened = layout(crowded, ui({ selected: "src/x.ts", open: { "deps:dependency:more": true } }), 800).inner;
    expect(opened.floors.find((floor) => floor.key === "deps")?.h).toBe(570);
    expect(opened.groupToggles).toMatchObject([{ text: "Show fewer", icon: "minus" }]);
    expect(opened.nodes.filter((node) => node.id.startsWith("src/d/")).map((node) => node.y)).toEqual([366, 440, 514, 588, 662, 736]);
  });

  const documentServiceMembers = [
    { name: "DocumentService", kind: "class" as const, line: 6, endLine: 23, exported: true },
    { name: "documents", kind: "property" as const, line: 8, endLine: 8, exported: false, className: "DocumentService" },
    { name: "storage", kind: "property" as const, line: 9, endLine: 9, exported: false, className: "DocumentService" },
    { name: "permissions", kind: "property" as const, line: 10, endLine: 10, exported: false, className: "DocumentService" },
    { name: "upload", kind: "method" as const, line: 18, endLine: 22, exported: true, className: "DocumentService" },
    { name: "listForEmployee", kind: "method" as const, line: 13, endLine: 16, exported: true, className: "DocumentService" },
  ];

  it("groups members by kind in a fixed order, sorts each group A-Z and keeps kind, class and exported mark", () => {
    const { inner } = layout({ ...view(), members: documentServiceMembers }, ui(), 800);
    expect(inner.floors.find((floor) => floor.key === "members")).toMatchObject({ title: "Members (6)", cls: "", emptyText: "", toggle: null });
    expect(inner.groupHeadings.filter((heading) => heading.key.startsWith("members:")).map((heading) => [heading.text, heading.kind, heading.y])).toEqual([
      ["Classes (1)", "class", 388], ["Properties (3)", "property", 502], ["Methods (2)", "method", 764],
    ]);
    expect(inner.members.map((member) => [member.x, member.y, member.w, member.tag, member.name, member.path, member.line])).toEqual([
      [NODE_X[1], 414, COLUMN_NODE_W, "class", "DocumentService", "exported", 6],
      [NODE_X[1], 528, COLUMN_NODE_W, "property", "documents", "DocumentService", 8],
      [NODE_X[1], 602, COLUMN_NODE_W, "property", "permissions", "DocumentService", 10],
      [NODE_X[1], 676, COLUMN_NODE_W, "property", "storage", "DocumentService", 9],
      [NODE_X[1], 790, COLUMN_NODE_W, "method", "listForEmployee", "DocumentService, exported", 13],
      [NODE_X[1], 864, COLUMN_NODE_W, "method", "upload", "DocumentService, exported", 18],
    ]);
    expect(inner.nodes.some((node) => node.id.startsWith("member:"))).toBe(false);
  });

  it("lists tests in one ungrouped column sorted A-Z", () => {
    const tests = ["test/c.spec.ts", "test/a.spec.ts", "test/b.spec.ts"];
    const graph = graphOf([analysisOf("src/x.ts"), ...tests.map((path) => analysisOf(path, ["src/x.ts"]))]);
    const { inner } = layout(buildViewData(graph, "src/x.ts"), ui({ selected: "src/x.ts" }), 800);
    expect(inner.floors.find((floor) => floor.key === "tests")?.title).toBe("Tests (3)");
    expect(inner.groupHeadings.filter((heading) => heading.key.startsWith("tests"))).toEqual([]);
    expect(tests.map((path) => inner.nodes.find((node) => node.id === path)!).sort((left, right) => left.y - right.y).map((node) => node.id)).toEqual([
      "test/a.spec.ts", "test/b.spec.ts", "test/c.spec.ts",
    ]);
  });

  it("caps a members group at four cards with its own toggle", () => {
    const methods = ["a", "b", "c", "d", "e"].map((name, index) => ({ name, kind: "method" as const, line: index + 1, endLine: index + 1, exported: false, className: "K" }));
    const closed = layout({ ...view(), members: methods }, ui(), 800).inner;
    expect(closed.members).toHaveLength(4);
    expect(closed.groupToggles.filter((toggle) => toggle.key === "members:method:more")).toMatchObject([{ text: "Show 1 more" }]);
    const opened = layout({ ...view(), members: methods }, ui({ open: { "members:method:more": true } }), 800).inner;
    expect(opened.members).toHaveLength(5);
  });

  it("shows member groups in the same order whatever the source order", () => {
    const groupOrder = (members: typeof documentServiceMembers) =>
      layout({ ...view(), members }, ui(), 800).inner.groupHeadings.filter((heading) => heading.key.startsWith("members:")).map((heading) => heading.text);
    expect(groupOrder([...documentServiceMembers].reverse())).toEqual(groupOrder(documentServiceMembers));
  });

  it("groups imports in the order circular imports, dependencies, types, packages", () => {
    const spec = "test/a/A.spec.ts";
    const graph = graphOf([
      analysisOf(spec, ["pkg:vitest", "src/a/A.ts", "src/a/A.types.ts", "src/a/Z.ts", "test/a/B.ts"]),
      analysisOf("src/a/A.ts"), analysisOf("src/a/A.types.ts"), analysisOf("src/a/Z.ts"), analysisOf("test/a/B.ts", [spec]),
    ]);
    const { inner } = layout(buildViewData(graph, spec), ui({ selected: spec }), 800);
    expect(inner.groupHeadings.filter((heading) => heading.key.startsWith("deps:")).map((heading) => heading.text)).toEqual(["Circular imports (1)", "Dependencies (1)", "Types (1)", "Packages (1)"]);
  });

  it("hides the cards of a collapsed group and shortens the column", () => {
    const expanded = layout({ ...view(), members: documentServiceMembers }, ui(), 800).inner;
    const collapsed = layout({ ...view(), members: documentServiceMembers }, ui({ open: { "members:method:collapsed": true } }), 800).inner;
    expect(collapsed.members.map((member) => member.name)).toEqual(["DocumentService", "documents", "permissions", "storage"]);
    expect(collapsed.groupHeadings.find((heading) => heading.key === "members:method:collapsed")).toMatchObject({ text: "Methods (2)", collapsed: true });
    expect(collapsed.floors.find((floor) => floor.key === "members")!.h).toBe(expanded.floors.find((floor) => floor.key === "members")!.h - 2 * 74);
  });

  it("finds the innermost member around a line, a method before its class", () => {
    const nameAt = (line: number) => documentServiceMembers[memberAtLine(documentServiceMembers, line)]?.name;
    expect([nameAt(20), nameAt(17), nameAt(23), nameAt(2)]).toEqual(["upload", "DocumentService", "DocumentService", undefined]);
    const oneLine = [
      { name: "A", kind: "class" as const, line: 1, endLine: 1, exported: false },
      { name: "run", kind: "method" as const, line: 1, endLine: 1, exported: false, className: "A" },
    ];
    expect(memberAtLine(oneLine, 1)).toBe(1);
  });

  it("includes the first and last line of a member and excludes the lines around it", () => {
    const method = [{ name: "run", kind: "method" as const, line: 5, endLine: 8, exported: false, className: "K" }];
    expect([4, 5, 8, 9].map((line) => memberAtLine(method, line))).toEqual([-1, 0, 0, -1]);
  });

  it("finds no member in an empty list", () => {
    expect(memberAtLine([], 1)).toBe(-1);
  });

  it("highlights nothing when the cursor line is unknown", () => {
    const { inner } = layout({ ...view(), members: documentServiceMembers }, ui(), 800);
    expect(inner.members.some((member) => member.cls.includes("cur"))).toBe(false);
  });

  it("marks the member card at the cursor without selecting it", () => {
    const { inner } = layout({ ...view(), members: documentServiceMembers }, ui({ cursorLine: 20 }), 800);
    expect(inner.members.filter((member) => member.cls.includes("cur")).map((member) => member.name)).toEqual(["upload"]);
    expect(inner.groupHeadings.some((heading) => heading.cls.includes("cur"))).toBe(false);
    expect(inner.nodes.find((node) => node.id === DOCUMENT_SERVICE)?.cls).toContain("sel");
  });

  it("marks the group heading when the member at the cursor is hidden", () => {
    const collapsed = layout({ ...view(), members: documentServiceMembers }, ui({ cursorLine: 20, open: { "members:method:collapsed": true } }), 800).inner;
    expect(collapsed.groupHeadings.filter((heading) => heading.cls.includes("cur")).map((heading) => heading.key)).toEqual(["members:method:collapsed"]);
    expect(collapsed.members.some((member) => member.cls.includes("cur"))).toBe(false);
    const methods = ["a", "b", "c", "d", "e"].map((name, index) => ({ name, kind: "method" as const, line: index + 1, endLine: index + 1, exported: false, className: "K" }));
    const pastShowMore = layout({ ...view(), members: methods }, ui({ cursorLine: 5 }), 800).inner;
    expect(pastShowMore.groupHeadings.filter((heading) => heading.cls.includes("cur")).map((heading) => heading.key)).toEqual(["members:method:collapsed"]);
  });

  it("shows only the members whose name contains the search text, ignoring case, and leaves other columns unfiltered", () => {
    const { inner } = layout({ ...view(), members: documentServiceMembers }, ui(), 800, { members: "ST" });
    expect(inner.members.map((member) => member.name)).toEqual(["storage", "listForEmployee"]);
    expect(inner.groupHeadings.filter((heading) => heading.key.startsWith("members:")).map((heading) => heading.text)).toEqual(["Properties (1)", "Methods (1)"]);
    expect(inner.floors.find((floor) => floor.key === "members")).toMatchObject({ title: "Members (6)", search: "ST", emptyText: "" });
    expect(inner.nodes.filter((node) => node.x === NODE_X[0])).toHaveLength(4);
  });

  it("shows a search match that sits in a collapsed group or past the four-card cap, without a group toggle", () => {
    const methods = ["a", "b", "c", "d", "match"].map((name, index) => ({ name, kind: "method" as const, line: index + 1, endLine: index + 1, exported: false, className: "K" }));
    const { inner } = layout({ ...view(), members: methods }, ui({ open: { "members:method:collapsed": true } }), 800, { members: "match" });
    expect(inner.members.map((member) => member.name)).toEqual(["match"]);
    expect(inner.groupHeadings.find((heading) => heading.key === "members:method:collapsed")).toMatchObject({ collapsed: false });
    expect(inner.groupToggles.filter((toggle) => toggle.key.startsWith("members:"))).toEqual([]);
  });

  it("says no match when the search text matches no card in the column", () => {
    const { inner } = layout({ ...view(), members: documentServiceMembers }, ui(), 800, { members: "zzz" });
    expect(inner.members).toEqual([]);
    expect(inner.groupHeadings.filter((heading) => heading.key.startsWith("members:"))).toEqual([]);
    expect(inner.floors.find((floor) => floor.key === "members")).toMatchObject({ title: "Members (6)", emptyText: 'No match for "zzz".' });
  });

  it("filters the imported-by-this-file and tests columns by their own search text and drops groups with no match", () => {
    const { inner } = layout(view(), ui(), 800, { deps: "STORAGE", tests: "spec" });
    expect(inner.nodes.filter((node) => node.x === NODE_X[0]).map((node) => node.id)).toEqual(["src/integrations/storage/StorageClient.ts"]);
    expect(inner.groupHeadings.filter((heading) => heading.key.startsWith("deps:")).map((heading) => heading.text)).toEqual(["Dependencies (1)"]);
    expect(inner.floors.find((floor) => floor.key === "deps")).toMatchObject({ title: "Imported by this file (4)", search: "STORAGE" });
    expect(inner.nodes.filter((node) => node.x === NODE_X[2])).toHaveLength(1);
    expect(inner.nodes.filter((node) => node.x === NODE_X[1])).toHaveLength(0);
  });

  it("says no match in the tests column when no test name contains the search text", () => {
    const { inner } = layout(view(), ui(), 800, { tests: "nothing" });
    expect(inner.nodes.filter((node) => node.x === NODE_X[2])).toEqual([]);
    expect(inner.floors.find((floor) => floor.key === "tests")).toMatchObject({ title: "Tests (1)", emptyText: 'No match for "nothing".' });
  });

  it("brightens the wires of the selected node and fades the rest", () => {
    const wires = layout(view(), ui({ selected: CONTROLLER }), 800).inner.wires;
    expect(wires.filter((wire) => wire.cls.endsWith(" hi"))).toHaveLength(1);
    expect(wires.every((wire) => wire.cls.endsWith(" hi") || wire.cls.endsWith(" lo"))).toBe(true);
  });

  it("shrinks the immediate layer into a frame for the second layer", () => {
    const result = layout(view(), ui({ layer: 2 }), 800);
    expect(result.outer?.frame).toEqual({ x: 166, y: 172, w: 468, h: 455 });
    expect(result.outer?.transform).toBe("translate(176px, 182px) scale(0.56)");
    expect(["src/api/routes.ts", "src/jobs/scheduler.ts"].map((id) => result.outer?.nodes.find((node) => node.id === id)?.x)).toEqual([240, 408]);
    expect(result.outer?.floors.map((floor) => floor.title)).toEqual(["Second layer: imports the callers", "Second layer: imported by the immediate layer"]);
    expect(layout(view(), ui(), 800).outer).toBeNull();
  });

  it("starts each second-layer wire below the frame at the column node it comes through, or its group heading when collapsed", () => {
    const startOfHighlightedWire = (selected: string, open: Record<string, boolean> = {}) => {
      const wire = layout(view(), ui({ layer: 2, selected, open }), 800).outer?.wires.find((candidate) => candidate.cls.endsWith(" hi"));
      const [x, y] = wire!.d.slice(1).split(" ").map(Number);
      return { x, y };
    };
    const schema = startOfHighlightedWire("src/db/schema.ts");
    expect(schema.x).toBeCloseTo(176 + (NODE_X[0] + COLUMN_NODE_W / 2) * 0.56);
    expect(schema.y).toBe(627);
    expect(startOfHighlightedWire("src/db/schema.ts", { "deps:dependency:collapsed": true }).x).toBeCloseTo(176 + (NODE_X[0] + COLUMN_NODE_W / 2) * 0.56);
    expect(startOfHighlightedWire("test/fixtures/documents.fixture.ts").x).toBeCloseTo(176 + (NODE_X[2] + COLUMN_NODE_W / 2) * 0.56);
  });
});

describe("when the open file is a test file", () => {
  const unlinkRelatedTestCases = [
    { name: "Group/hooks/UnlinkRelated", kind: "suite" as const, line: 5, endLine: 30, exported: false },
    { name: "unlinks the related group", kind: "test" as const, line: 6, endLine: 9, exported: false, suiteTitle: "Group/hooks/UnlinkRelated" },
    { name: "keeps the group", kind: "test" as const, line: 10, endLine: 12, exported: false, suiteTitle: "Group/hooks/UnlinkRelated", focus: "skip" as const },
    { name: "when nothing is linked", kind: "suite" as const, line: 13, endLine: 29, exported: false, suiteTitle: "Group/hooks/UnlinkRelated" },
    { name: "does nothing", kind: "test" as const, line: 14, endLine: 20, exported: false, suiteTitle: "when nothing is linked", focus: "only" as const },
  ];
  const layoutTestFile = (patch: Partial<UiState> = {}) => layout({ ...view(), members: unlinkRelatedTestCases }, ui(patch), 800).inner;

  it("should group suites then tests, each in source order, with the describe title and focus on each card", () => {
    const inner = layoutTestFile();

    expect(inner.groupHeadings.filter((heading) => heading.key.startsWith("members:")).map((heading) => heading.text)).toEqual(["Test groups (2)", "Test cases (3)"]);
    expect(inner.members.map((member) => [member.tag, member.name, member.path, member.line, member.focus])).toEqual([
      ["test group", "Group/hooks/UnlinkRelated", "", 5, undefined],
      ["test group", "when nothing is linked", "Group/hooks/UnlinkRelated", 13, undefined],
      ["test case", "unlinks the related group", "Group/hooks/UnlinkRelated", 6, undefined],
      ["test case", "keeps the group", "Group/hooks/UnlinkRelated", 10, "skip"],
      ["test case", "does nothing", "when nothing is linked", 14, "only"],
    ]);
  });

  it("should give each card a tooltip with the full name, the parent test group and the line", () => {
    const inner = layoutTestFile();

    expect(inner.members.map((member) => member.tooltip)).toEqual([
      "Group/hooks/UnlinkRelated\nGo to line 5",
      "when nothing is linked\nGroup/hooks/UnlinkRelated\nGo to line 13",
      "unlinks the related group\nGroup/hooks/UnlinkRelated\nGo to line 6",
      "keeps the group\nGroup/hooks/UnlinkRelated\nGo to line 10",
      "does nothing\nwhen nothing is linked\nGo to line 14",
    ]);
  });

  it("should mark the innermost test the cursor is in", () => {
    const inner = layoutTestFile({ cursorLine: 16 });

    expect(inner.members.filter((member) => member.cls.includes("cur")).map((member) => member.name)).toEqual(["does nothing"]);
  });
});

describe("when a test file is open", () => {
  const TEST = "src/a/__tests__/Foo.int.test.ts";
  const testsColumnOf = (graph: ReturnType<typeof graphOf>) => layout(buildViewData(graph, TEST), ui({ selected: TEST }), 800).inner.floors.find((floor) => floor.key === "tests")!;
  const testedFileCardOf = (graph: ReturnType<typeof graphOf>) => layout(buildViewData(graph, TEST), ui({ selected: TEST }), 800).inner.nodes.find((node) => node.id === "src/a/Foo.ts");

  it("should group the tested file and the other tests of it under their own headings", () => {
    const graph = graphOf([analysisOf("src/a/Foo.ts"), analysisOf("src/a/Foo.test.ts", ["src/a/Foo.ts"]), analysisOf(TEST, ["src/a/Foo.ts"])]);

    const inner = layout(buildViewData(graph, TEST), ui({ selected: TEST }), 800).inner;

    expect(inner.floors.find((floor) => floor.key === "tests")?.title).toBe("Tested code (2)");
    expect(inner.groupHeadings.filter((heading) => heading.key.startsWith("tests:")).map((heading) => heading.text)).toEqual(["Tested file (1)", "Other tests (1)"]);
  });

  it("should tag a tested file the test imports as Tested file", () => {
    const graph = graphOf([analysisOf("src/a/Foo.ts"), analysisOf(TEST, ["src/a/Foo.ts"])]);

    const card = testedFileCardOf(graph);

    expect(card).toMatchObject({ x: NODE_X[2], tag: "Tested file" });
  });

  it("should tag a tested file found by name only as matched by name", () => {
    const graph = graphOf([analysisOf("src/a/Foo.ts"), analysisOf(TEST)]);

    const card = testedFileCardOf(graph);

    expect(card).toMatchObject({ x: NODE_X[2], tag: "Tested file, matched by name" });
  });

  it("should say no tested code was found when nothing matches", () => {
    const graph = graphOf([analysisOf("src/a/Bar.ts"), analysisOf(TEST)]);

    const column = testsColumnOf(graph);

    expect(column).toMatchObject({ title: "Tested code", emptyText: "No tested code found for Foo.int.test.ts." });
  });
});

describe("when members of the open file carry their usage", () => {
  const SERVICE = "src/services/GroupService.ts";
  const remove = {
    name: "remove", kind: "method" as const, line: 41, endLine: 44, exported: true, className: "GroupService",
    usedIn: [{ file: "src/api/GroupController.ts", line: 7 }, { file: "src/jobs/cleanUp.ts", line: 4 }], usedInOwnFile: false,
  };
  const rename = { name: "rename", kind: "method" as const, line: 30, endLine: 33, exported: true, className: "GroupService", usedIn: [], usedInOwnFile: true };
  const unused = { name: "unused", kind: "function" as const, line: 50, endLine: 50, exported: false, usedIn: [], usedInOwnFile: false };
  const membersLaidOut = (open: Record<string, boolean> = {}) => {
    const serviceView = { ...buildViewData(graphOf([analysisOf(SERVICE)]), SERVICE), members: [remove, rename, unused] };
    return layout(serviceView, ui({ selected: SERVICE, open }), 800).inner.members;
  };
  const cardNamed = (members: ReturnType<typeof membersLaidOut>, name: string) => members.find((member) => member.name === name)!;

  it("should show the number of files that use a member with a key to open the list", () => {
    const card = cardNamed(membersLaidOut(), "remove");

    expect(card.usage).toEqual({ text: "used in 2 files", listKey: "uses:GroupService.remove", list: null });
  });

  it("should say a member is only used in its own file, with nothing to open", () => {
    const card = cardNamed(membersLaidOut(), "rename");

    expect(card.usage).toEqual({ text: "only used in this file", listKey: null, list: null });
  });

  it("should say no file in the repo uses a member", () => {
    const card = cardNamed(membersLaidOut(), "unused");

    expect(card.usage).toEqual({ text: "no use in this repo", listKey: null, list: null });
  });

  it("should leave room for the usage row before the next card", () => {
    const members = membersLaidOut();

    expect(cardNamed(members, "rename").y - cardNamed(members, "remove").y).toBe(72 + 74 - 56);
  });

  it("should list the files indented under the card and push the next card down when the list is open", () => {
    const members = membersLaidOut({ "uses:GroupService.remove": true });

    const card = cardNamed(members, "remove");

    expect(card.usage?.list).toEqual({ x: card.x + 14, y: card.y + 72 + 6, w: card.w - 14, uses: remove.usedIn });
    expect(cardNamed(members, "rename").y - card.y).toBe(72 + 74 - 56 + 6 + 2 * 22);
  });
});
