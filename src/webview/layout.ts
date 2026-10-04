import type { Fact, NodeKind, ViewData, ViewNode } from "../shared/viewData";

export const NODE_W = 152;
export const NODE_H = 56;
export const HERE_W = 220;
export const HERE_H = 64;
export const COL_GAP = 16;
export const ROW_H = 74;
export const MAX_PER_ROW = 4;
export const AREA_LEFT = 28;
export const AREA_W = 656;
export const LANE_X = 756;
export const CANVAS_W = 800;
export const CLUSTER_SCALE = 0.56;

export interface UiState {
  selected: string;
  layer: 1 | 2;
  open: Record<string, boolean>;
}

export interface Box { x: number; y: number; w: number; h: number; floor: number; }
export interface FloorToggle { text: string; icon: "plus" | "minus"; y: number; }
export interface FloorView { key: string; title: string; path: string; cls: string; y: number; h: number; emptyText: string; toggle: FloorToggle | null; }
export interface NodeView { id: string; x: number; y: number; w: number; cls: string; tag: string; name: string; path: string; }
export interface WireView { cls: string; d: string; }
export interface PortView { cls: string; x: number; y: number; incoming: boolean; }
export interface LabelView { cls: string; x: number; y: number; text: string; }
export interface BannerView { y: number; title: string; items: Fact[]; progress: number | null; }
export interface LayerView { floors: FloorView[]; nodes: NodeView[]; wires: WireView[]; ports: PortView[]; labels: LabelView[]; banners: BannerView[]; height: number; }
export interface SecondLayerView extends LayerView { frame: { x: number; y: number; w: number; h: number }; transform: string; }
export interface Layout { inner: LayerView; outer: SecondLayerView | null; }

const KIND_COLOR: Record<NodeKind, string> = {
  here: "green", caller: "blue", dependency: "violet", types: "violet", test: "pink", subject: "pink", expected: "violet", cycle: "red", package: "grey",
};
const KIND_TAG: Record<NodeKind, string> = {
  here: "Open file", caller: "Caller", dependency: "Dependency", types: "Types", test: "Test", subject: "Under test", expected: "Expected, not found", cycle: "Circular import", package: "Package",
};

export const colorOf = (node: ViewNode): string => (node.kind === "expected" && node.expectedKind === "test" ? "pink" : KIND_COLOR[node.kind]);

const FLOORS: { key: string; title: string; takes: (node: ViewNode) => boolean; empty: (name: string) => string }[] = [
  { key: "callers", title: "Imports this file", takes: (node) => node.kind === "caller", empty: (name) => `No file imports ${name}.` },
  { key: "mine", title: "Same folder", takes: (node) => node.kind === "here" || node.kind === "cycle" || (node.kind === "expected" && node.expectedKind === "partner"), empty: () => "" },
  { key: "deps", title: "Imported by this file", takes: (node) => ["dependency", "types", "subject", "package"].includes(node.kind), empty: (name) => `${name} imports no project files.` },
  { key: "tests", title: "Tests", takes: (node) => node.kind === "test" || (node.kind === "expected" && node.expectedKind === "test"), empty: (name) => `No test imports ${name}.` },
];

export function layout(view: ViewData, ui: UiState): Layout {
  const inner = layoutImmediate(view, ui);
  return { inner: inner.layer, outer: ui.layer === 2 ? layoutSecond(view, ui, inner) : null };
}

function foldersOf(nodes: ViewNode[]): string {
  const dirs = [...new Set(nodes.map((node) => node.dir).filter(Boolean))];
  return dirs.slice(0, 4).join(", ") + (dirs.length > 4 ? `, +${dirs.length - 4} more` : "");
}

function layoutRow(ids: string[], open: boolean, top: number, floor: number) {
  const collapsible = ids.length > MAX_PER_ROW;
  const shown = collapsible && !open ? ids.slice(0, MAX_PER_ROW) : ids;
  const rows = Math.max(1, Math.ceil(shown.length / MAX_PER_ROW));
  const boxes: Record<string, Box> = {};
  shown.forEach((id, index) => {
    const row = Math.floor(index / MAX_PER_ROW);
    const col = index % MAX_PER_ROW;
    const inRow = Math.min(MAX_PER_ROW, shown.length - row * MAX_PER_ROW);
    const startX = AREA_LEFT + (AREA_W - (inRow * NODE_W + (inRow - 1) * COL_GAP)) / 2;
    boxes[id] = { x: startX + col * (NODE_W + COL_GAP), y: top + 34 + row * ROW_H, w: NODE_W, h: NODE_H, floor };
  });
  const h = 34 + rows * ROW_H + 4 + (collapsible ? 30 : 0);
  const toggle: FloorToggle | null = collapsible
    ? { text: open ? "Show fewer" : `Show ${ids.length - shown.length} more`, icon: open ? "minus" : "plus", y: top + h - 30 }
    : null;
  return { boxes, h, toggle };
}

function nodeView(node: ViewNode, box: Box, ui: UiState): NodeView {
  const cls = [colorOf(node), node.secondLayer ? "two" : "", node.kind === "expected" ? "ghost" : "", node.kind === "here" ? "here" : "", ui.selected === node.id ? "sel" : ""]
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

export function routeWire(a: Box, b: Box, dy: number, laneIndex: number) {
  if (a.floor === b.floor) {
    const x1 = a.x < b.x ? a.x + a.w : a.x;
    const x2 = a.x < b.x ? b.x : b.x + b.w;
    const y1 = a.y + a.h / 2 + dy;
    const y2 = b.y + b.h / 2 + dy;
    const mx = (x1 + x2) / 2;
    return { d: `M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`, x1, y1, x2, y2, usedLane: false };
  }
  if (Math.abs(a.floor - b.floor) === 1) {
    const x1 = a.x + a.w / 2;
    const x2 = b.x + b.w / 2;
    const y1 = a.floor < b.floor ? a.y + a.h : a.y;
    const y2 = a.floor < b.floor ? b.y : b.y + b.h;
    const k = (y2 - y1) / 2;
    return { d: `M${x1} ${y1} C${x1} ${y1 + k}, ${x2} ${y2 - k}, ${x2} ${y2}`, x1, y1, x2, y2, usedLane: false };
  }
  const lane = LANE_X + laneIndex * 12;
  const x1 = a.x + a.w / 2;
  const y1 = a.y + a.h;
  const x2 = b.x + b.w;
  const y2 = b.y + b.h / 2;
  const under = y1 + 11 + laneIndex * 6;
  const d = `M${x1} ${y1} V${under - 8} Q${x1} ${under} ${x1 + 8} ${under} H${lane - 14} Q${lane} ${under} ${lane} ${under - 14} V${y2 + 14} Q${lane} ${y2} ${lane - 14} ${y2} H${x2}`;
  return { d, x1, y1, x2, y2, usedLane: true };
}

function layoutImmediate(view: ViewData, ui: UiState): { layer: LayerView; boxes: Record<string, Box> } {
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

  FLOORS.forEach((def, floorIndex) => {
    const members = immediate.filter(def.takes);
    if (def.key === "mine") {
      floors.push({ key: def.key, title: def.title, path: center.dir, cls: "mine", y, h: 112, emptyText: "", toggle: null });
      boxes[center.id] = { x: 380, y: y + 34, w: HERE_W, h: HERE_H, floor: floorIndex };
      members
        .filter((member) => member.kind !== "here")
        .slice(0, 2)
        .forEach((member, index) => {
          boxes[member.id] = { x: AREA_LEFT + index * (NODE_W + COL_GAP), y: y + 38, w: NODE_W, h: NODE_H, floor: floorIndex };
        });
      y += 112 + 14;
      return;
    }
    if (!members.length) {
      floors.push({ key: def.key, title: def.title, path: "", cls: "empty", y, h: 64, emptyText: def.empty(center.name), toggle: null });
      y += 64 + 14;
      return;
    }
    const row = layoutRow(members.map((member) => member.id), !!ui.open[def.key], y, floorIndex);
    Object.assign(boxes, row.boxes);
    floors.push({ key: def.key, title: def.title, path: foldersOf(members), cls: def.key === "tests" ? "annex" : "", y, h: row.h, emptyText: "", toggle: row.toggle });
    y += row.h + 14;
  });

  if (view.orphanChecks) {
    banners.push({ y: y + 4, title: "Nothing connects to this file", items: view.orphanChecks, progress: null });
    y += 210;
  }

  const wires: WireView[] = [];
  const ports: PortView[] = [];
  const labels: LabelView[] = [];
  let laneIndex = 0;
  for (const edge of view.edges) {
    const a = boxes[edge.from];
    const b = boxes[edge.to];
    if (!a || !b) continue;
    const fromNode = byId.get(edge.from)!;
    const toNode = byId.get(edge.to)!;
    let dy = 0;
    if (fromNode.kind === "cycle") dy = 8;
    else if (toNode.kind === "cycle") dy = -8;
    const route = routeWire(a, b, dy, laneIndex);
    if (route.usedLane) laneIndex++;
    const color = colorOf(edge.from === view.openFile ? toNode : fromNode);
    wires.push({ cls: `${color}${edge.style === "dashed" ? " dashed" : ""}${wireState(view, ui, [edge.from, edge.to])}`, d: route.d });
    ports.push({ cls: color, x: route.x1, y: route.y1, incoming: false }, { cls: color, x: route.x2, y: route.y2, incoming: true });
    if (edge.label) {
      labels.push({ cls: color, x: (route.x1 + route.x2) / 2, y: a.floor === b.floor ? Math.min(route.y1, route.y2) - 14 : (route.y1 + route.y2) / 2, text: edge.label });
    }
  }

  const nodes = immediate.filter((node) => boxes[node.id]).map((node) => nodeView(node, boxes[node.id], ui));
  return { layer: { floors, nodes, wires, ports, labels, banners, height: Math.max(y + 8, 600) }, boxes };
}

function layoutSecond(view: ViewData, ui: UiState, inner: { layer: LayerView; boxes: Record<string, Box> }): SecondLayerView | null {
  const second = view.nodes.filter((node) => node.secondLayer);
  if (!second.length) return null;
  const up = second.filter((node) => node.kind === "caller");
  const down = second.filter((node) => node.kind !== "caller");
  const floors: FloorView[] = [];
  const boxes: Record<string, Box> = {};
  const side = new Map<string, "up" | "down">();
  let y = 16;

  if (up.length) {
    const row = layoutRow(up.map((node) => node.id), !!ui.open.l2up, y, 0);
    Object.assign(boxes, row.boxes);
    floors.push({ key: "l2up", title: "Second layer: imports the callers", path: foldersOf(up), cls: "", y, h: row.h, emptyText: "", toggle: row.toggle });
    up.forEach((node) => side.set(node.id, "up"));
    y += row.h + 44;
  }
  const scaledWidth = Math.round(CANVAS_W * CLUSTER_SCALE);
  const ox = (CANVAS_W - scaledWidth) / 2;
  const oy = y + 10;
  const frame = { x: ox - 10, y: oy - 10, w: scaledWidth + 20, h: Math.round(inner.layer.height * CLUSTER_SCALE) + 20 };
  y = frame.y + frame.h + 44;
  if (down.length) {
    const row = layoutRow(down.map((node) => node.id), !!ui.open.l2down, y, 2);
    Object.assign(boxes, row.boxes);
    floors.push({ key: "l2down", title: "Second layer: imported by the immediate layer", path: foldersOf(down), cls: "", y, h: row.h, emptyText: "", toggle: row.toggle });
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
  return { floors, nodes, wires, ports, labels: [], banners: [], height: y + 8, frame, transform: `translate(${ox}px, ${oy}px) scale(${CLUSTER_SCALE})` };
}
