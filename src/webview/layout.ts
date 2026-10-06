import type { Fact, NodeKind, ViewData, ViewNode } from "../shared/viewData";

export const NODE_W = 152;
export const NODE_H = 56;
export const HERE_W = 220;
export const HERE_H = 64;
export const COL_GAP = 16;
export const FLOOR_GAP = 40;
export const ROW_H = 74;
export const MAX_PER_ROW = 4;
export const MAX_PER_COLUMN = 4;
export const FLOOR_LEFT = 16;
export const MIN_CANVAS_W = 800;
export const MAX_CANVAS_W = 1280;
const COLUMN_PADDING = 14;
export const CLUSTER_SCALE = 0.56;

export interface UiState {
  selected: string;
  layer: 1 | 2;
  open: Record<string, boolean>;
}

export interface Box { x: number; y: number; w: number; h: number; floor: number; }
export interface FloorToggle { text: string; icon: "plus" | "minus"; y: number; }
export interface FloorView { key: string; title: string; path: string; cls: string; x: number; y: number; w: number; h: number; emptyText: string; toggle: FloorToggle | null; }
export interface NodeView { id: string; x: number; y: number; w: number; cls: string; tag: string; name: string; path: string; }
export interface WireView { cls: string; d: string; }
export interface PortView { cls: string; x: number; y: number; incoming: boolean; }
export interface BannerView { y: number; title: string; items: Fact[]; progress: number | null; }
export interface LayerView { floors: FloorView[]; nodes: NodeView[]; wires: WireView[]; ports: PortView[]; banners: BannerView[]; height: number; }
export interface SecondLayerView extends LayerView { frame: { x: number; y: number; w: number; h: number }; transform: string; }
export interface Layout { width: number; inner: LayerView; outer: SecondLayerView | null; }

const KIND_COLOR: Record<NodeKind, string> = {
  here: "green", caller: "blue", dependency: "violet", types: "violet", test: "pink", subject: "pink", expected: "violet", cycle: "red", package: "grey",
};
const KIND_TAG: Record<NodeKind, string> = {
  here: "Open file", caller: "Caller", dependency: "Dependency", types: "Types", test: "Test", subject: "Under test", expected: "Expected, not found", cycle: "Circular import", package: "Package",
};

export const colorOf = (node: ViewNode): string => (node.kind === "expected" && node.expectedKind === "test" ? "pink" : KIND_COLOR[node.kind]);

type ColumnKey = "deps" | "tests";

// missing expected files are listed in the Checks tab, so they get no card on the map
const COLUMN_OF_KIND: Record<Exclude<NodeKind, "here" | "caller" | "expected">, ColumnKey> = {
  dependency: "deps", types: "deps", subject: "deps", package: "deps", cycle: "deps", test: "tests",
};
const columnOf = (node: ViewNode): ColumnKey | null =>
  node.kind === "here" || node.kind === "caller" || node.kind === "expected" ? null : COLUMN_OF_KIND[node.kind];

const COLUMNS: { key: ColumnKey; title: string; color: string; empty: (name: string) => string }[] = [
  { key: "deps", title: "Imported by this file", color: "violet", empty: (name) => `${name} imports no project files.` },
  { key: "tests", title: "Tests", color: "pink", empty: (name) => `No test imports ${name}.` },
];

const CALLERS_FLOOR = 0;
const OPEN_FILE_FLOOR = 1;
const COLUMNS_FLOOR = 2;

export function layout(view: ViewData, ui: UiState, width: number): Layout {
  const floorWidth = width - 2 * FLOOR_LEFT;
  const inner = layoutImmediate(view, ui, floorWidth);
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
    id: node.id, x: box.x, y: box.y, w: box.w, cls,
    tag: node.secondLayer ? "Second layer" : KIND_TAG[node.kind],
    name: node.name,
    path: node.kind === "package" ? "npm package" : node.dir,
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

function layoutColumns(columns: { key: string; ids: string[] }[], ui: UiState, top: number, columnWidth: number) {
  const shownCounts = columns.map((column) => (ui.open[column.key] ? column.ids.length : Math.min(MAX_PER_COLUMN, column.ids.length)));
  const anyCollapsible = columns.some((column) => column.ids.length > MAX_PER_COLUMN);
  const h = 34 + Math.max(1, ...shownCounts) * ROW_H + 4 + (anyCollapsible ? 30 : 0);
  const boxes: Record<string, Box> = {};
  const placed = columns.map((column, columnIndex) => {
    const x = FLOOR_LEFT + columnIndex * (columnWidth + COL_GAP);
    column.ids.slice(0, shownCounts[columnIndex]).forEach((id, index) => {
      boxes[id] = { x: x + COLUMN_PADDING, y: top + 34 + index * ROW_H, w: columnWidth - 2 * COLUMN_PADDING, h: NODE_H, floor: COLUMNS_FLOOR };
    });
    const open = !!ui.open[column.key];
    const toggle: FloorToggle | null = column.ids.length > MAX_PER_COLUMN
      ? { text: open ? "Show fewer" : `Show ${column.ids.length - shownCounts[columnIndex]} more`, icon: open ? "minus" : "plus", y: top + h - 30 }
      : null;
    return { x, toggle };
  });
  return { boxes, h, placed };
}

function layoutImmediate(view: ViewData, ui: UiState, floorWidth: number): { layer: LayerView; boxes: Record<string, Box> } {
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

  const cyclesFirst = [...immediate].sort((left, right) => Number(right.kind === "cycle") - Number(left.kind === "cycle"));
  const columnMembers = COLUMNS.map((def) => cyclesFirst.filter((node) => columnOf(node) === def.key));
  const columnsTop = y;
  const columnWidth = Math.floor((floorWidth - (COLUMNS.length - 1) * COL_GAP) / COLUMNS.length);
  const columns = layoutColumns(COLUMNS.map((def, index) => ({ key: def.key, ids: columnMembers[index].map((node) => node.id) })), ui, y, columnWidth);
  Object.assign(boxes, columns.boxes);
  COLUMNS.forEach((def, index) => {
    const members = columnMembers[index];
    const { x, toggle } = columns.placed[index];
    floors.push({
      key: def.key, title: def.title, path: foldersOf(members), cls: members.length ? (def.key === "deps" ? "" : "annex") : "empty",
      x, y, w: columnWidth, h: columns.h, emptyText: members.length ? "" : def.empty(center.name), toggle,
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
  COLUMNS.forEach((def, index) => {
    const columnTop: Box = { x: Math.round(columns.placed[index].x + columnWidth / 2), y: columnsTop, w: 0, h: 0, floor: COLUMNS_FLOOR };
    const route = routeWire(openFileBox, columnTop);
    wires.push({ cls: `${def.color}${wireState(view, ui, columnMembers[index].map((node) => node.id))}`, d: route.d });
    ports.push({ cls: def.color, x: route.x2, y: route.y2, incoming: true });
  });
  ports.push({ cls: colorOf(center), x: openFileBox.x + openFileBox.w / 2, y: openFileBox.y + openFileBox.h, incoming: false });

  const nodes = immediate.filter((node) => boxes[node.id]).map((node) => nodeView(node, boxes[node.id], ui));
  return { layer: { floors, nodes, wires, ports, banners, height: Math.max(y + 8, 600) }, boxes };
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
  return { floors, nodes, wires, ports, banners: [], height: y + 8, frame, transform: `translate(${ox}px, ${oy}px) scale(${CLUSTER_SCALE})` };
}
