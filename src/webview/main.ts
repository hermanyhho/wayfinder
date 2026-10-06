import type { AiScanState, AiStatus, HostMessage, WebviewMessage } from "../shared/messages";
import type { Fact, ViewData } from "../shared/viewData";
import { MAX_CANVAS_W, MIN_CANVAS_W, layout, type UiState } from "./layout";
import { answerFor, panelFor, type Action } from "./panelModel";
import { renderMap, renderPanel } from "./render";

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void; setState(state: { openFile: string }): void };

const vscode = acquireVsCodeApi();
const IDENTITY = "translate(0px, 0px) scale(1)";
let view: ViewData | null = null;
let ui: UiState = { selected: "", layer: 1, open: {} };
let action: Action = "context";
let lastTransform = IDENTITY;
let renderedView: ViewData | null = null;
let renderedLayer: UiState["layer"] = 1;
let renderedWidth = MIN_CANVAS_W;
let renderedAiKey = "";
const gitFactsById = new Map<string, Fact[]>();
const IDLE_SCAN: AiScanState = { state: "idle" };
let aiStatus: AiStatus | null = null;
let aiScan: { openFile: string; scan: AiScanState } | null = null;

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === "view") {
    const openFileChanged = view?.openFile !== message.data.openFile;
    view = message.data;
    if (openFileChanged) {
      vscode.setState({ openFile: message.data.openFile });
      ui = { ...ui, selected: view.openFile };
      action = "context";
      lastTransform = IDENTITY;
    } else if (!view.nodes.some((node) => node.id === ui.selected)) {
      ui = { ...ui, selected: view.openFile };
    }
  }
  if (message.type === "git") gitFactsById.set(message.id, message.facts);
  if (message.type === "aiStatus") aiStatus = message.status;
  if (message.type === "ai") aiScan = { openFile: message.openFile, scan: message.scan };
  render();
});

document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!target || !view) return;
  const { action: kind, id, value } = target.dataset;
  if (kind === "select" && id && (event.metaKey || event.ctrlKey) && panelFor(view, id).canOpen) {
    vscode.postMessage({ type: "open", id });
    return;
  }
  if (kind === "select" && id) {
    ui = { ...ui, selected: id };
    vscode.postMessage({ type: "select", id });
  }
  if (kind === "toggle" && value) ui = { ...ui, open: { ...ui.open, [value]: !ui.open[value] } };
  if (kind === "layer" && value) ui = { ...ui, layer: value === "2" ? 2 : 1 };
  if (kind === "ask" && value) action = value as Action;
  if (kind === "open" && id) vscode.postMessage({ type: "open", id });
  if (kind === "reveal" && value) vscode.postMessage({ type: "reveal", line: Number(value) });
  if (kind === "ai-settings") vscode.postMessage({ type: "openAiSettings" });
  if (kind === "scan") {
    aiScan = { openFile: view.openFile, scan: { state: "loading" } };
    vscode.postMessage({ type: "scan" });
  }
  render();
});

document.addEventListener("dblclick", (event) => {
  const id = (event.target as HTMLElement).closest<HTMLElement>('[data-action="select"]')?.dataset.id;
  if (view && id && panelFor(view, id).canOpen) vscode.postMessage({ type: "open", id });
});

function render(remeasured = false): void {
  if (!view) return;
  renderedWidth = canvasWidth();
  const result = layout(view, ui, renderedWidth);
  const map = document.getElementById("map")!;
  // every render replaces the html, so without these classes all nodes pop in again on each click
  map.classList.toggle("keep-nodes", view === renderedView);
  map.classList.toggle("keep-layer2", view === renderedView && ui.layer === renderedLayer);
  renderedView = view;
  renderedLayer = ui.layer;
  map.innerHTML = renderMap(result, view, ui);
  const nextTransform = result.outer ? result.outer.transform : IDENTITY;
  const cluster = document.querySelector<HTMLElement>(".cluster");
  if (cluster) {
    // the new element starts at the previous transform so the CSS transition animates the change
    cluster.style.transform = lastTransform;
    requestAnimationFrame(() => requestAnimationFrame(() => (cluster.style.transform = nextTransform)));
  }
  lastTransform = nextTransform;
  const gitFacts = gitFactsById.get(ui.selected) ?? [];
  const answer = answerFor(view, ui.selected, action, gitFacts);
  const ai = ui.selected === view.openFile ? { status: aiStatus, scan: aiScan?.openFile === view.openFile ? aiScan.scan : IDLE_SCAN } : null;
  const panel = document.getElementById("panel")!;
  const aiKey = JSON.stringify([ui.selected, ai?.scan]);
  // the host resends the scan state with every view, so without this class the AI blocks pop in again on each update
  panel.classList.toggle("keep-ai", aiKey === renderedAiKey);
  renderedAiKey = aiKey;
  panel.innerHTML = renderPanel(panelFor(view, ui.selected), action, answer, ai);
  // the first render measures #map, which is wider than .fit by the scrollbar gutter
  if (!remeasured && canvasWidth() !== renderedWidth) render(true);
  else fitMap();
}

function canvasWidth(): number {
  const available = (document.querySelector<HTMLElement>(".fit") ?? document.getElementById("map")!).clientWidth;
  return Math.min(MAX_CANVAS_W, Math.max(MIN_CANVAS_W, available));
}

function fitMap(): void {
  const box = document.querySelector<HTMLElement>(".fit");
  const canvas = document.querySelector<HTMLElement>(".cv");
  if (!box || !canvas) return;
  const scale = Math.min(1, box.clientWidth / renderedWidth);
  canvas.style.transform = `scale(${scale})`;
  box.style.height = `${canvas.offsetHeight * scale}px`;
}

let resizeFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    if (view && canvasWidth() !== renderedWidth) render();
    else fitMap();
  });
}).observe(document.body);
vscode.postMessage({ type: "ready" });
