import type { AiScanState, AiStatus } from "../shared/messages";
import type { Fact, MemberKind, NodeKind, ViewData } from "../shared/viewData";
import type { BannerView, FloorView, GroupHeadingView, GroupKind, GroupToggleView, LayerView, Layout, MemberView, NodeView, PortView, SecondLayerView, UiState, WireView } from "./layout";
import { groupChecks, panelFor, type Action, type PanelModel } from "./panelModel";

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);

const ASKS: { action: Action; label: string; icon: string }[] = [
  { action: "context", label: "Context", icon: '<path d="M12 3 3 8l9 5 9-5-9-5z"></path><path d="m3 13 9 5 9-5"></path>' },
  { action: "why", label: "Why", icon: '<circle cx="12" cy="12" r="9"></circle><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"></path><path d="M12 17h.01"></path>' },
  { action: "where", label: "Where", icon: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"></path><circle cx="12" cy="10" r="2.5"></circle>' },
  { action: "checks", label: "Checks", icon: '<path d="M20 6 9 17l-5-5"></path>' },
];

const LEGEND = `<div class="legend">
<span class="green"><span class="lsw"></span>Current file</span>
<span class="blue"><span class="lsw"></span>Imports this file</span>
<span class="violet"><span class="lsw"></span>Imported by this file</span>
<span class="pink"><span class="lsw"></span>Tests</span>
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
const MEMBER_KIND_ICONS: Record<MemberKind, string> = {
  function: '<path d="M15 4h-2a3 3 0 0 0-3 3v13"></path><path d="M6 11h8"></path>',
  class: '<rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M4 10h16"></path>',
  method: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"></path><path d="M4 7.5 12 12l8-4.5"></path><path d="M12 12v9"></path>',
  property: '<circle cx="8" cy="12" r="4"></circle><path d="M12 12h9"></path><path d="M18 12v4"></path>',
  const: '<rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path>',
  let: '<path d="M4 20h4L19 9l-4-4L4 16z"></path><path d="m13 7 4 4"></path>',
  interface: '<circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="12" r="3"></circle><path d="M9 12h6"></path>',
  type: '<path d="M5 5h14"></path><path d="M12 5v14"></path>',
  enum: '<path d="M9 6h11M9 12h11M9 18h11"></path><path d="M4 6h.01M4 12h.01M4 18h.01"></path>',
};
const NODE_KIND_ICONS: Record<NodeKind, string> = {
  here: '<path d="M6 3h8l5 5v13H6z"></path><path d="M14 3v5h5"></path>',
  caller: '<path d="M12 20V5"></path><path d="m6 11 6-6 6 6"></path>',
  dependency: '<path d="M12 4v15"></path><path d="m6 13 6 6 6-6"></path>',
  types: '<path d="m9 6-6 6 6 6"></path><path d="m15 6 6 6-6 6"></path>',
  test: '<path d="M9 3h6"></path><path d="M10 3v6l-5 10a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2L14 9V3"></path><path d="M7 15h10"></path>',
  subject: '<circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3"></circle><path d="M12 1v4M12 19v4M1 12h4M19 12h4"></path>',
  expected: '<circle cx="12" cy="12" r="8" stroke-dasharray="3 3"></circle>',
  cycle: '<path d="M20 12a8 8 0 0 1-14 5.3"></path><path d="M4 12a8 8 0 0 1 14-5.3"></path><path d="M18 3v4h-4"></path><path d="M6 21v-4h4"></path>',
  package: '<path d="M3 8 12 4l9 4-9 4z"></path><path d="M3 8v8l9 4 9-4V8"></path><path d="M12 12v8"></path><path d="m7.5 6 9 4"></path>',
};
// the open icon is a sibling, not a child, because a button inside the node button is invalid html
const renderOpenIcon = (node: NodeView) =>
  `<button class="ndopen" style="left:${node.x + node.w - 22}px;top:${node.y + 1}px" data-action="open" data-id="${escapeHtml(node.id)}" title="Open file (or ⌘/Ctrl+click the node)" aria-label="Open ${escapeHtml(node.name)}"><svg viewBox="0 0 24 24" aria-hidden="true">${OPEN_ICON}</svg></button>`;
const renderNode = (node: NodeView, canOpen: (id: string) => boolean) =>
  `<button class="nd ${node.cls}" style="left:${node.x}px;top:${node.y}px;width:${node.w}px" data-action="select" data-id="${escapeHtml(node.id)}" title="${escapeHtml(node.id)}"><span class="nh"><svg class="kic" viewBox="0 0 24 24" aria-hidden="true">${NODE_KIND_ICONS[node.kind]}</svg>${escapeHtml(node.tag)}</span><span class="nn">${escapeHtml(node.name)}</span><span class="np">${escapeHtml(node.path)}</span></button>${canOpen(node.id) ? renderOpenIcon(node) : ""}`;
const renderMember = (member: MemberView) =>
  `<button class="nd ${member.cls}" style="left:${member.x}px;top:${member.y}px;width:${member.w}px" data-action="reveal" data-value="${member.line}" title="Go to line ${member.line}"><span class="nh"><svg class="kic" viewBox="0 0 24 24" aria-hidden="true">${MEMBER_KIND_ICONS[member.kind]}</svg>${escapeHtml(member.tag)}</span><span class="nn">${escapeHtml(member.name)}</span><span class="np">${escapeHtml(member.path)}</span></button>`;
const GROUP_ICONS: Record<GroupKind, string> = { ...NODE_KIND_ICONS, ...MEMBER_KIND_ICONS };
const CHEVRON_ICON = '<path d="m6 9 6 6 6-6"></path>';
const renderGroupHeading = (heading: GroupHeadingView) =>
  `<button class="grh ${heading.cls}${heading.collapsed ? " closed" : ""}" style="left:${heading.x}px;top:${heading.y}px;width:${heading.w}px" data-action="toggle" data-value="${escapeHtml(heading.key)}" aria-expanded="${!heading.collapsed}"><svg class="grchev" viewBox="0 0 24 24" aria-hidden="true">${CHEVRON_ICON}</svg><svg class="kic" viewBox="0 0 24 24" aria-hidden="true">${GROUP_ICONS[heading.kind]}</svg>${escapeHtml(heading.text)}</button>`;
const renderGroupToggle = (toggle: GroupToggleView) =>
  `<button class="ftog" style="left:${toggle.x}px;top:${toggle.y}px" data-action="toggle" data-value="${escapeHtml(toggle.key)}"><span class="ftic ${toggle.icon}"></span>${escapeHtml(toggle.text)}</button>`;
const renderPort = (port: PortView) => `<span class="port ${port.cls}${port.incoming ? " in" : ""}" style="left:${port.x}px;top:${port.y}px"></span>`;
const renderToggles = (floors: FloorView[]) =>
  floors
    .filter((floor) => floor.toggle)
    .map((floor) => `<button class="ftog" style="left:${floor.x + 14}px;top:${floor.toggle!.y}px" data-action="toggle" data-value="${floor.key}"><span class="ftic ${floor.toggle!.icon}"></span>${escapeHtml(floor.toggle!.text)}</button>`)
    .join("");
const factList = (facts: Fact[]) => `<ul class="facts">${facts.map((fact) => `<li><span class="fk">${escapeHtml(fact.label)}</span><span class="fv">${escapeHtml(fact.value)}</span></li>`).join("")}</ul>`;

export interface PanelAi {
  status: AiStatus | null;
  scan: AiScanState;
}

const COG_ICON = '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path>';
const SCAN_ICON = '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"></path><path d="M12 8.5 13.6 12 12 15.5 10.4 12z"></path>';
const aiHead = (text: string) => `<div class="aih"><span class="aib">AI</span>${escapeHtml(text)}</div>`;
const loadingBlock = (text: string) => `<div class="aiblock loading">${aiHead(text)}<span class="skl"></span><span class="skl short"></span></div>`;

function aiStatusLine(ai: PanelAi): string {
  const cloudNotice = ai.status?.ready && ai.status.sendsCodeTo ? `Cloud: sends code to ${escapeHtml(ai.status.sendsCodeTo)}` : "";
  if (ai.scan.state === "error") return [cloudNotice, escapeHtml(ai.scan.message)].filter(Boolean).join(". ");
  if (!ai.status) return "Checking AI setup";
  if (ai.status.ready) return [cloudNotice, ai.scan.state === "done" && ai.scan.rulesCut ? "Rules were cut to fit the model." : ""].filter(Boolean).join(". ");
  return `AI not set up: ${escapeHtml(ai.status.reason)}.`;
}

function renderAiSettingsButton(status: AiStatus | null): string {
  return `<button class="aicog ${status?.ready ? "ready" : ""}" data-action="ai-settings" data-tip="Settings" aria-label="Settings"><svg viewBox="0 0 24 24" aria-hidden="true">${COG_ICON}</svg></button>`;
}

function renderAiBar(ai: PanelAi): string {
  const loading = ai.scan.state === "loading";
  const disabled = loading || !ai.status?.ready;
  const label = loading ? "Scanning" : ai.scan.state === "done" ? "Scan again" : "Scan with AI";
  const scanTip = ai.status?.ready ? `Scans with ${ai.status.model}` : "Choose an AI model in Settings first";
  // the tip sits on a wrapper because a disabled button gets no hover events
  return `<div class="aibar"><span class="aiscan" data-tip="${escapeHtml(scanTip)}"><button class="aibtn ${loading ? "busy" : disabled ? "off" : ""}" data-action="scan" ${disabled ? "disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${SCAN_ICON}</svg>${label}</button></span>${renderAiSettingsButton(ai.status)}<span class="aistatus">${aiStatusLine(ai)}</span></div>`;
}

function renderAiSummary(ai: PanelAi | null): string {
  if (ai?.scan.state === "loading") return loadingBlock("Writing a summary");
  if (!ai || ai.scan.state !== "done") return "";
  return `<div class="aiblock">${aiHead("Summary")}<p>${escapeHtml(ai.scan.result.summary)}</p></div>`;
}

function renderAiFindings(ai: PanelAi | null): string {
  if (ai?.scan.state === "loading") return loadingBlock("Looking for things worth checking");
  if (ai?.scan.state === "idle" && ai.status?.ready) return `<div class="aihint">Scan with AI to add things worth checking below these facts.</div>`;
  if (!ai || ai.scan.state !== "done") return "";
  if (!ai.scan.result.findings.length) return `<div class="aiblock">${aiHead("Worth checking")}<div class="based">The model found nothing worth checking.</div></div>`;
  const items = ai.scan.result.findings
    .map((finding) => `<li><span class="mono">${escapeHtml(finding.file.slice(finding.file.lastIndexOf("/") + 1))}:${finding.line}</span> ${escapeHtml(finding.text)}</li>`)
    .join("");
  return `<div class="aiblock">${aiHead("Worth checking")}<ul class="findings">${items}</ul><div class="based">Every file and line named here exists in the import map.</div></div>`;
}

function renderAskBadge(action: Action, ai: PanelAi | null): string {
  if (action !== "why" && action !== "checks") return "";
  if (ai?.scan.state === "loading") return `<span class="askai busy">AI</span>`;
  if (ai?.scan.state !== "done") return "";
  return `<span class="askai">${action === "checks" ? `AI ${ai.scan.result.findings.length}` : "AI"}</span>`;
}

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
    layer.members.map(renderMember).join(""),
    layer.groupHeadings.map(renderGroupHeading).join(""),
    layer.groupToggles.map(renderGroupToggle).join(""),
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
<div class="crumb"><span class="k">Current file</span><span class="mono">${escapeHtml(open.dir || ".")}</span><span>/</span><b class="mono">${escapeHtml(open.name)}</b></div>
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

function renderConnections(model: PanelModel): string {
  const rows = model.connections.length
    ? model.connections.map((connection) => `<div class="lk"><span class="ref">${escapeHtml(connection.label)}</span><span class="lt">${escapeHtml(connection.value)}</span></div>`).join("")
    : `<div class="lt">None</div>`;
  return `<div class="ah sub"><span>${escapeHtml(model.connectionsTitle)}</span></div><div class="links">${rows}</div>`;
}

function renderChecks(checks: Fact[]): string {
  const { issues, others } = groupChecks(checks);
  if (!issues.length) return factList(others);
  const otherChecks = others.length ? `<div class="ah sub"><span>Other checks</span></div>${factList(others)}` : "";
  return `<div class="ah sub first"><span>Issues</span></div>${factList(issues)}${otherChecks}`;
}

function renderAiAnswer(action: Action, ai: PanelAi | null): string {
  if (action === "why") return renderAiSummary(ai);
  if (action === "checks") return renderAiFindings(ai);
  return "";
}

export function renderPanel(model: PanelModel, action: Action, answer: Fact[], ai: PanelAi | null): string {
  const asks = ASKS.map(
    (ask) =>
      `<button class="ask ${ask.action === action ? "on" : ""}" data-action="ask" data-value="${ask.action}"><svg viewBox="0 0 24 24" aria-hidden="true">${ask.icon}</svg>${ask.label}${renderAskBadge(ask.action, ai)}</button>`,
  ).join("");
  const answerLabel = ASKS.find((ask) => ask.action === action)!.label;
  return `<div class="pcard">
<div class="kickrow"><span class="chip ${model.color}">${escapeHtml(model.rel)}</span></div>
<h2 class="title">${escapeHtml(model.name)}</h2>
<div class="path">${escapeHtml(model.path)}</div>
${model.canOpen ? `<button class="openbtn" data-action="open" data-id="${escapeHtml(model.id)}">Open file</button>` : ""}
${ai ? renderAiBar(ai) : ""}
</div>
<section><div class="asks">${asks}</div><div class="answer"><div class="ah"><span>${escapeHtml(answerLabel)}: ${escapeHtml(model.name)}</span><span class="src-tag">From code</span></div>${action === "checks" ? renderChecks(answer) : factList(answer)}${action === "context" ? renderConnections(model) : ""}</div>${renderAiAnswer(action, ai)}</section>`;
}
