import { describe, expect, it } from "vitest";
import type { CallChain, ChainCall, LevelCall } from "../../../src/shared/viewData";
import { ROOT_CARD_KEY, layoutCallChain } from "../../../src/webview/callChainLayout";
import { NODE_W } from "../../../src/webview/layout";

const WIDTH = 1088;
const NARROW_WIDTH = 600;
const EDITOR_FONT_SIZE = 13;
const TWO_CARD_X = [296, 552];
const FOUR_CARD_X = [40, 296, 552, 808];

const call = (name: string, extra: Partial<LevelCall> = {}): LevelCall => ({ file: `src/billing/${name}.ts`, name, line: 1, isInterfaceMethod: false, linkedTo: [0], ...extra });
const rootCall: ChainCall = { file: "src/billing/InvoiceService.ts", name: "sendInvoice", line: 10, isInterfaceMethod: false };

function invoiceChain(patch: Partial<CallChain> = {}): CallChain {
  return {
    root: rootCall,
    callers: [{ calls: [call("send")], moreCount: 0 }],
    callees: [
      { calls: [call("findById"), call("markSent")], moreCount: 0 },
      { calls: [call("record", { linkedTo: [1], isInterfaceMethod: true }), call("save", { linkedTo: [1] })], moreCount: 0 },
    ],
    canGoDeeper: { callers: false, callees: false },
    ...patch,
  };
}

const sixCallers = () => invoiceChain({ callers: [{ calls: Array.from({ length: 6 }, (_, index) => call(`caller${index}`)), moreCount: 0 }] });
const xsOfLane = (cards: { key: string; x: number }[], laneKey: string) => cards.filter((card) => card.key.startsWith(`${laneKey}:`)).map((card) => card.x);

describe("when laying out the call chain of a service method", () => {
  it("should put callers above the selected function and callees below, one lane per depth", () => {
    const { lanes } = layoutCallChain(invoiceChain(), {}, WIDTH, true, EDITOR_FONT_SIZE);

    expect(lanes.map((lane) => [lane.key, lane.y, lane.h, lane.isRoot])).toEqual([
      ["chain:callers:0", 16, 101, false],
      ["chain:root", 157, 101, true],
      ["chain:callees:0", 298, 101, false],
      ["chain:callees:1", 439, 101, false],
    ]);
  });

  it("should centre the cards of a lane across the full width", () => {
    const { cards } = layoutCallChain(invoiceChain(), {}, WIDTH, true, EDITOR_FONT_SIZE);

    expect({ root: cards.find((card) => card.key === ROOT_CARD_KEY)?.x, firstCallees: xsOfLane(cards, "chain:callees:0") }).toEqual({ root: 424, firstCallees: TWO_CARD_X });
  });

  it("should draw one wire for each link between neighbouring lanes", () => {
    const { wires } = layoutCallChain(invoiceChain(), {}, WIDTH, true, EDITOR_FONT_SIZE);

    expect(wires).toHaveLength(5);
  });

  it("should colour the root card green, callers blue and callees violet", () => {
    const { cards } = layoutCallChain(invoiceChain(), {}, WIDTH, true, EDITOR_FONT_SIZE);

    expect(cards.map((card) => [card.key, card.cls])).toEqual([
      ["chain:callers:0:0", "blue"],
      [ROOT_CARD_KEY, "green sel"],
      ["chain:callees:0:0", "violet"],
      ["chain:callees:0:1", "violet"],
      ["chain:callees:1:0", "violet"],
      ["chain:callees:1:1", "violet"],
    ]);
  });

  it("should colour each wire and port like the side it belongs to", () => {
    const { wires, ports } = layoutCallChain(invoiceChain(), {}, WIDTH, true, EDITOR_FONT_SIZE);

    expect({ wires: wires.map((wire) => wire.cls), ports: ports.map((port) => port.cls) }).toEqual({
      wires: ["blue", "violet", "violet", "violet", "violet"],
      ports: ["blue", "blue", "violet", "violet", "violet", "violet", "violet", "violet", "violet", "violet"],
    });
  });
});

describe("when the editor font size is larger", () => {
  const cardAndLaneHeightAt = (editorFontSize: number) => {
    const { cards, lanes } = layoutCallChain(invoiceChain(), {}, WIDTH, true, editorFontSize);
    return { cardH: cards[0].h, laneH: lanes[0].h };
  };

  it("should make the chain cards and lanes taller", () => {
    const small = cardAndLaneHeightAt(13);

    const large = cardAndLaneHeightAt(20);

    expect({ tallerCards: large.cardH > small.cardH, tallerLanes: large.laneH > small.laneH }).toEqual({ tallerCards: true, tallerLanes: true });
  });
});

describe("when choosing the width of the chain cards", () => {
  const cardWidthsAt = (width: number) => new Set(layoutCallChain(sixCallers(), { "chain:callers:0": true }, width, true, EDITOR_FONT_SIZE).cards.map((card) => card.w));

  it("should make every card 240px wide when the pane has room for 4 of them", () => {
    expect(cardWidthsAt(WIDTH)).toEqual(new Set([240]));
  });

  it("should keep every card at the map card width when the pane is narrow", () => {
    expect(cardWidthsAt(NARROW_WIDTH)).toEqual(new Set([NODE_W]));
  });
});

describe("when a lane has more calls than one row holds", () => {
  it("should show 4 cards and a toggle for the rest", () => {
    const { cards, toggles } = layoutCallChain(sixCallers(), {}, WIDTH, true, EDITOR_FONT_SIZE);

    expect({ xs: xsOfLane(cards, "chain:callers:0"), toggles: toggles.map((toggle) => toggle.text) }).toEqual({ xs: FOUR_CARD_X, toggles: ["Show 2 more"] });
  });

  it("should show all calls in rows of 4 when the toggle is on", () => {
    const { cards, toggles } = layoutCallChain(sixCallers(), { "chain:callers:0": true }, WIDTH, true, EDITOR_FONT_SIZE);

    const callerCards = cards.filter((card) => card.key.startsWith("chain:callers:0:"));
    expect({ positions: callerCards.map((card) => [card.x, card.y]), toggles: toggles.map((toggle) => toggle.text) }).toEqual({
      positions: [[40, 30], [296, 30], [552, 30], [808, 30], [296, 121], [552, 121]],
      toggles: ["Show fewer"],
    });
  });

  it("should not draw wires to the hidden calls", () => {
    const collapsed = layoutCallChain(sixCallers(), {}, WIDTH, true, EDITOR_FONT_SIZE);
    const expanded = layoutCallChain(sixCallers(), { "chain:callers:0": true }, WIDTH, true, EDITOR_FONT_SIZE);

    expect(expanded.wires.length - collapsed.wires.length).toBe(2);
  });
});

describe("when the chain can go deeper", () => {
  it("should put a deeper button above the first lane and below the last one", () => {
    const { deeper, lanes } = layoutCallChain(invoiceChain({ canGoDeeper: { callers: true, callees: true } }), {}, WIDTH, true, EDITOR_FONT_SIZE);

    const lastLane = lanes.at(-1)!;
    expect({ deeper: deeper.map((button) => [button.direction, button.y]), firstLaneY: lanes[0].y }).toEqual({
      deeper: [["callers", 16], ["callees", lastLane.y + lastLane.h + 14]],
      firstLaneY: 52,
    });
  });
});

describe("when the call chain direction is flipped", () => {
  it("should put callees above the selected function and callers below, deepest callee first", () => {
    const { lanes } = layoutCallChain(invoiceChain(), {}, WIDTH, false, EDITOR_FONT_SIZE);

    expect(lanes.map((lane) => lane.key)).toEqual(["chain:callees:1", "chain:callees:0", "chain:root", "chain:callers:0"]);
  });

  it("should put the callees deeper button on top and the callers one at the bottom", () => {
    const { deeper } = layoutCallChain(invoiceChain({ canGoDeeper: { callers: true, callees: true } }), {}, WIDTH, false, EDITOR_FONT_SIZE);

    expect(deeper.map((button) => button.direction)).toEqual(["callees", "callers"]);
  });

  it("should draw every wire from the upper card down to the lower one", () => {
    const { wires, ports } = layoutCallChain(invoiceChain(), {}, WIDTH, false, EDITOR_FONT_SIZE);

    const outgoing = ports.filter((port) => !port.incoming);
    const incoming = ports.filter((port) => port.incoming);
    expect({ wires: wires.length, allDownwards: outgoing.every((port, index) => port.y < incoming[index].y) }).toEqual({ wires: 5, allDownwards: true });
  });
});
