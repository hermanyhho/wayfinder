import type { HostMessage, WebviewMessage } from "../shared/messages";
import type { Fact, ViewData } from "../shared/viewData";
import { CANVAS_W, layout, type UiState } from "./layout";
import { answerFor, panelFor, type Action } from "./panelModel";
import { renderMap, renderPanel } from "./render";

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void };

const vscode = acquireVsCodeApi();
const IDENTITY = "translate(0px, 0px) scale(1)";
let view: ViewData | null = null;
let ui: UiState = { selected: "", layer: 1, open: {} };
let action: Action | null = null;
let lastTransform = IDENTITY;
let renderedView: ViewData | null = null;
let renderedLayer: UiState["layer"] = 1;
const gitFactsById = new Map<string, Fact[]>();

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === "view") {
    const openFileChanged = view?.openFile !== message.data.openFile;
    view = message.data;
    if (openFileChanged) {
      ui = { selected: view.openFile, layer: 1, open: {} };
      action = null;
      lastTransform = IDENTITY;
    } else if (!view.nodes.some((node) => node.id === ui.selected)) {
      ui = { ...ui, selected: view.openFile };
    }
  }
  if (message.type === "git") gitFactsById.set(message.id, message.facts);
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
  if (kind === "ask" && value) action = action === value ? null : (value as Action);
  if (kind === "open" && id) vscode.postMessage({ type: "open", id });
  render();
});

document.addEventListener("dblclick", (event) => {
  const id = (event.target as HTMLElement).closest<HTMLElement>('[data-action="select"]')?.dataset.id;
  if (view && id && panelFor(view, id).canOpen) vscode.postMessage({ type: "open", id });
});

function render(): void {
  if (!view) return;
  const result = layout(view, ui);
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
  const answer = action ? answerFor(view, ui.selected, action, gitFacts) : null;
  document.getElementById("panel")!.innerHTML = renderPanel(panelFor(view, ui.selected), action, answer);
  fitMap();
}

function fitMap(): void {
  const box = document.querySelector<HTMLElement>(".fit");
  const canvas = document.querySelector<HTMLElement>(".cv");
  if (!box || !canvas) return;
  const scale = Math.min(1, box.clientWidth / CANVAS_W);
  canvas.style.transform = `scale(${scale})`;
  box.style.height = `${canvas.offsetHeight * scale}px`;
}

new ResizeObserver(fitMap).observe(document.body);
vscode.postMessage({ type: "ready" });
