import type { AiScanState, AiStatus, HostMessage, WebviewMessage } from "../shared/messages";
import type { Fact, ViewData } from "../shared/viewData";
import { MAX_CANVAS_W, MIN_CANVAS_W, layout, type ColumnKey, type SearchByColumn, type UiState } from "./layout";
import { COLUMN_ORDER, navigationCards, nextCardKey, type ArrowKey, type NavigationCard } from "./keyboardNavigation";
import { answerFor, panelFor, type Action } from "./panelModel";
import { renderMap, renderPanel } from "./render";

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void; setState(state: { openFile: string }): void };

const vscode = acquireVsCodeApi();
const IDENTITY = "translate(0px, 0px) scale(1)";
let view: ViewData | null = null;
let ui: UiState = { selected: "", layer: 1, open: {} };
let searchByColumn: SearchByColumn = {};
let action: Action = "context";
let lastTransform = IDENTITY;
let renderedView: ViewData | null = null;
let renderedLayer: UiState["layer"] = 1;
let renderedWidth = MIN_CANVAS_W;
let renderedAiKey = "";
const gitFactsById = new Map<string, Fact[]>();
const savedUiByFile = new Map<string, Pick<UiState, "layer" | "open">>();
const IDLE_SCAN: AiScanState = { state: "idle" };
let aiStatus: AiStatus | null = null;
let aiScan: { openFile: string; scan: AiScanState } | null = null;
let cards: NavigationCard[] = [];
const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === "view") {
    const previousFile = view?.openFile;
    const openFileChanged = previousFile !== message.data.openFile;
    view = message.data;
    if (openFileChanged) {
      vscode.setState({ openFile: message.data.openFile });
      if (previousFile !== undefined) savedUiByFile.set(previousFile, { layer: ui.layer, open: ui.open });
      ui = { layer: 1, open: {}, ...savedUiByFile.get(view.openFile), selected: view.openFile };
      searchByColumn = {};
      action = "context";
      lastTransform = IDENTITY;
    } else if (!view.nodes.some((node) => node.id === ui.selected)) {
      ui = { ...ui, selected: view.openFile };
    }
  }
  if (message.type === "git") gitFactsById.set(message.id, message.facts);
  if (message.type === "aiStatus") aiStatus = message.status;
  if (message.type === "ai") aiScan = { openFile: message.openFile, scan: message.scan };
  if (message.type === "cursor") ui = { ...ui, cursorLine: message.line };
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

document.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  const column = input.dataset.search as ColumnKey | undefined;
  if (!column) return;
  searchByColumn = { ...searchByColumn, [column]: input.value };
  render();
});

document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (!view || target.closest("#panel")) return;
  const searchColumn = target.dataset.search as ColumnKey | undefined;
  if (searchColumn && event.key === "Escape") {
    event.preventDefault();
    searchByColumn = { ...searchByColumn, [searchColumn]: "" };
    render();
    const firstCard = cards.find((card) => card.floor === searchColumn);
    if (firstCard) focusCard(firstCard.key);
    return;
  }
  if (target.matches("input, textarea, select, [contenteditable]")) return;
  const focusedKey = target.dataset.nav;
  const { action, id } = target.dataset;
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    if (action !== "select" || !id || !panelFor(view, id).canOpen) return;
    event.preventDefault();
    vscode.postMessage({ type: "open", id });
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "/") {
    event.preventDefault();
    const focusedFloor = cards.find((card) => card.key === focusedKey)?.floor as ColumnKey;
    const column = COLUMN_ORDER.includes(focusedFloor) ? focusedFloor : "members";
    document.querySelector<HTMLInputElement>(`[data-search="${column}"]`)?.focus();
    return;
  }
  if (!ARROW_KEYS.has(event.key)) return;
  if (focusedKey) {
    event.preventDefault();
    const nextKey = nextCardKey(cards, focusedKey, event.key as ArrowKey);
    if (nextKey) focusCard(nextKey);
  } else if (target === document.body) {
    event.preventDefault();
    focusCard(view.openFile);
  }
});

function focusCard(key: string, options?: FocusOptions): void {
  document.querySelector<HTMLElement>(`[data-nav="${CSS.escape(key)}"]`)?.focus(options);
}

document.addEventListener("dblclick", (event) => {
  const id = (event.target as HTMLElement).closest<HTMLElement>('[data-action="select"]')?.dataset.id;
  if (view && id && panelFor(view, id).canOpen) vscode.postMessage({ type: "open", id });
});

function render(remeasured = false): void {
  if (!view) return;
  renderedWidth = canvasWidth();
  const result = layout(view, ui, renderedWidth, searchByColumn);
  const map = document.getElementById("map")!;
  // every render replaces the html, so without these classes all nodes pop in again on each click
  map.classList.toggle("keep-nodes", view === renderedView);
  map.classList.toggle("keep-layer2", view === renderedView && ui.layer === renderedLayer);
  renderedView = view;
  renderedLayer = ui.layer;
  const focusedSearch = document.activeElement instanceof HTMLInputElement && document.activeElement.dataset.search ? document.activeElement : null;
  const focusedCardKey = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.nav : undefined;
  map.innerHTML = renderMap(result, view, ui);
  cards = navigationCards(result.inner);
  if (focusedSearch) restoreSearchFocus(map, focusedSearch);
  if (focusedCardKey) focusCard(focusedCardKey, { preventScroll: true });
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

function restoreSearchFocus(map: HTMLElement, previousInput: HTMLInputElement): void {
  const input = map.querySelector<HTMLInputElement>(`[data-search="${previousInput.dataset.search}"]`);
  if (!input) return;
  input.focus();
  input.setSelectionRange(previousInput.selectionStart, previousInput.selectionEnd, previousInput.selectionDirection ?? undefined);
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
