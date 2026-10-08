import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeSource } from "../../../src/graph/analyzeSource";
import { CALL_CHAIN_DEPTH, CALLS_PER_LEVEL, type CallHierarchy, type CallPlace, CallChainBuilder, isInsideInterface, layerOf } from "../../../src/graph/callChain";
import type { CallDirection } from "../../../src/shared/viewData";

const CONTROLLER = "src/billing/InvoiceController.ts";
const SERVICE = "src/billing/InvoiceService.ts";
const MANAGER = "src/billing/InvoiceManager.ts";
const REPOSITORY = "src/billing/InvoiceRepository.ts";

interface FakeFunction {
  place: CallPlace | undefined;
  callers: string[];
  callees: string[];
}

function fakeHierarchy(functions: Record<string, Partial<FakeFunction>>) {
  const requests: string[] = [];
  const hierarchy: CallHierarchy<string> = {
    placeOf: (name) => ("place" in functions[name] ? functions[name].place : { file: `src/${name}.ts`, name, line: 1, isInterfaceMethod: false }),
    callsOf: async (name, direction: CallDirection) => {
      requests.push(`${direction} of ${name}`);
      return functions[name][direction] ?? [];
    },
  };
  const build = (root: string) => CallChainBuilder.build(hierarchy, root, hierarchy.placeOf(root)!);
  return { build, requests };
}

const at = (file: string, name: string, line = 1): CallPlace => ({ file, name, line, isInterfaceMethod: false });

function straightLine(length: number): Record<string, Partial<FakeFunction>> {
  const functions: Record<string, Partial<FakeFunction>> = {};
  for (let depth = 0; depth <= length; depth++) functions[`f${depth}`] = { callees: depth < length ? [`f${depth + 1}`] : [] };
  return functions;
}

const namesAtEachLevel = (levels: { calls: { name: string }[] }[]) => levels.map((level) => level.calls.map((call) => call.name));

describe("layerOf", () => {
  it.each([
    ["src/api/UserController.ts", "controller"],
    ["src/events/user.handler.ts", "handler"],
    ["src/graphql/UserResolver.ts", "resolver"],
    ["src/users/user-service.ts", "service"],
    ["src/users/UserManager.ts", "manager"],
    ["src/users/UserRepo.ts", "repo"],
    ["src/users/UserRepository.ts", "repo"],
    ["src/users/user.model.ts", "model"],
  ])("should name %s by its file name suffix as %s", (file, layer) => {
    expect(layerOf(file, 1)).toBe(layer);
  });

  it.each([
    ["src/controllers/users.ts", "controller"],
    ["src/repositories/users.ts", "repo"],
    ["src/db/repository/users.ts", "repo"],
    ["src/services/billing/invoice.ts", "service"],
  ])("should name %s by its folder as %s when the file name has no layer", (file, layer) => {
    expect(layerOf(file, 1)).toBe(layer);
  });

  it("should prefer the file name over the folder", () => {
    expect(layerOf("src/services/UserRepository.ts", 1)).toBe("repo");
  });

  it("should label a file with no layer by its depth", () => {
    expect(layerOf("src/utils/formatDate.ts", 2)).toBe("Depth 2");
  });
});

describe("isInsideInterface", () => {
  it("should find the interface method the sample manager calls, and not the class method", () => {
    const members = analyzeSource(MANAGER, readFileSync(`test/sample-project/${MANAGER}`, "utf8")).members;

    const insideInterface = [4, 14].map((line) => isInsideInterface(members, line));

    expect(insideInterface).toEqual([true, false]);
  });
});

describe("when building the call chain of the sample InvoiceService.sendInvoice", () => {
  const { build } = fakeHierarchy({
    send: { place: at(CONTROLLER, "send", 6), callees: ["sendInvoice"] },
    sendInvoice: { place: at(SERVICE, "sendInvoice", 10), callers: ["send"], callees: ["findById", "markSent"] },
    findById: { place: at(REPOSITORY, "findById", 7), callers: ["sendInvoice"] },
    markSent: { place: at(MANAGER, "markSent", 13), callers: ["sendInvoice"], callees: ["record", "save"] },
    record: { place: { ...at(MANAGER, "record", 4), isInterfaceMethod: true } },
    save: { place: at(REPOSITORY, "save", 11), callers: ["markSent"] },
  });

  it("should put the controller above and the repo and manager below, with their layers", async () => {
    const { chain } = await build("sendInvoice");

    expect({
      root: chain.root.layer,
      callers: chain.callers.map((level) => level.calls.map((call) => `${call.layer} ${call.name}`)),
      callees: chain.callees.map((level) => level.calls.map((call) => `${call.layer} ${call.name}${call.isInterfaceMethod ? " interface" : ""}`)),
    }).toEqual({
      root: "service",
      callers: [["controller send"]],
      callees: [["repo findById", "manager markSent"], ["manager record interface", "repo save"]],
    });
  });

  it("should return an empty caller side for a function with no callers", async () => {
    const { chain } = await build("send");

    expect({ callers: chain.callers, canGoDeeper: chain.canGoDeeper.callers }).toEqual({ callers: [], canGoDeeper: false });
  });
});

describe("when a call chain is longer than the depth limit", () => {
  it(`should load ${CALL_CHAIN_DEPTH} levels and offer to go deeper`, async () => {
    const { build } = fakeHierarchy(straightLine(5));

    const { chain } = await build("f0");

    expect({ callees: namesAtEachLevel(chain.callees), canGoDeeper: chain.canGoDeeper.callees }).toEqual({ callees: [["f1"], ["f2"], ["f3"]], canGoDeeper: true });
  });

  it("should add one callee level on deeper, asking only for the calls of the last level", async () => {
    const { build, requests } = fakeHierarchy(straightLine(5));
    const builder = await build("f0");
    requests.length = 0;

    await builder.deeper("callees");

    expect({ callees: namesAtEachLevel(builder.chain.callees), requests }).toEqual({ callees: [["f1"], ["f2"], ["f3"], ["f4"]], requests: ["callees of f3"] });
  });

  it("should stop offering to go deeper once a deeper level is empty", async () => {
    const { build } = fakeHierarchy(straightLine(4));
    const builder = await build("f0");

    await builder.deeper("callees");
    await builder.deeper("callees");

    expect({ levels: builder.chain.callees.length, canGoDeeper: builder.chain.canGoDeeper.callees }).toEqual({ levels: 4, canGoDeeper: false });
  });
});

describe("when a function has more callees than one level holds", () => {
  const calleeNames = Array.from({ length: CALLS_PER_LEVEL + 5 }, (_, index) => `callee${index}`);
  const functions: Record<string, Partial<FakeFunction>> = { root: { callees: calleeNames } };
  for (const name of calleeNames) functions[name] = { callees: [`${name}Child`] };
  for (const name of calleeNames) functions[`${name}Child`] = {};

  it(`should show ${CALLS_PER_LEVEL} and count the rest`, async () => {
    const { build } = fakeHierarchy(functions);

    const { chain } = await build("root");

    expect({ shown: chain.callees[0].calls.length, moreCount: chain.callees[0].moreCount }).toEqual({ shown: CALLS_PER_LEVEL, moreCount: 5 });
  });

  it("should build the next level only from the calls that are shown", async () => {
    const { build, requests } = fakeHierarchy(functions);

    await build("root");

    expect(requests.filter((request) => request.startsWith("callees of callee") && !request.endsWith("Child"))).toHaveLength(CALLS_PER_LEVEL);
  });
});

describe("when a function calls code outside the project", () => {
  it("should leave out calls into node_modules and built-ins", async () => {
    const { build } = fakeHierarchy({
      root: { callees: ["format", "lodashMap", "arrayMap"] },
      format: {},
      lodashMap: { place: at("node_modules/lodash/map.js", "map") },
      arrayMap: { place: undefined },
    });

    const { chain } = await build("root");

    expect(namesAtEachLevel(chain.callees)).toEqual([["format"]]);
  });
});

describe("when a function calls itself", () => {
  it("should not repeat it at the next level", async () => {
    const { build } = fakeHierarchy({ recurse: { callees: ["recurse", "helper"] }, helper: {} });

    const { chain } = await build("recurse");

    expect(namesAtEachLevel(chain.callees)).toEqual([["helper"]]);
  });
});
