import { describe, expect, it } from "vitest";
import type { CallChain, ChainCall, LevelCall } from "../../../src/shared/viewData";
import { ROOT_CARD_KEY, layoutCallChain } from "../../../src/webview/callChainLayout";

const WIDTH = 800;
const TWO_CARD_X = [296, 464];
const FOUR_CARD_X = [128, 296, 464, 632];

const call = (name: string, layer: string, extra: Partial<LevelCall> = {}): LevelCall => ({ file: `src/billing/${name}.ts`, name, line: 1, layer, isInterfaceMethod: false, linkedTo: [0], ...extra });
const rootCall: ChainCall = { file: "src/billing/InvoiceService.ts", name: "sendInvoice", line: 10, layer: "service", isInterfaceMethod: false };

function invoiceChain(patch: Partial<CallChain> = {}): CallChain {
  return {
    root: rootCall,
    callers: [{ calls: [call("send", "controller")], moreCount: 0 }],
    callees: [
      { calls: [call("findById", "repo"), call("markSent", "manager")], moreCount: 0 },
      { calls: [call("record", "manager", { linkedTo: [1], isInterfaceMethod: true }), call("save", "repo", { linkedTo: [1] })], moreCount: 0 },
    ],
    canGoDeeper: { callers: false, callees: false },
    ...patch,
  };
}

const sixCallers = () => invoiceChain({ callers: [{ calls: Array.from({ length: 6 }, (_, index) => call(`caller${index}`, "controller")), moreCount: 0 }] });
const xsOfLane = (cards: { key: string; x: number }[], laneKey: string) => cards.filter((card) => card.key.startsWith(`${laneKey}:`)).map((card) => card.x);

describe("when laying out the call chain of a service method", () => {
  it("should put callers above the selected function and callees below, one labelled lane per depth", () => {
    const { lanes } = layoutCallChain(invoiceChain(), {}, WIDTH);

    expect(lanes.map((lane) => [lane.label, lane.y, lane.h, lane.isRoot])).toEqual([
      ["Controller", 16, 84, false],
      ["Service", 140, 84, true],
      ["Repository / Manager", 264, 84, false],
      ["Manager / Repository", 388, 84, false],
    ]);
  });

  it("should centre the cards of a lane in the space right of the label", () => {
    const { cards } = layoutCallChain(invoiceChain(), {}, WIDTH);

    expect({ root: cards.find((card) => card.key === ROOT_CARD_KEY)?.x, firstCallees: xsOfLane(cards, "chain:callees:0") }).toEqual({ root: 380, firstCallees: TWO_CARD_X });
  });

  it("should draw one wire for each link between neighbouring lanes", () => {
    const { wires } = layoutCallChain(invoiceChain(), {}, WIDTH);

    expect(wires.map((wire) => wire.cls)).toEqual(["blue", "violet", "violet", "violet", "violet"]);
  });
});

describe("when a lane has more calls than one row holds", () => {
  it("should show 4 cards and a toggle for the rest", () => {
    const { cards, toggles } = layoutCallChain(sixCallers(), {}, WIDTH);

    expect({ xs: xsOfLane(cards, "chain:callers:0"), toggles: toggles.map((toggle) => toggle.text) }).toEqual({ xs: FOUR_CARD_X, toggles: ["Show 2 more"] });
  });

  it("should show all calls in rows of 4 when the toggle is on", () => {
    const { cards, toggles } = layoutCallChain(sixCallers(), { "chain:callers:0": true }, WIDTH);

    const callerCards = cards.filter((card) => card.key.startsWith("chain:callers:0:"));
    expect({ positions: callerCards.map((card) => [card.x, card.y]), toggles: toggles.map((toggle) => toggle.text) }).toEqual({
      positions: [[128, 30], [296, 30], [464, 30], [632, 30], [296, 104], [464, 104]],
      toggles: ["Show fewer"],
    });
  });

  it("should not draw wires to the hidden calls", () => {
    const { wires } = layoutCallChain(sixCallers(), {}, WIDTH);

    expect(wires.filter((wire) => wire.cls === "blue")).toHaveLength(4);
  });
});

describe("when the chain can go deeper", () => {
  it("should put a deeper button above the first lane and below the last one", () => {
    const { deeper, lanes } = layoutCallChain(invoiceChain({ canGoDeeper: { callers: true, callees: true } }), {}, WIDTH);

    const lastLane = lanes.at(-1)!;
    expect({ deeper: deeper.map((button) => [button.direction, button.y]), firstLaneY: lanes[0].y }).toEqual({
      deeper: [["callers", 16], ["callees", lastLane.y + lastLane.h + 14]],
      firstLaneY: 52,
    });
  });
});
