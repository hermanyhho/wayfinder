import type { Fact, Implementation, Member, MemberKind, MemberUse, MemberVisibility, NodeKind, ViewData, ViewNode } from "../shared/viewData";

export const NODE_W = 152;
export const NODE_H = 56;
export const MEMBER_WITH_USAGE_H = 72;
export const USE_ENTRY_H = 22;
const USES_LIST_GAP = 6;
const USES_LIST_INDENT = 14;
export const HERE_W = 220;
export const HERE_H = 64;
export const COL_GAP = 16;
export const FLOOR_GAP = 40;
export const ROW_H = 74;
export const MAX_PER_ROW = 4;
export const MAX_PER_GROUP = 4;
const GROUP_HEADING_H = 26;
const GROUP_TOGGLE_H = 28;
const GROUP_GAP = 14;
export const FLOOR_LEFT = 16;
export const MIN_CANVAS_W = 800;
export const MAX_CANVAS_W = 1280;
const COLUMN_PADDING = 14;
const COLUMN_SEARCH_ROW_H = 34;
export const CLUSTER_SCALE = 0.56;

export interface UiState {
  selected: string;
  layer: 1 | 2;
  open: Record<string, boolean>;
  /** 1-based line of the editor cursor in the open file */
  cursorLine?: number;
}

export type ColumnKey = "deps" | "members" | "tests";
export type SearchByColumn = Partial<Record<ColumnKey, string>>;

export interface Box { x: number; y: number; w: number; h: number; floor: number; }
export interface FloorToggle { text: string; icon: "plus" | "minus"; y: number; }
export type GroupKind = MemberKind | NodeKind;
export interface GroupHeadingView { key: string; x: number; y: number; w: number; cls: string; kind: GroupKind; text: string; collapsed: boolean; }
export interface GroupToggleView extends FloorToggle { key: string; x: number; }
export interface FloorView { key: string; title: string; path: string; cls: string; x: number; y: number; w: number; h: number; emptyText: string; toggle: FloorToggle | null; search?: string; }
export interface NodeView { id: string; x: number; y: number; w: number; cls: string; kind: NodeKind; tag: string; name: string; path: string; }
export interface UsesListView { x: number; y: number; w: number; uses: MemberUse[]; }
export interface MemberUsageView { text: string; listKey: string | null; list: UsesListView | null; }
export interface MemberView extends Omit<NodeView, "kind"> { kind: MemberKind; line: number; tooltip: string; focus?: Member["focus"]; visibility?: MemberVisibility; usage?: MemberUsageView; opensFile?: string; }
export interface WireView { cls: string; d: string; }
export interface PortView { cls: string; x: number; y: number; incoming: boolean; }
export interface BannerView { y: number; title: string; items: Fact[]; progress: number | null; }
export interface LayerView { floors: FloorView[]; nodes: NodeView[]; members: MemberView[]; groupHeadings: GroupHeadingView[]; groupToggles: GroupToggleView[]; wires: WireView[]; ports: PortView[]; banners: BannerView[]; height: number; }
export interface SecondLayerView extends LayerView { frame: { x: number; y: number; w: number; h: number }; transform: string; }
export interface Layout { width: number; inner: LayerView; outer: SecondLayerView | null; }

const KIND_COLOR: Record<NodeKind, string> = {
  here: "green", caller: "blue", dependency: "violet", types: "violet", test: "pink", subject: "pink", expected: "violet", cycle: "red", package: "grey",
};
const KIND_TAG: Record<NodeKind, string> = {
  here: "Current file", caller: "Caller", dependency: "Dependency", types: "Types", test: "Test", subject: "Tested file", expected: "Expected, not found", cycle: "Circular import", package: "Package",
};

export const colorOf = (node: ViewNode): string => (node.kind === "expected" && node.expectedKind === "test" ? "pink" : KIND_COLOR[node.kind]);

// missing expected files are listed in the Checks tab, so they get no card on the map
const COLUMN_OF_KIND: Record<Exclude<NodeKind, "here" | "caller" | "expected">, Exclude<ColumnKey, "members">> = {
  dependency: "deps", types: "deps", subject: "tests", package: "deps", cycle: "deps", test: "tests",
};
const columnOf = (node: ViewNode): ColumnKey | null =>
  node.kind === "here" || node.kind === "caller" || node.kind === "expected" ? null : COLUMN_OF_KIND[node.kind];

interface ColumnDef { key: ColumnKey; title: string; color: string; empty: (name: string) => string; }
const COLUMNS: ColumnDef[] = [
  { key: "deps", title: "Imported by this file", color: "violet", empty: (name) => `${name} imports no project files.` },
  { key: "members", title: "Members", color: "green", empty: (name) => `${name} defines no members.` },
  { key: "tests", title: "Tests", color: "pink", empty: (name) => `No test imports ${name}.` },
];
const TEST_FILE_TESTS_COLUMN: ColumnDef = { key: "tests", title: "Tested code", color: "pink", empty: (name) => `No tested code found for ${name}.` };
const IMPLEMENTED_BY_COLUMN: ColumnDef = { key: "tests", title: "Implemented by", color: "blue", empty: (name) => `No file implements or extends an interface of ${name}.` };
const IMPLEMENTATION_GROUPS: { kind: Implementation["kind"]; title: string }[] = [
  { kind: "class", title: "Classes" },
  { kind: "interface", title: "Extended by" },
];
const TEST_FILE_TEST_GROUPS: { kind: "subject" | "test"; title: string }[] = [
  { kind: "subject", title: "Tested file" },
  { kind: "test", title: "Other tests" },
];

const DEPENDENCY_GROUPS: { kind: Exclude<NodeKind, "here" | "caller" | "expected" | "test" | "subject">; title: string }[] = [
  { kind: "cycle", title: "Circular imports" },
  { kind: "dependency", title: "Dependencies" },
  { kind: "types", title: "Types" },
  { kind: "package", title: "Packages" },
];
const MEMBER_GROUPS: { kind: MemberKind; title: string }[] = [
  { kind: "class", title: "Classes" },
  { kind: "interface", title: "Interfaces" },
  { kind: "type", title: "Types" },
  { kind: "enum", title: "Enums" },
  { kind: "function", title: "Functions" },
  { kind: "const", title: "Constants" },
  { kind: "let", title: "Variables" },
  { kind: "property", title: "Properties" },
  { kind: "method", title: "Methods" },
  { kind: "suite", title: "Test groups" },
  { kind: "test", title: "Test cases" },
];
const SOURCE_ORDER_KINDS: MemberKind[] = ["suite", "test"];
const MEMBER_TAGS: Partial<Record<MemberKind, string>> = { suite: "test group", test: "test case" };

interface ColumnGroup { key: string; heading: { kind: GroupKind; title: string; cls: string } | null; ids: string[]; }

const memberIdOf = (index: number) => `member:${index}`;
const idsByName = (entries: { id: string; name: string }[]) =>
  [...entries].sort((left, right) => left.name.localeCompare(right.name)).map((entry) => entry.id);

const membersInGroupOrder = (entries: { id: string; name: string }[], kind: MemberKind) =>
  SOURCE_ORDER_KINDS.includes(kind) ? entries.map((entry) => entry.id) : idsByName(entries);

const CALLERS_FLOOR = 0;
const OPEN_FILE_FLOOR = 1;
const COLUMNS_FLOOR = 2;

export function layout(view: ViewData, ui: UiState, width: number, search: SearchByColumn = {}): Layout {
  const floorWidth = width - 2 * FLOOR_LEFT;
  const inner = layoutImmediate(view, ui, floorWidth, search);
  return { width, inner: inner.layer, outer: ui.layer === 2 ? layoutSecond(view, ui, inner, width) : null };
}

function foldersOf(nodes: ViewNode[]): string {
  const dirs = [...new Set(nodes.map((node) => node.dir).filter(Boolean))];
  return dirs.slice(0, 4).join(", ") + (dirs.length > 4 ? `, +${dirs.length - 4} more` : "");
}

function layoutRow(ids: string[], open: boolean, top: number, floor: number, floorWidth: number) {
  const collapsible = ids.length > MAX_PER_ROW;
  const shown = collapsible && !open ? ids.slice(0, MAX_PER_ROW) : ids;
  const rows = Math.max(1, Math.ceil(shown.length / MAX_PER_ROW));
  const boxes: Record<string, Box> = {};
  shown.forEach((id, index) => {
    const row = Math.floor(index / MAX_PER_ROW);
    const col = index % MAX_PER_ROW;
    const inRow = Math.min(MAX_PER_ROW, shown.length - row * MAX_PER_ROW);
    const startX = FLOOR_LEFT + Math.round((floorWidth - (inRow * NODE_W + (inRow - 1) * COL_GAP)) / 2);
    boxes[id] = { x: startX + col * (NODE_W + COL_GAP), y: top + 34 + row * ROW_H, w: NODE_W, h: NODE_H, floor };
  });
  const h = 34 + rows * ROW_H + 4 + (collapsible ? 30 : 0);
  const toggle: FloorToggle | null = collapsible
    ? { text: open ? "Show fewer" : `Show ${ids.length - shown.length} more`, icon: open ? "minus" : "plus", y: top + h - 30 }
    : null;
  return { boxes, h, toggle };
}

function nodeView(node: ViewNode, box: Box, ui: UiState): NodeView {
  const cls = [colorOf(node), node.secondLayer ? "two" : "", node.kind === "here" ? "here" : "", ui.selected === node.id ? "sel" : ""]
    .filter(Boolean)
    .join(" ");
  return {
    id: node.id, x: box.x, y: box.y, w: box.w, cls, kind: node.kind,
    tag: node.secondLayer ? "Second layer" : node.matchedByFileName ? "Tested file, matched by name" : KIND_TAG[node.kind],
    name: node.name,
    path: node.kind === "package" ? "npm package" : node.dir,
  };
}

export function memberAtLine(members: Member[], line: number): number {
  const span = (member: Member) => member.endLine - member.line;
  let innermost = -1;
  members.forEach((member, index) => {
    if (line < member.line || line > member.endLine) return;
    // members are in source order, so on equal spans the later one is the method inside the class
    if (innermost === -1 || span(member) <= span(members[innermost])) innermost = index;
  });
  return innermost;
}

function usesListOf(member: Member): { key: string; text: string; uses: MemberUse[] } | null {
  const classes = member.implementedBy?.filter((implementation) => implementation.kind === "class") ?? [];
  if (classes.length) return { key: `implementations:${member.name}`, text: `${classes.length} implementation${classes.length === 1 ? "" : "s"}`, uses: classes };
  const uses = member.usedIn;
  if (!uses?.length) return null;
  return { key: `uses:${[member.className, member.name].filter(Boolean).join(".")}`, text: `used in ${uses.length} file${uses.length === 1 ? "" : "s"}`, uses };
}

function openUsesOf(member: Member, ui: UiState): MemberUse[] {
  const usesList = usesListOf(member);
  return usesList && ui.open[usesList.key] ? usesList.uses : [];
}

function memberUsageView(member: Member, box: Box, ui: UiState): MemberUsageView | undefined {
  if (!member.usedIn) return undefined;
  const usesList = usesListOf(member);
  if (!usesList) return { text: member.usedInOwnFile ? "only used in this file" : "no use in this repo", listKey: null, list: null };
  const openUses = openUsesOf(member, ui);
  const list = openUses.length ? { x: box.x + USES_LIST_INDENT, y: box.y + box.h + USES_LIST_GAP, w: box.w - USES_LIST_INDENT, uses: openUses } : null;
  return { text: usesList.text, listKey: usesList.key, list };
}

function implementationView(implementation: Implementation, id: string, box: Box): MemberView {
  const fileName = implementation.file.slice(implementation.file.lastIndexOf("/") + 1);
  return {
    id, x: box.x, y: box.y, w: box.w, cls: "blue", tag: implementation.kind === "class" ? "implements" : "extends", kind: implementation.kind, name: implementation.name,
    line: implementation.line, tooltip: `${implementation.file}:${implementation.line}`, path: `${fileName} · line ${implementation.line}`, opensFile: implementation.file,
  };
}

function memberView(member: Member, id: string, box: Box, atCursor: boolean, ui: UiState): MemberView {
  const usage = memberUsageView(member, box, ui);
  return {
    id, x: box.x, y: box.y, w: box.w, cls: atCursor ? "green cur" : "green", tag: MEMBER_TAGS[member.kind] ?? member.kind, kind: member.kind, name: member.name, line: member.line,
    tooltip: [member.name, member.suiteTitle, `Go to line ${member.line}`].filter(Boolean).join("\n"),
    path: member.className ?? member.suiteTitle ?? "",
    ...(member.focus ? { focus: member.focus } : {}),
    ...(member.visibility ? { visibility: member.visibility } : {}),
    ...(usage ? { usage } : {}),
  };
}

function wireState(view: ViewData, ui: UiState, ends: string[]): string {
  if (ui.selected === view.openFile) return "";
  return ends.includes(ui.selected) ? " hi" : " lo";
}

export function routeWire(from: Box, to: Box) {
  const x1 = from.x + from.w / 2;
  const x2 = to.x + to.w / 2;
  const y1 = from.y + from.h;
  const y2 = to.y;
  const k = (y2 - y1) / 2;
  return { d: `M${x1} ${y1} C${x1} ${y1 + k}, ${x2} ${y2 - k}, ${x2} ${y2}`, x1, y1, x2, y2 };
}

interface CardSizes { heightOf: (id: string) => number; spaceBelowOf: (id: string) => number; }

function layoutColumns(columns: ColumnGroup[][], searchingColumns: boolean[], ui: UiState, top: number, columnWidth: number, cardSizes: CardSizes) {
  const boxes: Record<string, Box> = {};
  const hiddenCardAnchors: Record<string, Box> = {};
  const groupHeadings: GroupHeadingView[] = [];
  const groupToggles: GroupToggleView[] = [];
  const placed = columns.map((groups, columnIndex) => {
    const x = FLOOR_LEFT + columnIndex * (columnWidth + COL_GAP);
    const cardX = x + COLUMN_PADDING;
    const cardW = columnWidth - 2 * COLUMN_PADDING;
    const searching = searchingColumns[columnIndex];
    let cursor = top + 34 + COLUMN_SEARCH_ROW_H;
    for (const group of groups) {
      if (group !== groups[0]) cursor += GROUP_GAP;
      const collapseKey = `${group.key}:collapsed`;
      const moreKey = `${group.key}:more`;
      const collapsed = !searching && !!ui.open[collapseKey];
      const showAll = searching || !!ui.open[moreKey];
      const headingBox: Box = { x: cardX, y: cursor, w: cardW, h: GROUP_HEADING_H, floor: COLUMNS_FLOOR };
      if (group.heading) {
        groupHeadings.push({ key: collapseKey, x: cardX, y: cursor, w: cardW, cls: group.heading.cls, kind: group.heading.kind, text: `${group.heading.title} (${group.ids.length})`, collapsed });
        cursor += GROUP_HEADING_H;
      }
      let shownCount = Math.min(MAX_PER_GROUP, group.ids.length);
      if (collapsed) shownCount = 0;
      else if (showAll) shownCount = group.ids.length;
      group.ids.forEach((id, index) => {
        if (index >= shownCount) {
          hiddenCardAnchors[id] = headingBox;
          return;
        }
        const height = cardSizes.heightOf(id);
        boxes[id] = { x: cardX, y: cursor, w: cardW, h: height, floor: COLUMNS_FLOOR };
        cursor += height + ROW_H - NODE_H + cardSizes.spaceBelowOf(id);
      });
      if (!searching && !collapsed && group.ids.length > MAX_PER_GROUP) {
        groupToggles.push({ key: moreKey, x: cardX, y: cursor - 6, text: showAll ? "Show fewer" : `Show ${group.ids.length - shownCount} more`, icon: showAll ? "minus" : "plus" });
        cursor += GROUP_TOGGLE_H;
      }
    }
    return { x, bottom: cursor };
  });
  const h = Math.max(top + 34 + COLUMN_SEARCH_ROW_H + ROW_H, ...placed.map((column) => column.bottom)) - top + 4;
  return { boxes, hiddenCardAnchors, groupHeadings, groupToggles, h, placed };
}

function layoutImmediate(view: ViewData, ui: UiState, floorWidth: number, search: SearchByColumn): { layer: LayerView; boxes: Record<string, Box> } {
  const immediate = view.nodes.filter((node) => !node.secondLayer);
  const byId = new Map(view.nodes.map((node) => [node.id, node]));
  const center = byId.get(view.openFile)!;
  const floors: FloorView[] = [];
  const banners: BannerView[] = [];
  const boxes: Record<string, Box> = {};
  let y = 16;

  if (view.scan) {
    const { done, total } = view.scan;
    banners.push({ y, title: "Reading the workspace", items: [{ label: "done", value: `${done} of ${total} files read. The map fills in as files are read.` }], progress: Math.round((100 * done) / Math.max(1, total)) });
    y += 136;
  }

  const callers = immediate.filter((node) => node.kind === "caller");
  if (callers.length) {
    const row = layoutRow(callers.map((node) => node.id), !!ui.open.callers, y, CALLERS_FLOOR, floorWidth);
    Object.assign(boxes, row.boxes);
    floors.push({ key: "callers", title: "Imports this file", path: foldersOf(callers), cls: "", x: FLOOR_LEFT, y, w: floorWidth, h: row.h, emptyText: "", toggle: row.toggle });
    y += row.h + FLOOR_GAP;
  } else {
    floors.push({ key: "callers", title: "Imports this file", path: "", cls: "empty", x: FLOOR_LEFT, y, w: floorWidth, h: 64, emptyText: `No file imports ${center.name}.`, toggle: null });
    y += 64 + FLOOR_GAP;
  }

  floors.push({ key: "mine", title: "Same folder", path: center.dir, cls: "mine", x: FLOOR_LEFT, y, w: floorWidth, h: 112, emptyText: "", toggle: null });
  boxes[center.id] = { x: FLOOR_LEFT + Math.round((floorWidth - HERE_W) / 2), y: y + 34, w: HERE_W, h: HERE_H, floor: OPEN_FILE_FLOOR };
  y += 112 + FLOOR_GAP;

  const nodesInColumn = (key: ColumnKey) => immediate.filter((node) => columnOf(node) === key);
  const dependencyNodes = nodesInColumn("deps");
  const memberIds = view.members.map((_member, index) => memberIdOf(index));
  const memberById = new Map(view.members.map((member, index) => [memberIds[index], member]));
  const implementations = view.members.flatMap((member) => member.implementedBy ?? []);
  const implementationIds = implementations.map((_implementation, index) => `implementation:${index}`);
  const implementationById = new Map(implementations.map((implementation, index) => [implementationIds[index], implementation]));
  const showsImplementations = !view.openFileIsTest && view.members.some((member) => member.implementedBy) && nodesInColumn("tests").length === 0;
  const cardSizes: CardSizes = {
    heightOf: (id) => (memberById.get(id)?.usedIn ? MEMBER_WITH_USAGE_H : NODE_H),
    spaceBelowOf: (id) => {
      const member = memberById.get(id);
      const openUseCount = member ? openUsesOf(member, ui).length : 0;
      return openUseCount ? USES_LIST_GAP + openUseCount * USE_ENTRY_H : 0;
    },
  };
  function testsColumnOf(): { def: ColumnDef; groups: ColumnGroup[] } {
    if (showsImplementations) {
      return {
        def: IMPLEMENTED_BY_COLUMN,
        groups: IMPLEMENTATION_GROUPS.map((group) => ({
          key: `tests:${group.kind}`, heading: { kind: group.kind, title: group.title, cls: "blue" },
          ids: idsByName(implementations.flatMap((implementation, index) => (implementation.kind === group.kind ? [{ id: implementationIds[index], name: implementation.name }] : []))),
        })),
      };
    }
    if (view.openFileIsTest) {
      return {
        def: TEST_FILE_TESTS_COLUMN,
        groups: TEST_FILE_TEST_GROUPS.map((group) => ({
          key: `tests:${group.kind}`, heading: { kind: group.kind, title: group.title, cls: "pink" },
          ids: idsByName(nodesInColumn("tests").filter((node) => node.kind === group.kind)),
        })),
      };
    }
    return { def: COLUMNS.find((def) => def.key === "tests")!, groups: [{ key: "tests", heading: null, ids: idsByName(nodesInColumn("tests")) }] };
  }
  const testsColumn = testsColumnOf();
  const groupsByColumn: Record<ColumnKey, ColumnGroup[]> = {
    deps: DEPENDENCY_GROUPS.map((group) => ({
      key: `deps:${group.kind}`, heading: { kind: group.kind, title: group.title, cls: KIND_COLOR[group.kind] },
      ids: idsByName(dependencyNodes.filter((node) => node.kind === group.kind)),
    })),
    members: MEMBER_GROUPS.map((group) => ({
      key: `members:${group.kind}`, heading: { kind: group.kind, title: group.title, cls: "green" },
      ids: membersInGroupOrder(view.members.flatMap((member, index) => (member.kind === group.kind ? [{ id: memberIds[index], name: member.name }] : [])), group.kind),
    })),
    tests: testsColumn.groups,
  };
  const columnDefs = COLUMNS.map((def) => (def.key === "tests" ? testsColumn.def : def));
  const columnIds = columnDefs.map((def) => groupsByColumn[def.key].flatMap((group) => group.ids));
  const nameById = new Map<string, string>([...immediate.map((node) => [node.id, node.name] as const), ...view.members.map((member, index) => [memberIds[index], member.name] as const), ...implementations.map((implementation, index) => [implementationIds[index], implementation.name] as const)]);
  const searchTexts = columnDefs.map((def) => search[def.key] ?? "");
  const columnGroups = columnDefs.map((def, index) => {
    const searchText = searchTexts[index].toLowerCase();
    return groupsByColumn[def.key]
      .map((group) => (searchText ? { ...group, ids: group.ids.filter((id) => nameById.get(id)!.toLowerCase().includes(searchText)) } : group))
      .filter((group) => group.ids.length > 0);
  });
  const columnsTop = y;
  const columnWidth = Math.floor((floorWidth - (columnDefs.length - 1) * COL_GAP) / columnDefs.length);
  const columns = layoutColumns(columnGroups, searchTexts.map(Boolean), ui, y, columnWidth, cardSizes);
  Object.assign(boxes, columns.boxes);
  columnDefs.forEach((def, index) => {
    const count = columnIds[index].length;
    const searchText = searchTexts[index];
    let emptyText = count ? "" : def.empty(center.name);
    if (searchText && columnGroups[index].length === 0) emptyText = `No match for "${searchText}".`;
    floors.push({
      key: def.key, title: count ? `${def.title} (${count})` : def.title, path: foldersOf(nodesInColumn(def.key)), cls: count ? (def.key === "tests" ? "annex" : "") : "empty",
      x: columns.placed[index].x, y, w: columnWidth, h: columns.h, emptyText, toggle: null, search: count ? searchText : undefined,
    });
  });
  y += columns.h + 14;

  if (view.orphanChecks) {
    banners.push({ y: y + 4, title: "Nothing connects to this file", items: view.orphanChecks, progress: null });
    y += 210;
  }

  const wires: WireView[] = [];
  const ports: PortView[] = [];
  for (const edge of view.edges) {
    const from = boxes[edge.from];
    const to = boxes[edge.to];
    if (!from || from.floor !== CALLERS_FLOOR || !to) continue;
    const route = routeWire(from, to);
    const color = colorOf(byId.get(edge.from)!);
    wires.push({ cls: `${color}${wireState(view, ui, [edge.from, edge.to])}`, d: route.d });
    ports.push({ cls: color, x: route.x1, y: route.y1, incoming: false }, { cls: color, x: route.x2, y: route.y2, incoming: true });
  }
  const openFileBox = boxes[center.id];
  columnDefs.forEach((def, index) => {
    const columnTop: Box = { x: Math.round(columns.placed[index].x + columnWidth / 2), y: columnsTop, w: 0, h: 0, floor: COLUMNS_FLOOR };
    const route = routeWire(openFileBox, columnTop);
    wires.push({ cls: `${def.color}${wireState(view, ui, columnIds[index])}`, d: route.d });
    ports.push({ cls: def.color, x: route.x2, y: route.y2, incoming: true });
  });
  ports.push({ cls: colorOf(center), x: openFileBox.x + openFileBox.w / 2, y: openFileBox.y + openFileBox.h, incoming: false });

  const nodes = immediate.filter((node) => boxes[node.id]).map((node) => nodeView(node, boxes[node.id], ui));
  const cursorIndex = ui.cursorLine === undefined ? -1 : memberAtLine(view.members, ui.cursorLine);
  const cursorMemberId = cursorIndex === -1 ? undefined : memberIds[cursorIndex];
  const members = [
    ...groupsByColumn.members.flatMap((group) => group.ids).filter((id) => boxes[id]).map((id) => memberView(memberById.get(id)!, id, boxes[id], id === cursorMemberId, ui)),
    ...groupsByColumn.tests.flatMap((group) => group.ids).filter((id) => implementationById.has(id) && boxes[id]).map((id) => implementationView(implementationById.get(id)!, id, boxes[id])),
  ];
  const hiddenCursorGroup = cursorMemberId && !boxes[cursorMemberId] ? groupsByColumn.members.find((group) => group.ids.includes(cursorMemberId)) : undefined;
  const cursorHeadingKey = hiddenCursorGroup && `${hiddenCursorGroup.key}:collapsed`;
  const groupHeadings = columns.groupHeadings.map((heading) => (heading.key === cursorHeadingKey ? { ...heading, cls: `${heading.cls} cur` } : heading));
  const layer = { floors, nodes, members, groupHeadings, groupToggles: columns.groupToggles, wires, ports, banners, height: Math.max(y + 8, 600) };
  return { layer, boxes: { ...columns.hiddenCardAnchors, ...boxes } };
}

function layoutSecond(view: ViewData, ui: UiState, inner: { layer: LayerView; boxes: Record<string, Box> }, width: number): SecondLayerView | null {
  const second = view.nodes.filter((node) => node.secondLayer);
  if (!second.length) return null;
  const up = second.filter((node) => node.kind === "caller");
  const down = second.filter((node) => node.kind !== "caller");
  const floors: FloorView[] = [];
  const boxes: Record<string, Box> = {};
  const side = new Map<string, "up" | "down">();
  const floorWidth = width - 2 * FLOOR_LEFT;
  let y = 16;

  if (up.length) {
    const row = layoutRow(up.map((node) => node.id), !!ui.open.l2up, y, 0, floorWidth);
    Object.assign(boxes, row.boxes);
    floors.push({ key: "l2up", title: "Second layer: imports the callers", path: foldersOf(up), cls: "", x: FLOOR_LEFT, y, w: floorWidth, h: row.h, emptyText: "", toggle: row.toggle });
    up.forEach((node) => side.set(node.id, "up"));
    y += row.h + 44;
  }
  const scaledWidth = Math.round(width * CLUSTER_SCALE);
  const ox = Math.round((width - scaledWidth) / 2);
  const oy = y + 10;
  const frame = { x: ox - 10, y: oy - 10, w: scaledWidth + 20, h: Math.round(inner.layer.height * CLUSTER_SCALE) + 20 };
  y = frame.y + frame.h + 44;
  if (down.length) {
    const row = layoutRow(down.map((node) => node.id), !!ui.open.l2down, y, 2, floorWidth);
    Object.assign(boxes, row.boxes);
    floors.push({ key: "l2down", title: "Second layer: imported by the immediate layer", path: foldersOf(down), cls: "", x: FLOOR_LEFT, y, w: floorWidth, h: row.h, emptyText: "", toggle: row.toggle });
    down.forEach((node) => side.set(node.id, "down"));
    y += row.h + 16;
  }

  const wires: WireView[] = [];
  const ports: PortView[] = [];
  for (const edge of view.edges) {
    const fromIsOuter = side.has(edge.from);
    if (!fromIsOuter && !side.has(edge.to)) continue;
    const outerId = fromIsOuter ? edge.from : edge.to;
    const innerId = fromIsOuter ? edge.to : edge.from;
    const p2 = boxes[outerId];
    const pi = inner.boxes[innerId];
    if (!p2 || !pi) continue;
    const xs = ox + (pi.x + pi.w / 2) * CLUSTER_SCALE;
    const goingUp = side.get(outerId) === "up";
    const x1 = goingUp ? p2.x + p2.w / 2 : xs;
    const y1 = goingUp ? p2.y + p2.h : frame.y + frame.h;
    const x2 = goingUp ? xs : p2.x + p2.w / 2;
    const y2 = goingUp ? frame.y : p2.y;
    const k = (y2 - y1) / 2;
    const color = colorOf(view.nodes.find((node) => node.id === outerId)!);
    wires.push({ cls: `${color}${wireState(view, ui, [outerId, innerId])}`, d: `M${x1} ${y1} C${x1} ${y1 + k}, ${x2} ${y2 - k}, ${x2} ${y2}` });
    ports.push({ cls: color, x: x1, y: y1, incoming: false }, { cls: color, x: x2, y: y2, incoming: true });
  }

  const nodes = second.filter((node) => boxes[node.id]).map((node) => nodeView(node, boxes[node.id], ui));
  return { floors, nodes, members: [], groupHeadings: [], groupToggles: [], wires, ports, banners: [], height: y + 8, frame, transform: `translate(${ox}px, ${oy}px) scale(${CLUSTER_SCALE})` };
}
