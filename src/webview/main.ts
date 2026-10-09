import type { AiScanState, AiStatus, ColumnFocusChange, HostMessage, WebviewMessage } from "../shared/messages";
import type { CallChain, CallDirection, Fact, ViewData } from "../shared/viewData";
import { ROOT_CARD_KEY, layoutCallChain } from "./callChainLayout";
import { COLUMN_ORDER, MAX_CANVAS_W, MIN_CANVAS_W, columnAfter, layout, visibleColumnBoxes, type ColumnKey, type Layout, type SearchByColumn, type UiState } from "./layout";
import { navigationCards, nextCardKey, nextChainCardKey, type ArrowKey, type NavigationCard } from "./keyboardNavigation";
import { answerFor, panelFor, type Action } from "./panelModel";
import { renderCallChain, renderMap, renderPanel } from "./render";

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
let renderedFocusedColumn: ColumnKey | undefined;
let renderedColumnBoxes: ReturnType<typeof visibleColumnBoxes> = {};
let carouselStyles = new Map<string, string | null>();
const gitFactsById = new Map<string, Fact[]>();
const savedUiByFile = new Map<string, Pick<UiState, "layer" | "open">>();
const IDLE_SCAN: AiScanState = { state: "idle" };
let aiStatus: AiStatus | null = null;
let aiScan: { openFile: string; scan: AiScanState } | null = null;
let cards: NavigationCard[] = [];
const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
let chain: CallChain | null = null;
let showingChain = false;
/** lanes of the call chain with "Show N more" on, by lane key */
let chainOpen: Record<string, boolean> = {};
let renderedChainRoot = "";
const rootKeyOf = (callChain: CallChain) => `${callChain.root.file}:${callChain.root.line}:${callChain.root.name}`;

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === "view") {
    const previousFile = view?.openFile;
    const openFileChanged = previousFile !== message.data.openFile;
    view = message.data;
    if (openFileChanged) {
      vscode.setState({ openFile: message.data.openFile });
      if (previousFile !== undefined) savedUiByFile.set(previousFile, { layer: ui.layer, open: ui.open });
      ui = { layer: 1, open: {}, ...savedUiByFile.get(view.openFile), selected: view.openFile, focusedColumn: ui.focusedColumn };
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
  // the carousel keys stay bound while the chain shows, and focus mode would otherwise change behind it
  if (message.type === "columnFocus" && !showingChain) ui = { ...ui, focusedColumn: changedFocusedColumn(message.change) };
  let newChainRoot = false;
  if (message.type === "callChain") {
    newChainRoot = !chain || rootKeyOf(chain) !== rootKeyOf(message.chain);
    if (newChainRoot) chainOpen = {};
    chain = message.chain;
    showingChain = true;
  }
  render();
  if (message.type === "focusOpenFile" && view) focusCard(view.openFile);
  if (newChainRoot) focusCard(ROOT_CARD_KEY);
});

document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!target) return;
  const { action: kind, id, value } = target.dataset;
  if (kind === "back-to-map") return showMap();
  if (kind === "chain-centre" && id && value) return vscode.postMessage({ type: "showCallChain", file: id, line: Number(value) });
  if (kind === "chain-deeper" && value) return vscode.postMessage({ type: "extendCallChain", direction: value as CallDirection });
  if (kind === "chain-toggle" && value) {
    chainOpen = { ...chainOpen, [value]: !chainOpen[value] };
    return render();
  }
  if (!view) return;
  if (kind === "chain" && value) return vscode.postMessage({ type: "showCallChain", file: view.openFile, line: Number(value) });
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
  if (kind === "focus-mode" && value) ui = { ...ui, focusedColumn: ui.focusedColumn === value ? undefined : (value as ColumnKey) };
  if (kind === "focus-column" && value) ui = { ...ui, focusedColumn: value as ColumnKey };
  if (kind === "ask" && value) action = value as Action;
  if (kind === "open" && id) vscode.postMessage({ type: "open", id, ...(value ? { line: Number(value) } : {}) });
  if (kind === "reveal" && value) vscode.postMessage({ type: "reveal", line: Number(value) });
  if (kind === "ai-settings") vscode.postMessage({ type: "openSettings" });
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
  if (target.closest("#panel")) return;
  if (showingChain) return handleCallChainKey(event, target);
  if (!view) return;
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
  // with Alt held, Cmd+Enter is the focus mode key and must not also open the file
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.altKey) {
    if (action !== "select" || !id || !panelFor(view, id).canOpen) return;
    event.preventDefault();
    vscode.postMessage({ type: "open", id });
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "/") {
    event.preventDefault();
    document.querySelector<HTMLInputElement>(`[data-search="${columnOfFocusedCard()}"]`)?.focus();
    return;
  }
  if (!ARROW_KEYS.has(event.key)) return;
  if (focusedKey) {
    event.preventDefault();
    const nextKey = nextCardKey(cards, focusedKey, event.key as ArrowKey, { loopColumns: !!ui.focusedColumn });
    if (!nextKey) return;
    const nextColumn = cards.find((card) => card.key === nextKey)?.floor as ColumnKey;
    if (ui.focusedColumn && COLUMN_ORDER.includes(nextColumn) && nextColumn !== ui.focusedColumn) {
      ui = { ...ui, focusedColumn: nextColumn };
      render();
    }
    focusCard(nextKey);
  } else if (target === document.body) {
    event.preventDefault();
    focusCard(view.openFile);
  }
});

function handleCallChainKey(event: KeyboardEvent, target: HTMLElement): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "Escape") {
    event.preventDefault();
    showMap();
    return;
  }
  if (!ARROW_KEYS.has(event.key)) return;
  event.preventDefault();
  const focusedKey = target.dataset.nav;
  const nextKey = focusedKey ? nextChainCardKey(cards, focusedKey, event.key as ArrowKey) : ROOT_CARD_KEY;
  if (nextKey) focusCard(nextKey);
}

function showMap(): void {
  showingChain = false;
  render();
  if (view) focusCard(view.openFile);
}

function focusCard(key: string, options?: FocusOptions): void {
  document.querySelector<HTMLElement>(`[data-nav="${CSS.escape(key)}"]`)?.focus(options);
}

function columnOfFocusedCard(): ColumnKey {
  const focusedKey = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.nav : undefined;
  const focusedFloor = cards.find((card) => card.key === focusedKey)?.floor as ColumnKey;
  return COLUMN_ORDER.includes(focusedFloor) ? focusedFloor : "members";
}

function changedFocusedColumn(change: ColumnFocusChange): ColumnKey | undefined {
  const focused = ui.focusedColumn;
  if (change === "toggle") return focused ? undefined : columnOfFocusedCard();
  return focused && columnAfter(focused, change === "next" ? 1 : -1);
}

// each new element starts at the style it had before this render, so the CSS transition moves it to the new place
function animateCarousel(map: HTMLElement, animating: boolean, togglingFocus: boolean): void {
  const elements = Array.from(map.querySelectorAll<HTMLElement | SVGElement>("[data-animate]"));
  const previousStyles = carouselStyles;
  carouselStyles = new Map(elements.map((element) => [element.dataset.animate!, element.getAttribute("style")]));
  if (!animating) return;
  for (const element of elements) {
    if (togglingFocus && element.dataset.animate!.startsWith("column:")) continue;
    const previous = previousStyles.get(element.dataset.animate!);
    const next = element.getAttribute("style");
    if (!previous || !next || previous === next) continue;
    element.setAttribute("style", previous);
    requestAnimationFrame(() => requestAnimationFrame(() => element.setAttribute("style", next)));
  }
}

// each column starts scaled and moved onto the box it showed in before focus mode turned on or off
function animateFocusToggle(map: HTMLElement, result: Layout, previousBoxes: ReturnType<typeof visibleColumnBoxes>): void {
  for (const floor of result.inner.floors) {
    const previous = floor.column && previousBoxes[floor.column];
    const element = floor.column && map.querySelector<HTMLElement>(`.col[data-animate="column:${floor.column}"]`);
    if (!previous || !element) continue;
    const origin = `transform-origin:${floor.x}px ${floor.y}px`;
    const next = result.carousel ? element.getAttribute("style")! : `${origin};transform:none`;
    element.setAttribute("style", `${origin};transform:translate(${previous.x - floor.x}px, ${previous.y - floor.y}px) scale(${previous.w / floor.w})`);
    requestAnimationFrame(() => requestAnimationFrame(() => element.setAttribute("style", next)));
  }
}

document.addEventListener("dblclick", (event) => {
  const id = (event.target as HTMLElement).closest<HTMLElement>('[data-action="select"]')?.dataset.id;
  if (view && id && panelFor(view, id).canOpen) vscode.postMessage({ type: "open", id });
});

function render(remeasured = false): void {
  if (showingChain && chain) return renderCallChainView(chain, remeasured);
  if (!view) return;
  renderedWidth = canvasWidth();
  const result = layout(view, ui, renderedWidth, searchByColumn);
  const map = document.getElementById("map")!;
  map.classList.remove("chain");
  // every render replaces the html, so without these classes all nodes pop in again on each click
  map.classList.toggle("keep-nodes", view === renderedView);
  map.classList.toggle("keep-layer2", view === renderedView && ui.layer === renderedLayer);
  // the host sends a new view object for the same file after a save, so comparing views would reset the scroll
  const sameOpenFile = view.openFile === renderedView?.openFile;
  renderedView = view;
  renderedLayer = ui.layer;
  const focusedSearch = document.activeElement instanceof HTMLInputElement && document.activeElement.dataset.search ? document.activeElement : null;
  const focusedCardKey = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.nav : undefined;
  const previousScroller = sameOpenFile ? map.querySelector<HTMLElement>(".ne") : null;
  const scrollLeft = previousScroller?.scrollLeft ?? 0;
  const scrollTop = previousScroller?.scrollTop ?? 0;
  map.innerHTML = renderMap(result, view, ui);
  const togglingFocus = sameOpenFile && !!ui.focusedColumn !== !!renderedFocusedColumn;
  animateCarousel(map, sameOpenFile && (!!ui.focusedColumn || !!renderedFocusedColumn), togglingFocus);
  if (togglingFocus) animateFocusToggle(map, result, renderedColumnBoxes);
  renderedFocusedColumn = ui.focusedColumn;
  renderedColumnBoxes = visibleColumnBoxes(result);
  map.querySelector<HTMLElement>(".ne")?.scrollTo(scrollLeft, scrollTop);
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

function renderCallChainView(callChain: CallChain, remeasured: boolean): void {
  const map = document.getElementById("map")!;
  const rootKey = rootKeyOf(callChain);
  const sameRoot = map.classList.contains("chain") && rootKey === renderedChainRoot;
  const focusedCardKey = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.nav : undefined;
  const previousScroller = sameRoot ? map.querySelector<HTMLElement>(".ne") : null;
  const scrollLeft = previousScroller?.scrollLeft ?? 0;
  const scrollTop = previousScroller?.scrollTop ?? 0;
  renderedWidth = canvasWidth();
  const result = layoutCallChain(callChain, chainOpen, renderedWidth);
  map.classList.add("chain");
  map.classList.toggle("keep-nodes", sameRoot);
  map.innerHTML = renderCallChain(result, callChain, renderedWidth);
  renderedChainRoot = rootKey;
  // the map renders from scratch when it comes back, so its scroll and pop-in do not carry over from the chain
  renderedView = null;
  map.querySelector<HTMLElement>(".ne")?.scrollTo(scrollLeft, scrollTop);
  cards = result.cards.map((card) => ({ key: card.key, floor: "chain", x: card.x + card.w / 2, y: card.y }));
  if (focusedCardKey) focusCard(focusedCardKey, { preventScroll: true });
  if (!remeasured && canvasWidth() !== renderedWidth) renderCallChainView(callChain, true);
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
    if ((view || showingChain) && canvasWidth() !== renderedWidth) render();
    else fitMap();
  });
}).observe(document.body);
vscode.postMessage({ type: "ready" });
