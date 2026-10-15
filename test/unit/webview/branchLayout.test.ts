import { describe, expect, it } from "vitest";
import type { AffectedFile } from "../../../src/shared/viewData";
import { layoutBranch, type BranchChanges } from "../../../src/webview/branchLayout";

const WIDTH = 1088;
const SERVICE = "src/services/DocumentService.ts";
const CONTROLLER = "src/api/controllers/DocumentController.ts";

function changesWith(patch: Partial<BranchChanges> = {}): BranchChanges {
  return {
    state: "changes",
    branch: "feature/reminders",
    base: "origin/main",
    changed: [{ path: SERVICE, change: "modified", linesAdded: 12, linesRemoved: 3 }],
    importsChanged: [{ path: CONTROLLER, via: [SERVICE] }, { path: "src/jobs/SendReminderJob.ts", via: [SERVICE] }],
    oneStepFurther: [{ path: "src/api/routes.ts", via: [CONTROLLER] }],
    untested: [],
    testsToRun: [],
    otherFileCount: 0,
    ...patch,
  };
}

const sixImporters = (): AffectedFile[] => Array.from({ length: 6 }, (_, index) => ({ path: `src/jobs/Job${index}.ts`, via: [SERVICE] }));
const cardsIn = (cards: { column: string; path: string }[], column: string) => cards.filter((card) => card.column === column).map((card) => card.path);

describe("when laying out the branch changes", () => {
  it("should put changed files, their importers and the next step in three columns from left to right", () => {
    const { floors } = layoutBranch(changesWith(), {}, WIDTH);

    expect(floors.map((floor) => [floor.key, floor.x])).toEqual([
      ["changed", 16],
      ["importsChanged", 381],
      ["oneStepFurther", 746],
    ]);
  });

  it("should draw one wire from each file to each importer shown", () => {
    const { wires, ports } = layoutBranch(changesWith(), {}, WIDTH);

    expect({ wires: wires.length, ports: ports.length }).toEqual({ wires: 3, ports: 6 });
  });

  it("should draw the one step further cards dashed", () => {
    const { cards } = layoutBranch(changesWith(), {}, WIDTH);

    expect(cards.filter((card) => card.cls.includes("two")).map((card) => card.path)).toEqual(["src/api/routes.ts"]);
  });

  it("should show the line counts and folder on a changed card, and the changed file on an importer", () => {
    const { cards } = layoutBranch(changesWith(), {}, WIDTH);

    expect(cards.slice(0, 2).map((card) => card.detail)).toEqual(["+12 −3 · src/services", "via DocumentService.ts · src/api/controllers"]);
  });

  it("should mark an empty column so it shows its empty text", () => {
    const { floors } = layoutBranch(changesWith({ oneStepFurther: [] }), {}, WIDTH);

    expect(floors.map((floor) => floor.cls)).toEqual(["", "", "empty"]);
  });
});

describe("when a column has more files than a group shows", () => {
  it("should show 4 cards and a toggle for the rest", () => {
    const { cards, toggles } = layoutBranch(changesWith({ importsChanged: sixImporters(), oneStepFurther: [] }), {}, WIDTH);

    expect({ shown: cardsIn(cards, "importsChanged").length, toggles: toggles.map((toggle) => toggle.text) }).toEqual({ shown: 4, toggles: ["Show 2 more"] });
  });

  it("should show every card when the toggle is on", () => {
    const { cards, toggles } = layoutBranch(changesWith({ importsChanged: sixImporters(), oneStepFurther: [] }), { "branch:importsChanged:more": true }, WIDTH);

    expect({ shown: cardsIn(cards, "importsChanged").length, toggles: toggles.map((toggle) => toggle.text) }).toEqual({ shown: 6, toggles: ["Show fewer"] });
  });

  it("should not draw wires to the hidden cards", () => {
    const { wires } = layoutBranch(changesWith({ importsChanged: sixImporters(), oneStepFurther: [] }), {}, WIDTH);

    expect(wires).toHaveLength(4);
  });
});

describe("when a changed file has no test", () => {
  it("should list it in a box under the columns", () => {
    const { banner, floors } = layoutBranch(changesWith({ untested: ["src/jobs/SendReminderJob.ts"] }), {}, WIDTH);

    expect({ items: banner?.items, belowColumns: banner!.y > floors[0].y + floors[0].h }).toEqual({ items: [{ label: "SendReminderJob.ts", value: "src/jobs" }], belowColumns: true });
  });
});
