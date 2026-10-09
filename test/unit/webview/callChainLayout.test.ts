import { describe, expect, it } from "vitest";
import type { CallChain, ChainCall, LevelCall } from "../../../src/shared/viewData";
import { ROOT_CARD_KEY, layoutCallChain } from "../../../src/webview/callChainLayout";
import { NODE_W } from "../../../src/webview/layout";

const WIDTH = 1088;
const NARROW_WIDTH = 600;
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
    const { lanes } = layoutCallChain(invoiceChain(), {}, WIDTH, true);

    expect(lanes.map((lane) => [lane.key, lane.y, lane.h, lane.isRoot])).toEqual([
      ["chain:callers:0", 16, 84, false],
      ["chain:root", 140, 84, true],
      ["chain:callees:0", 264, 84, false],
      ["chain:callees:1", 388, 84, false],
    ]);
  });

  it("should centre the cards of a lane across the full width", () => {
    const { cards } = layoutCallChain(invoiceChain(), {}, WIDTH, true);

    expect({ root: cards.find((card) => card.key === ROOT_CARD_KEY)?.x, firstCallees: xsOfLane(cards, "chain:callees:0") }).toEqual({ root: 424, firstCallees: TWO_CARD_X });
  });

  it("should draw one wire for each link between neighbouring lanes", () => {
    const { wires } = layoutCallChain(invoiceChain(), {}, WIDTH, true);

    expect(wires).toHaveLength(5);
  });

  it("should colour the root card green and every other card, wire and port grey", () => {
    const { cards, wires, ports } = layoutCallChain(invoiceChain(), {}, WIDTH, true);

    expect({
      root: cards.filter((card) => card.isRoot).map((card) => card.cls),
      others: new Set([...cards.filter((card) => !card.isRoot), ...wires, ...ports].map((item) => item.cls)),
    }).toEqual({ root: ["green sel"], others: new Set(["grey"]) });
  });
});

describe("when choosing the width of the chain cards", () => {
  const cardWidthsAt = (width: number) => new Set(layoutCallChain(sixCallers(), { "chain:callers:0": true }, width, true).cards.map((card) => card.w));

  it("should make every card 240px wide when the pane has room for 4 of them", () => {
    expect(cardWidthsAt(WIDTH)).toEqual(new Set([240]));
  });

  it("should keep every card at the map card width when the pane is narrow", () => {
    expect(cardWidthsAt(NARROW_WIDTH)).toEqual(new Set([NODE_W]));
  });
});

describe("when a lane has more calls than one row holds", () => {
  it("should show 4 cards and a toggle for the rest", () => {
    const { cards, toggles } = layoutCallChain(sixCallers(), {}, WIDTH, true);

    expect({ xs: xsOfLane(cards, "chain:callers:0"), toggles: toggles.map((toggle) => toggle.text) }).toEqual({ xs: FOUR_CARD_X, toggles: ["Show 2 more"] });
  });

  it("should show all calls in rows of 4 when the toggle is on", () => {
    const { cards, toggles } = layoutCallChain(sixCallers(), { "chain:callers:0": true }, WIDTH, true);

    const callerCards = cards.filter((card) => card.key.startsWith("chain:callers:0:"));
    expect({ positions: callerCards.map((card) => [card.x, card.y]), toggles: toggles.map((toggle) => toggle.text) }).toEqual({
      positions: [[40, 30], [296, 30], [552, 30], [808, 30], [296, 104], [552, 104]],
      toggles: ["Show fewer"],
    });
  });

  it("should not draw wires to the hidden calls", () => {
    const collapsed = layoutCallChain(sixCallers(), {}, WIDTH, true);
    const expanded = layoutCallChain(sixCallers(), { "chain:callers:0": true }, WIDTH, true);

    expect(expanded.wires.length - collapsed.wires.length).toBe(2);
  });
});

describe("when the chain can go deeper", () => {
  it("should put a deeper button above the first lane and below the last one", () => {
    const { deeper, lanes } = layoutCallChain(invoiceChain({ canGoDeeper: { callers: true, callees: true } }), {}, WIDTH, true);

    const lastLane = lanes.at(-1)!;
    expect({ deeper: deeper.map((button) => [button.direction, button.y]), firstLaneY: lanes[0].y }).toEqual({
      deeper: [["callers", 16], ["callees", lastLane.y + lastLane.h + 14]],
      firstLaneY: 52,
    });
  });
});

describe("when the call chain direction is flipped", () => {
  it("should put callees above the selected function and callers below, deepest callee first", () => {
    const { lanes } = layoutCallChain(invoiceChain(), {}, WIDTH, false);

    expect(lanes.map((lane) => lane.key)).toEqual(["chain:callees:1", "chain:callees:0", "chain:root", "chain:callers:0"]);
  });

  it("should put the callees deeper button on top and the callers one at the bottom", () => {
    const { deeper } = layoutCallChain(invoiceChain({ canGoDeeper: { callers: true, callees: true } }), {}, WIDTH, false);

    expect(deeper.map((button) => button.direction)).toEqual(["callees", "callers"]);
  });

  it("should draw every wire from the upper card down to the lower one", () => {
    const { wires, ports } = layoutCallChain(invoiceChain(), {}, WIDTH, false);

    const outgoing = ports.filter((port) => !port.incoming);
    const incoming = ports.filter((port) => port.incoming);
    expect({ wires: wires.length, allDownwards: outgoing.every((port, index) => port.y < incoming[index].y) }).toEqual({ wires: 5, allDownwards: true });
  });
});
