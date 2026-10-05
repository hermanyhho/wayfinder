import type { Fact, ViewData } from "../shared/viewData";
import type { BannerView, FloorView, LayerView, Layout, NodeView, PortView, SecondLayerView, UiState, WireView } from "./layout";
import { panelFor, type Action, type PanelModel } from "./panelModel";

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);

const ASKS: { action: Action; label: string; icon: string }[] = [
  { action: "context", label: "Context", icon: '<path d="M12 3 3 8l9 5 9-5-9-5z"></path><path d="m3 13 9 5 9-5"></path>' },
  { action: "why", label: "Why", icon: '<circle cx="12" cy="12" r="9"></circle><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"></path><path d="M12 17h.01"></path>' },
  { action: "where", label: "Where", icon: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"></path><circle cx="12" cy="10" r="2.5"></circle>' },
  { action: "checks", label: "Checks", icon: '<path d="M20 6 9 17l-5-5"></path>' },
];

const LEGEND = `<div class="legend">
<span class="green"><span class="lsw"></span>Open file</span>
<span class="blue"><span class="lsw"></span>Imports this file</span>
<span class="violet"><span class="lsw"></span>Imported by this file</span>
<span class="pink"><span class="lsw"></span>Tests</span>
<span class="violet"><span class="lsw dash"></span>Expected, not found</span>
<span class="red"><span class="lsw"></span>Circular import</span>
<span class="grey"><span class="lsw"></span>Package</span>
</div>`;

const immediateCount = (view: ViewData) => view.nodes.filter((node) => !node.secondLayer && node.kind !== "here" && node.kind !== "expected").length;

function countLabel(view: ViewData): string {
  if (view.scan) return `Reading the workspace: ${view.scan.done} of ${view.scan.total} files`;
  const secondCount = view.nodes.filter((node) => node.secondLayer).length;
  return `Immediate layer: ${immediateCount(view)} files. ${secondCount ? `Second layer: ${secondCount} files.` : "No second layer."}`;
}

const renderFloor = (floor: FloorView) =>
  `<div class="fl ${floor.cls}" style="left:${floor.x}px;top:${floor.y}px;width:${floor.w}px;height:${floor.h}px">${floor.emptyText ? `<span class="phtext">${escapeHtml(floor.emptyText)}</span>` : ""}</div>`;
const renderFloorHeader = (floor: FloorView) =>
  `<div class="flh ${floor.cls}" style="left:${floor.x + 14}px;top:${floor.y + 9}px;max-width:${floor.w - 28}px"><span class="ti">${escapeHtml(floor.title)}</span><span class="fp">${escapeHtml(floor.path)}</span></div>`;
const renderWires = (wires: WireView[]) => `<svg class="wires" aria-hidden="true">${wires.map((wire) => `<path class="w ${wire.cls}" d="${wire.d}"></path>`).join("")}</svg>`;
const OPEN_ICON = '<path d="M14 4h6v6"></path><path d="m20 4-9 9"></path><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>';
// the open icon is a sibling, not a child, because a button inside the node button is invalid html
const renderOpenIcon = (node: NodeView) =>
  `<button class="ndopen" style="left:${node.x + node.w - 22}px;top:${node.y + 1}px" data-action="open" data-id="${escapeHtml(node.id)}" title="Open file (or ⌘/Ctrl+click the node)" aria-label="Open ${escapeHtml(node.name)}"><svg viewBox="0 0 24 24" aria-hidden="true">${OPEN_ICON}</svg></button>`;
const renderNode = (node: NodeView, canOpen: (id: string) => boolean) =>
  `<button class="nd ${node.cls}" style="left:${node.x}px;top:${node.y}px;width:${node.w}px" data-action="select" data-id="${escapeHtml(node.id)}" title="${escapeHtml(node.id)}"><span class="nh"><span class="sw"></span>${escapeHtml(node.tag)}</span><span class="nn">${escapeHtml(node.name)}</span><span class="np">${escapeHtml(node.path)}</span></button>${canOpen(node.id) ? renderOpenIcon(node) : ""}`;
const renderPort = (port: PortView) => `<span class="port ${port.cls}${port.incoming ? " in" : ""}" style="left:${port.x}px;top:${port.y}px"></span>`;
const renderToggles = (floors: FloorView[]) =>
  floors
    .filter((floor) => floor.toggle)
    .map((floor) => `<button class="ftog" style="left:${floor.x + 14}px;top:${floor.toggle!.y}px" data-action="toggle" data-value="${floor.key}"><span class="ftic ${floor.toggle!.icon}"></span>${escapeHtml(floor.toggle!.text)}</button>`)
    .join("");
const factList = (facts: Fact[]) => `<ul class="facts">${facts.map((fact) => `<li><span class="fk">${escapeHtml(fact.label)}</span><span class="fv">${escapeHtml(fact.value)}</span></li>`).join("")}</ul>`;

function renderBanner(banner: BannerView): string {
  const bar = banner.progress === null ? "" : `<div class="bar"><span style="width:${banner.progress}%"></span></div>`;
  const items = banner.items.map((item) => `<li><span class="ck">${escapeHtml(item.label)}</span><span>${escapeHtml(item.value)}</span></li>`).join("");
  return `<div class="banner" style="top:${banner.y}px"><h4>${escapeHtml(banner.title)}</h4>${bar}<ul>${items}</ul></div>`;
}

function renderLayer(layer: LayerView, canOpen: (id: string) => boolean): string {
  return [
    layer.floors.map(renderFloor).join(""),
    layer.banners.map(renderBanner).join(""),
    renderWires(layer.wires),
    layer.floors.map(renderFloorHeader).join(""),
    layer.nodes.map((node) => renderNode(node, canOpen)).join(""),
    layer.ports.map(renderPort).join(""),
    renderToggles(layer.floors),
  ].join("");
}

function renderOuterBack(outer: SecondLayerView, fileName: string, count: number): string {
  const { frame } = outer;
  return `<div class="layer2">${outer.floors.map(renderFloor).join("")}${outer.floors.map(renderFloorHeader).join("")}
<div class="frame" style="left:${frame.x}px;top:${frame.y}px;width:${frame.w}px;height:${frame.h}px"></div>
<button class="framelabel" style="top:${frame.y}px" data-action="layer" data-value="1"><span class="fk1">${escapeHtml(fileName)}</span><span class="fk2">and its immediate layer: ${count} files</span><span class="fk3">Show immediate layer only</span></button>
${renderWires(outer.wires)}</div>`;
}

export function renderMap(result: Layout, view: ViewData, ui: UiState): string {
  const open = view.nodes.find((node) => node.id === view.openFile)!;
  const { inner, outer } = result;
  const canOpen = (id: string) => panelFor(view, id).canOpen;
  return `<div class="toolbar">
<div class="crumb"><span class="k">Open file</span><span class="mono">${escapeHtml(open.dir || ".")}</span><span>/</span><b class="mono">${escapeHtml(open.name)}</b></div>
<div class="seg" role="group" aria-label="Layers to show">
<button class="${ui.layer === 1 ? "on" : ""}" data-action="layer" data-value="1">Immediate layer</button>
<button class="${ui.layer === 2 ? "on" : ""}" data-action="layer" data-value="2">Second layer</button>
</div>
<div class="count">${escapeHtml(countLabel(view))}</div>
</div>
<div class="ne"><div class="fit"><div class="cv" style="width:${result.width}px;height:${outer ? outer.height : inner.height}px">
${outer ? renderOuterBack(outer, open.name, immediateCount(view)) : ""}
<div class="cluster" style="height:${inner.height}px">${renderLayer(inner, canOpen)}</div>
${outer ? `<div class="layer2 late">${outer.nodes.map((node) => renderNode(node, canOpen)).join("")}${outer.ports.map(renderPort).join("")}${renderToggles(outer.floors)}</div>` : ""}
${ui.layer === 2 && !outer ? `<div class="nolayer">No second layer. Nothing is connected beyond the immediate layer.</div>` : ""}
</div></div></div>
${LEGEND}`;
}

export function renderPanel(model: PanelModel, action: Action | null, answer: Fact[] | null): string {
  const connections = model.connections.length
    ? model.connections.map((connection) => `<div class="lk"><span class="ref">${escapeHtml(connection.label)}</span><span class="lt">${escapeHtml(connection.value)}</span></div>`).join("")
    : `<div class="lt">None</div>`;
  const asks = ASKS.map(
    (ask) => `<button class="ask ${ask.action === action ? "on" : ""}" data-action="ask" data-value="${ask.action}"><svg viewBox="0 0 24 24" aria-hidden="true">${ask.icon}</svg>${ask.label}</button>`,
  ).join("");
  const answerLabel = ASKS.find((ask) => ask.action === action)?.label ?? "";
  const answerBlock = action && answer
    ? `<div class="answer"><div class="ah"><span>${escapeHtml(answerLabel)}: ${escapeHtml(model.name)}</span><span class="src-tag">From code</span></div>${factList(answer)}</div>`
    : "";
  return `<div class="pcard">
<div class="kickrow"><span class="chip ${model.color}">${escapeHtml(model.rel)}</span></div>
<h2 class="title">${escapeHtml(model.name)}</h2>
<div class="path">${escapeHtml(model.path)}</div>
${model.canOpen ? `<button class="openbtn" data-action="open" data-id="${escapeHtml(model.id)}">Open file</button>` : ""}
</div>
<section><div class="sechead"><h3 class="label">What it does</h3><span class="src-tag">From code</span></div>${factList(model.facts)}</section>
<section><div class="sechead"><h3 class="label">${escapeHtml(model.connectionsTitle)}</h3><span class="src-tag">From code</span></div><div class="links">${connections}</div></section>
<section><h3 class="label">More about this file</h3><div class="asks">${asks}</div>${answerBlock}</section>`;
}
