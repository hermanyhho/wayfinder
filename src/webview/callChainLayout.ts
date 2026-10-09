import type { CallChain, CallDirection, ChainCall, LevelCall } from "../shared/viewData";
import { COL_GAP, FLOOR_LEFT, MAX_PER_ROW, NODE_H, NODE_W, ROW_H, routeWire, type GroupToggleView, type PortView, type WireView } from "./layout";

const LANE_PADDING = 14;
const LANE_GAP = 40;
const TOGGLE_H = 30;
const DEEPER_H = 22;
const DEEPER_GAP = 14;
const MAX_CARD_W = 240;
export const ROOT_CARD_KEY = "chain:root";

type ChainSide = CallDirection | "root";
export interface ChainLaneView { key: string; x: number; y: number; w: number; h: number; isRoot: boolean; }
export interface ChainCardView { key: string; x: number; y: number; w: number; cls: string; call: ChainCall; isRoot: boolean; }
export interface ChainDeeperView { direction: CallDirection; x: number; y: number; }
export interface CallChainLayout { lanes: ChainLaneView[]; cards: ChainCardView[]; toggles: GroupToggleView[]; wires: WireView[]; ports: PortView[]; deeper: ChainDeeperView[]; height: number; }

const SIDE_COLORS: Record<ChainSide, string> = { callers: "blue", root: "green", callees: "violet" };

const cardKeyOf = (side: CallDirection, levelIndex: number, callIndex: number) => `chain:${side}:${levelIndex}:${callIndex}`;

interface Lane { key: string; side: ChainSide; levelIndex: number; calls: LevelCall[]; }

function lanesTopToBottom(chain: CallChain, topSide: CallDirection, bottomSide: CallDirection): Lane[] {
  const sideLanes = (side: CallDirection) => chain[side].map((level, levelIndex) => ({ key: `chain:${side}:${levelIndex}`, side, levelIndex, calls: level.calls }));
  return [...sideLanes(topSide).reverse(), { key: "chain:root", side: "root", levelIndex: 0, calls: [{ ...chain.root, linkedTo: [] }] }, ...sideLanes(bottomSide)];
}

/** open holds the lanes whose "Show N more" toggle is on, by lane key */
export function layoutCallChain(chain: CallChain, open: Record<string, boolean>, width: number, callersOnTop: boolean): CallChainLayout {
  const [topSide, bottomSide]: CallDirection[] = callersOnTop ? ["callers", "callees"] : ["callees", "callers"];
  const cardsX = FLOOR_LEFT;
  const cardsW = width - 2 * FLOOR_LEFT;
  const cardW = Math.max(NODE_W, Math.min(MAX_CARD_W, Math.floor((cardsW - (MAX_PER_ROW - 1) * COL_GAP) / MAX_PER_ROW)));
  const deeperX = cardsX + Math.round(cardsW / 2);
  const lanes: ChainLaneView[] = [];
  const cards: ChainCardView[] = [];
  const toggles: GroupToggleView[] = [];
  const deeper: ChainDeeperView[] = [];
  const cardByKey = new Map<string, ChainCardView>();
  let y = 16;

  if (chain.canGoDeeper[topSide]) {
    deeper.push({ direction: topSide, x: deeperX, y });
    y += DEEPER_H + DEEPER_GAP;
  }
  for (const lane of lanesTopToBottom(chain, topSide, bottomSide)) {
    const isRoot = lane.side === "root";
    const collapsible = lane.calls.length > MAX_PER_ROW;
    const showAll = !!open[lane.key];
    const shown = collapsible && !showAll ? lane.calls.slice(0, MAX_PER_ROW) : lane.calls;
    shown.forEach((call, callIndex) => {
      const row = Math.floor(callIndex / MAX_PER_ROW);
      const inRow = Math.min(MAX_PER_ROW, shown.length - row * MAX_PER_ROW);
      const startX = cardsX + Math.round((cardsW - (inRow * cardW + (inRow - 1) * COL_GAP)) / 2);
      const key = lane.side === "root" ? ROOT_CARD_KEY : cardKeyOf(lane.side, lane.levelIndex, callIndex);
      const card = { key, x: startX + (callIndex % MAX_PER_ROW) * (cardW + COL_GAP), y: y + LANE_PADDING + row * ROW_H, w: cardW, cls: `${SIDE_COLORS[lane.side]}${isRoot ? " sel" : ""}`, call, isRoot };
      cards.push(card);
      cardByKey.set(key, card);
    });
    const rows = Math.ceil(shown.length / MAX_PER_ROW);
    const cardsBottom = y + LANE_PADDING + (rows - 1) * ROW_H + NODE_H;
    if (collapsible) {
      toggles.push({ key: lane.key, x: cardsX, y: cardsBottom + 8, text: showAll ? "Show fewer" : `Show ${lane.calls.length - shown.length} more`, icon: showAll ? "minus" : "plus" });
    }
    const h = cardsBottom - y + LANE_PADDING + (collapsible ? TOGGLE_H : 0);
    lanes.push({ key: lane.key, x: FLOOR_LEFT, y, w: cardsW, h, isRoot });
    y += h + LANE_GAP;
  }
  y -= LANE_GAP;
  if (chain.canGoDeeper[bottomSide]) {
    deeper.push({ direction: bottomSide, x: deeperX, y: y + DEEPER_GAP });
    y += DEEPER_GAP + DEEPER_H;
  }

  const wires: WireView[] = [];
  const ports: PortView[] = [];
  const linkKeyOf = (side: CallDirection, levelIndex: number, linkedIndex: number) => (levelIndex === 0 ? ROOT_CARD_KEY : cardKeyOf(side, levelIndex - 1, linkedIndex));
  for (const side of ["callers", "callees"] as const) {
    const color = SIDE_COLORS[side];
    chain[side].forEach((level, levelIndex) =>
      level.calls.forEach((call, callIndex) => {
        const card = cardByKey.get(cardKeyOf(side, levelIndex, callIndex));
        if (!card) return;
        for (const linkedIndex of call.linkedTo) {
          const linked = cardByKey.get(linkKeyOf(side, levelIndex, linkedIndex));
          if (!linked) continue;
          const [upper, lower] = side === topSide ? [card, linked] : [linked, card];
          const route = routeWire({ ...upper, h: NODE_H }, { ...lower, h: NODE_H });
          wires.push({ cls: color, d: route.d });
          ports.push({ cls: color, x: route.x1, y: route.y1, incoming: false }, { cls: color, x: route.x2, y: route.y2, incoming: true });
        }
      }),
    );
  }
  return { lanes, cards, toggles, wires, ports, deeper, height: y + 16 };
}
