import { describe, expect, it } from "vitest";
import { buildViewData } from "../../../src/graph/neighbourhood";
import { navigationCards, nextCardKey, type NavigationCard } from "../../../src/webview/keyboardNavigation";
import { layout } from "../../../src/webview/layout";
import { DOCUMENT_SERVICE, serviceGraph } from "../helpers/fixtures";

const card = (key: string, floor: string, x: number, y: number): NavigationCard => ({ key, floor, x, y });
const cards = [
  card("callerLeft", "callers", 300, 50),
  card("callerRight", "callers", 500, 50),
  card("callerBelow", "callers", 450, 124),
  card("here", "mine", 400, 200),
  card("depsHeading", "deps", 140, 380),
  card("dependency", "deps", 140, 410),
  card("membersHeading", "members", 400, 380),
  card("upload", "members", 400, 410),
  card("download", "members", 400, 484),
  card("spec", "tests", 660, 380),
];

describe("nextCardKey", () => {
  it("moves down and up within a column, group headings included", () => {
    expect(nextCardKey(cards, "membersHeading", "ArrowDown")).toBe("upload");
    expect(nextCardKey(cards, "upload", "ArrowDown")).toBe("download");
    expect(nextCardKey(cards, "download", "ArrowUp")).toBe("upload");
  });

  it("stays put at the bottom of a column", () => {
    expect(nextCardKey(cards, "download", "ArrowDown")).toBeUndefined();
  });

  it("moves up from the top of a column to the current file, then to the nearest caller in the row above", () => {
    expect(nextCardKey(cards, "depsHeading", "ArrowUp")).toBe("here");
    expect(nextCardKey(cards, "here", "ArrowUp")).toBe("callerBelow");
    expect(nextCardKey(cards, "callerBelow", "ArrowUp")).toBe("callerRight");
  });

  it("moves right and left to the first card of the neighbouring column", () => {
    expect(nextCardKey(cards, "download", "ArrowRight")).toBe("spec");
    expect(nextCardKey(cards, "download", "ArrowLeft")).toBe("depsHeading");
    expect(nextCardKey(cards, "spec", "ArrowRight")).toBeUndefined();
  });

  it("skips an empty column when moving sideways", () => {
    const withoutMembers = cards.filter((candidate) => candidate.floor !== "members");
    expect(nextCardKey(withoutMembers, "dependency", "ArrowRight")).toBe("spec");
  });

  it("moves down from the current file to the first card in Members, or the first column with cards", () => {
    expect(nextCardKey(cards, "here", "ArrowDown")).toBe("membersHeading");
    expect(nextCardKey(cards.filter((candidate) => candidate.floor !== "members"), "here", "ArrowDown")).toBe("depsHeading");
    expect(nextCardKey(cards, "here", "ArrowLeft")).toBeUndefined();
  });

  it("moves sideways within a row of callers and down to the current file", () => {
    expect(nextCardKey(cards, "callerLeft", "ArrowRight")).toBe("callerRight");
    expect(nextCardKey(cards, "callerRight", "ArrowLeft")).toBe("callerLeft");
    expect(nextCardKey(cards, "callerRight", "ArrowRight")).toBeUndefined();
    expect(nextCardKey(cards, "callerRight", "ArrowDown")).toBe("callerBelow");
    expect(nextCardKey(cards, "callerBelow", "ArrowDown")).toBe("here");
  });

  it("returns nothing for a key that is not on the map", () => {
    expect(nextCardKey(cards, "missing", "ArrowDown")).toBeUndefined();
  });

  describe("when columns loop in focus mode", () => {
    const loopColumns = { loopColumns: true };

    it("should wrap right from Tests to the first card of Deps", () => {
      expect(nextCardKey(cards, "spec", "ArrowRight", loopColumns)).toBe("depsHeading");
    });

    it("should wrap left from Deps to the first card of Tests", () => {
      expect(nextCardKey(cards, "dependency", "ArrowLeft", loopColumns)).toBe("spec");
    });

    it("should move left from Members to the next column before wrapping", () => {
      expect(nextCardKey(cards, "membersHeading", "ArrowLeft", loopColumns)).toBe("depsHeading");
    });

    it("should skip an empty column while wrapping", () => {
      const withoutDeps = cards.filter((candidate) => candidate.floor !== "deps");

      expect(nextCardKey(withoutDeps, "spec", "ArrowRight", loopColumns)).toBe("membersHeading");
    });

    it("should stop at the last column without the option", () => {
      expect(nextCardKey(cards, "spec", "ArrowRight")).toBeUndefined();
    });
  });
});

describe("navigationCards", () => {
  it("places every card and group heading of the layout in the floor it sits on", () => {
    const { inner } = layout(buildViewData(serviceGraph(), DOCUMENT_SERVICE), { selected: DOCUMENT_SERVICE, layer: 1, open: {} }, 800);
    const floorOf = Object.fromEntries(navigationCards(inner).map((navigationCard) => [navigationCard.key, navigationCard.floor]));
    expect(floorOf).toMatchObject({
      "src/api/controllers/DocumentController.ts": "callers",
      [DOCUMENT_SERVICE]: "mine",
      "deps:dependency:collapsed": "deps",
      "src/db/repositories/DocumentRepository.ts": "deps",
      "test/services/DocumentService.spec.ts": "tests",
    });
    expect(Object.keys(floorOf)).toHaveLength(inner.nodes.length + inner.members.length + inner.groupHeadings.length);
  });

  describe("when focus mode lays out all three columns at the same place", () => {
    it("should still put each card in its own column", () => {
      const { inner } = layout(buildViewData(serviceGraph(), DOCUMENT_SERVICE), { selected: DOCUMENT_SERVICE, layer: 1, open: {}, focusedColumn: "members" }, 800);

      const floorOf = Object.fromEntries(navigationCards(inner).map((navigationCard) => [navigationCard.key, navigationCard.floor]));

      expect(floorOf).toMatchObject({ "src/db/repositories/DocumentRepository.ts": "deps", "test/services/DocumentService.spec.ts": "tests" });
    });
  });
});
