import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeSource } from "../../../src/graph/analyzeSource";
import { buildViewData } from "../../../src/graph/neighbourhood";
import type { ComponentLink } from "../../../src/shared/viewData";
import { DOCUMENT_SERVICE, analysisOf, graphOf, serviceGraph } from "../helpers/fixtures";

const kinds = (view: ReturnType<typeof buildViewData>) =>
  Object.fromEntries(view.nodes.map((node) => [node.id, `${node.kind}${node.secondLayer ? " (second)" : ""}`]));

describe("buildViewData", () => {
  it("places every connection of the typical service sample", () => {
    expect(kinds(buildViewData(serviceGraph(), DOCUMENT_SERVICE))).toEqual({
      [DOCUMENT_SERVICE]: "here",
      "src/api/controllers/DocumentController.ts": "caller",
      "src/jobs/SendReminderJob.ts": "caller",
      "test/services/DocumentService.spec.ts": "test",
      "src/db/repositories/DocumentRepository.ts": "dependency",
      "src/integrations/storage/StorageClient.ts": "dependency",
      "src/auth/PermissionPolicy.ts": "dependency",
      "src/types/document.types.ts": "types",
      "expected:src/services/IDocumentService.ts": "expected",
      "src/api/routes.ts": "caller (second)",
      "src/jobs/scheduler.ts": "caller (second)",
      "src/db/schema.ts": "dependency (second)",
      "src/config/storage.config.ts": "dependency (second)",
      "src/auth/roles.ts": "dependency (second)",
      "test/fixtures/documents.fixture.ts": "dependency (second)",
    });
  });

  it("connects second-layer files through the immediate layer", () => {
    const view = buildViewData(serviceGraph(), DOCUMENT_SERVICE);
    expect(view.nodes.find((node) => node.id === "src/api/routes.ts")?.via).toEqual(["src/api/controllers/DocumentController.ts"]);
    expect(view.edges).toContainEqual({ from: "src/api/routes.ts", to: "src/api/controllers/DocumentController.ts", style: "solid" });
    expect(view.edges).toContainEqual({ from: DOCUMENT_SERVICE, to: "expected:src/services/IDocumentService.ts", style: "dashed" });
  });

  it("collects usage lines, call sites and gutter marks", () => {
    const view = buildViewData(serviceGraph(), DOCUMENT_SERVICE);
    const repository = view.nodes.find((node) => node.id === "src/db/repositories/DocumentRepository.ts")!;
    expect(repository.usageInOpenFile.map((site) => site.line)).toEqual([1, 15]);
    const controller = view.nodes.find((node) => node.id === "src/api/controllers/DocumentController.ts")!;
    expect(controller.callSites).toEqual([
      { line: 1, text: 'import { DocumentService } from "src/services/DocumentService.ts"' },
      { line: 27, text: "return this.service.listForEmployee(actor, id)" },
    ]);
    expect(view.lineMarks).toContainEqual({ line: 15, nodeId: "src/db/repositories/DocumentRepository.ts" });
  });

  it("lists facts and pattern checks for the open file", () => {
    const center = buildViewData(serviceGraph(), DOCUMENT_SERVICE).nodes[0];
    expect(center.facts).toContainEqual({ label: "Size", value: "31 lines" });
    expect(center.facts).toContainEqual({ label: "Public methods", value: "listForEmployee, upload, remindUnsigned" });
    expect(center.checks).toContainEqual({ label: "Missing", value: "IDocumentService.ts: 4 of 4 files in src/services have a matching interface file." });
  });

  it("marks the file under test when a test file is open", () => {
    const view = buildViewData(serviceGraph(), "test/services/DocumentService.spec.ts");
    expect(view.nodes.find((node) => node.id === DOCUMENT_SERVICE)?.kind).toBe("subject");
  });

  it("shows both directions of a circular import", () => {
    const view = buildViewData(graphOf([analysisOf("src/a.ts", ["src/b.ts"]), analysisOf("src/b.ts", ["src/a.ts"])]), "src/a.ts");
    expect(view.nodes.find((node) => node.id === "src/b.ts")?.kind).toBe("cycle");
    expect(view.edges).toEqual([
      { from: "src/a.ts", to: "src/b.ts", style: "solid", label: "circular import" },
      { from: "src/b.ts", to: "src/a.ts", style: "solid" },
    ]);
  });

  it("explains what was checked when nothing connects to a file", () => {
    const view = buildViewData(graphOf([analysisOf("src/utils/currency.ts")]), "src/utils/currency.ts", { packageJsonText: '{"scripts":{}}' });
    expect(view.nodes).toHaveLength(1);
    expect(view.orphanChecks?.map((check) => check.label)).toEqual(["imports", "dynamic", "config"]);
  });
  it("adds a package node with its import line as a gutter mark", () => {
    const view = buildViewData(graphOf([analysisOf("src/a.ts", ["pkg:zod"])]), "src/a.ts");
    expect(view.nodes.find((node) => node.id === "package:zod")).toMatchObject({ kind: "package", name: "zod", usageInOpenFile: [{ line: 1 }] });
    expect(view.edges).toContainEqual({ from: "src/a.ts", to: "package:zod", style: "solid" });
    expect(view.lineMarks).toEqual([{ line: 1, nodeId: "package:zod" }]);
    expect(view.orphanChecks).toBeNull();
  });

  it("states the line numbers of both imports in a circular import", () => {
    const view = buildViewData(graphOf([analysisOf("src/a.ts", ["src/b.ts"]), analysisOf("src/b.ts", ["src/c.ts", "src/a.ts"])]), "src/a.ts");
    expect(view.nodes[0].checks).toContainEqual({ label: "Circular import", value: "b.ts: a.ts imports it on line 1. It imports a.ts on line 2." });
  });

  it("flags a file that no test imports, and not one that has a test", () => {
    const lonely = buildViewData(graphOf([analysisOf("src/a.ts")]), "src/a.ts");
    expect(lonely.nodes[0].checks).toContainEqual({ label: "Tests", value: "No test imports this file." });
    const service = buildViewData(serviceGraph(), DOCUMENT_SERVICE);
    expect(service.nodes[0].checks.map((check) => check.label)).not.toContain("Tests");
  });

  it("lists the members of the open sample DocumentService with their lines", () => {
    const text = readFileSync("test/sample-project/src/services/DocumentService.ts", "utf8");
    const view = buildViewData(graphOf([analyzeSource(DOCUMENT_SERVICE, text)]), DOCUMENT_SERVICE);
    expect(view.members.map(({ name, kind, line, exported }) => `${kind} ${name} line ${line}${exported ? " exported" : ""}`)).toEqual([
      "class DocumentService line 6 exported",
      "property documents line 8",
      "property storage line 9",
      "property permissions line 10",
      "method listForEmployee line 13 exported",
      "method upload line 18 exported",
    ]);
  });
});

describe("when a test file is open", () => {
  const subjectNodeOf = (view: ReturnType<typeof buildViewData>) => view.nodes.find((node) => node.kind === "subject");

  it("should show the imported subject of an integration test with a solid edge", () => {
    const graph = graphOf([analysisOf("src/a/Foo.ts"), analysisOf("src/a/__tests__/Foo.int.test.ts", ["src/a/Foo.ts"])]);

    const view = buildViewData(graph, "src/a/__tests__/Foo.int.test.ts");

    expect(subjectNodeOf(view)?.id).toBe("src/a/Foo.ts");
    expect(view.edges).toContainEqual({ from: "src/a/__tests__/Foo.int.test.ts", to: "src/a/Foo.ts", style: "solid" });
  });

  it("should mark a subject found by file name only, with no edge from the test", () => {
    const graph = graphOf([analysisOf("src/a/Foo.ts"), analysisOf("src/a/__tests__/Foo.int.test.ts")]);

    const view = buildViewData(graph, "src/a/__tests__/Foo.int.test.ts");

    expect(subjectNodeOf(view)).toMatchObject({ id: "src/a/Foo.ts", matchedByFileName: true });
    expect(view.edges.filter((edge) => edge.to === "src/a/Foo.ts")).toEqual([]);
  });

  it("should show no subject when no file matches the test name", () => {
    const graph = graphOf([analysisOf("src/a/Bar.ts"), analysisOf("src/a/__tests__/Foo.int.test.ts")]);

    const view = buildViewData(graph, "src/a/__tests__/Foo.int.test.ts");

    expect(subjectNodeOf(view)).toBeUndefined();
  });
});

describe("when a test file of a subject with other tests is open", () => {
  const SUBJECT = "src/a/Foo.ts";
  const INTEGRATION_TEST = "src/a/__tests__/Foo.int.test.ts";
  const UNIT_TEST = "src/a/Foo.test.ts";
  const viewOfIntegrationTest = (integrationTestImports: string[]) =>
    buildViewData(graphOf([analysisOf(SUBJECT), analysisOf(UNIT_TEST, [SUBJECT]), analysisOf(INTEGRATION_TEST, integrationTestImports)]), INTEGRATION_TEST);
  const testNodeIdsOf = (view: ReturnType<typeof buildViewData>) => view.nodes.filter((node) => node.kind === "test").map((node) => node.id);

  it("should list the other test of the subject with an edge to the subject", () => {
    const view = viewOfIntegrationTest([SUBJECT]);

    expect(testNodeIdsOf(view)).toEqual([UNIT_TEST]);
    expect(view.edges).toContainEqual({ from: UNIT_TEST, to: SUBJECT, style: "solid" });
  });

  it("should list the other test when the subject is found by file name only", () => {
    const view = viewOfIntegrationTest([]);

    expect(testNodeIdsOf(view)).toEqual([UNIT_TEST]);
  });

  it("should not add a no-other-test check", () => {
    const view = viewOfIntegrationTest([SUBJECT]);

    expect(view.nodes[0].checks.map((check) => check.label)).not.toContain("Tests");
  });
});

describe("when a test file is the only test of its subject", () => {
  it("should leave the open test out of the tests and say no other test covers the subject", () => {
    const graph = graphOf([analysisOf("src/a/Foo.ts"), analysisOf("src/a/Foo.test.ts", ["src/a/Foo.ts"])]);

    const view = buildViewData(graph, "src/a/Foo.test.ts");

    expect(view.nodes.filter((node) => node.kind === "test")).toEqual([]);
    expect(view.nodes[0].checks).toContainEqual({ label: "Tests", value: "No other test covers Foo.ts." });
  });
});

describe("when the open test file has a test marked .only", () => {
  const SPEC = "test/services/DocumentService.spec.ts";
  const specWithOnly = analysisOf(SPEC, [], {
    members: [
      { name: "uploads", kind: "test", line: 4, endLine: 6, exported: false },
      { name: "lists", kind: "test", line: 8, endLine: 10, exported: false, focus: "only" },
      { name: "reminds", kind: "test", line: 12, endLine: 14, exported: false, focus: "skip" },
    ],
  });

  it("should add one check on the open file naming the line of the .only", () => {
    const openFile = buildViewData(graphOf([specWithOnly]), SPEC).nodes[0];

    expect(openFile.checks.filter((check) => check.label === "Only")).toEqual([{ label: "Only", value: ".only on line 8 skips every other test." }]);
  });
});

describe("when the open test file has two tests marked .only", () => {
  const SPEC = "test/services/DocumentService.spec.ts";
  const specWithTwoOnly = analysisOf(SPEC, [], {
    members: [
      { name: "uploads", kind: "test", line: 4, endLine: 6, exported: false, focus: "only" },
      { name: "lists", kind: "test", line: 8, endLine: 10, exported: false, focus: "only" },
    ],
  });

  it("should add one check per .only", () => {
    const openFile = buildViewData(graphOf([specWithTwoOnly]), SPEC).nodes[0];

    expect(openFile.checks.filter((check) => check.label === "Only")).toHaveLength(2);
  });
});

describe("when the open file defines members that other files use", () => {
  const GROUP_SERVICE = "src/services/GroupService.ts";
  const groupService = `export const MAX_GROUPS = 10;

export function groupLabel(name: string) {
  return name.trim();
}

function normalise(name: string) {
  return name.toLowerCase();
}

export class GroupService {
  rename(name: string) {
    return normalise(name);
  }

  remove(id: string) {
    return id;
  }
}
`;
  const controller = `import { GroupService, groupLabel } from "../services/GroupService";

export class GroupController {
  constructor(private readonly groups: GroupService) {}

  delete(id: string) {
    return this.groups.remove(id);
  }
}
`;
  const job = `import { GroupService, MAX_GROUPS } from "../services/GroupService";

export function cleanUp(groups: GroupService) {
  groups.remove("old");
  return MAX_GROUPS;
}
`;
  const page = `import { MAX_GROUPS, groupLabel } from "../services/GroupService";

export const title = groupLabel("Groups") + MAX_GROUPS;
`;
  const importingGroupService = (path: string, text: string) => {
    const analysis = analyzeSource(path, text);
    return { ...analysis, imports: analysis.imports.map((record) => ({ ...record, specifier: GROUP_SERVICE })) };
  };
  const memberNamed = (name: string) => {
    const graph = graphOf([
      analyzeSource(GROUP_SERVICE, groupService),
      importingGroupService("src/api/GroupController.ts", controller),
      importingGroupService("src/jobs/cleanUp.ts", job),
      importingGroupService("src/ui/page.ts", page),
    ]);
    return buildViewData(graph, GROUP_SERVICE).members.find((member) => member.name === name)!;
  };

  it("should list each file that calls a method of the imported class, at the line of the call", () => {
    const remove = memberNamed("remove");

    expect(remove.usedIn).toEqual([
      { file: "src/api/GroupController.ts", line: 7 },
      { file: "src/jobs/cleanUp.ts", line: 4 },
    ]);
  });

  it("should list each file that imports an exported constant, at the first line that uses it", () => {
    const maxGroups = memberNamed("MAX_GROUPS");

    expect(maxGroups.usedIn).toEqual([
      { file: "src/jobs/cleanUp.ts", line: 5 },
      { file: "src/ui/page.ts", line: 3 },
    ]);
  });

  it("should list each file that imports an exported function", () => {
    const label = memberNamed("groupLabel");

    expect(label.usedIn?.map((use) => use.file)).toEqual(["src/api/GroupController.ts", "src/ui/page.ts"]);
  });

  it("should list each file that imports an exported class", () => {
    const service = memberNamed("GroupService");

    expect(service.usedIn?.map((use) => use.file)).toEqual(["src/api/GroupController.ts", "src/jobs/cleanUp.ts"]);
  });

  it("should mark a function that only its own file calls as used in its own file", () => {
    const normalise = memberNamed("normalise");

    expect(normalise).toMatchObject({ usedIn: [], usedInOwnFile: true });
  });

  it("should report no use for a method that no file calls", () => {
    const rename = memberNamed("rename");

    expect(rename).toMatchObject({ usedIn: [], usedInOwnFile: false });
  });

  it("should leave the usage off test cases", () => {
    const spec = analyzeSource("test/a.spec.ts", 'describe("a", () => { it("works", () => {}); });');

    const members = buildViewData(graphOf([spec]), "test/a.spec.ts").members;

    expect(members.map((member) => member.usedIn)).toEqual([undefined, undefined]);
  });
});

describe("when the open file is a React component", () => {
  const USER_CARD = "src/ui/UserCard.tsx";
  const component = (path: string, rendered: string[] = []) => {
    const name = path.slice(path.lastIndexOf("/") + 1).replace(/\..*$/, "");
    const imports = rendered.map((child) => `import { ${child} } from "src/ui/${child}.tsx";`);
    const elements = rendered.map((child) => `<${child} />`).join("");
    return analyzeSource(path, [...imports, `export function ${name}() {`, `  return <div>${elements}</div>;`, "}"].join("\n"));
  };
  const userCardTree = () =>
    buildViewData(
      graphOf([
        component(USER_CARD, ["Avatar"]),
        component("src/ui/Avatar.tsx", ["Image"]),
        component("src/ui/Image.tsx"),
        component("src/ui/TeamList.tsx", ["UserCard"]),
        component("src/ui/ProfileHeader.tsx", ["UserCard"]),
        component("src/pages/ProfilePage.tsx", ["ProfileHeader"]),
        analyzeSource("src/ui/CommentItem.tsx", 'import { UserCard } from "src/ui/UserCard.tsx";\n\nexport function CommentItem() {\n  return <UserCard />;\n}'),
        analyzeSource("src/ui/cardTitle.ts", 'import { UserCard } from "src/ui/UserCard.tsx";\nexport const cardTitle = UserCard.name;'),
      ]),
      USER_CARD,
    ).componentTree!;
  const namesOf = (links: ComponentLink[]): unknown[] => links.map((link) => (link.links.length ? [link.name, namesOf(link.links)] : link.name));

  it("should list the components that render it, with the line that renders it", () => {
    const tree = userCardTree();

    expect(tree.renderedBy.map((link) => [link.file, link.line])).toEqual([
      ["src/ui/CommentItem.tsx", 4],
      ["src/ui/ProfileHeader.tsx", 3],
      ["src/ui/TeamList.tsx", 3],
    ]);
  });

  it("should nest the components that render each parent under it", () => {
    const tree = userCardTree();

    expect(namesOf(tree.renderedBy)).toEqual(["CommentItem", ["ProfileHeader", ["ProfilePage"]], "TeamList"]);
  });

  it("should nest what each rendered component renders in turn", () => {
    const tree = userCardTree();

    expect(namesOf(tree.renders)).toEqual([["Avatar", ["Image"]]]);
    expect(tree.renders[0]).toMatchObject({ file: "src/ui/Avatar.tsx", line: 3 });
  });

  it("should stop at a component that is already an ancestor when components render each other", () => {
    const graph = graphOf([component("src/ui/Tree.tsx", ["Branch"]), component("src/ui/Branch.tsx", ["Tree"])]);

    const tree = buildViewData(graph, "src/ui/Tree.tsx").componentTree!;

    expect([namesOf(tree.renders), namesOf(tree.renderedBy)]).toEqual([[["Branch", ["Tree"]]], [["Branch", ["Tree"]]]]);
  });

  it("should stop after three levels", () => {
    const chain = ["Level1", "Level2", "Level3", "Level4"];
    const graph = graphOf([component("src/ui/Root.tsx", ["Level1"]), ...chain.map((name, index) => component(`src/ui/${name}.tsx`, chain.slice(index + 1, index + 2)))]);

    const tree = buildViewData(graph, "src/ui/Root.tsx").componentTree!;

    expect(namesOf(tree.renders)).toEqual([["Level1", [["Level2", ["Level3"]]]]]);
  });

  it("should leave a test that renders the component out of Rendered by", () => {
    const graph = graphOf([component(USER_CARD), component("src/ui/TeamList.tsx", ["UserCard"]), component("src/ui/UserCard.test.tsx", ["UserCard"])]);

    const tree = buildViewData(graph, USER_CARD).componentTree!;

    expect(tree.renderedBy.map((link) => link.file)).toEqual(["src/ui/TeamList.tsx"]);
  });

  it("should have no component tree for an open test file that renders JSX", () => {
    const graph = graphOf([component(USER_CARD), component("src/ui/UserCard.test.tsx", ["UserCard"])]);

    const view = buildViewData(graph, "src/ui/UserCard.test.tsx");

    expect(view.componentTree).toBeNull();
  });

  it("should find a rendered component imported under another name, shown by that name", () => {
    const parent = analyzeSource(USER_CARD, 'import { Avatar as Pic } from "src/ui/Avatar.tsx";\nexport function UserCard() {\n  return <Pic />;\n}');

    const tree = buildViewData(graphOf([parent, component("src/ui/Avatar.tsx")]), USER_CARD).componentTree!;

    expect(tree.renders.map((link) => [link.file, link.name, link.line])).toEqual([["src/ui/Avatar.tsx", "Pic", 3]]);
  });

  it("should have no component tree for a file without JSX", () => {
    const view = buildViewData(graphOf([analyzeSource("src/utils/format.ts", "export const format = (value: string) => value;")]), "src/utils/format.ts");

    expect(view.componentTree).toBeNull();
  });
});

describe("when the open file defines an interface that other files implement and extend", () => {
  const I_GROUP = "src/groups/IGroup.ts";
  const importingFrom = (target: string, path: string, text: string) => {
    const analysis = analyzeSource(path, text);
    return { ...analysis, imports: analysis.imports.map((record) => ({ ...record, specifier: target })) };
  };
  const interfaceNamed = (name: string) => {
    const graph = graphOf([
      analyzeSource(I_GROUP, "export interface IGroup {}\nexport interface IOther {}\ninterface ILocal {}\n"),
      importingFrom(I_GROUP, "src/groups/GroupService.ts", 'import type { IGroup } from "./IGroup";\n\nexport class GroupService implements IGroup {}\n'),
      importingFrom(I_GROUP, "src/groups/GroupRepository.ts", 'import { IGroup } from "./IGroup";\nexport class GroupRepository implements IGroup {}\n'),
      importingFrom(I_GROUP, "src/groups/IDepartment.ts", 'import type { IGroup } from "./IGroup";\nexport interface IDepartment extends IGroup {}\n'),
      importingFrom(I_GROUP, "src/groups/Other.ts", 'import type { IOther } from "./IGroup";\nexport class Other implements IGroup {}\n'),
      importingFrom("src/other/IGroup.ts", "src/other/Lookalike.ts", 'import type { IGroup } from "../other/IGroup";\nexport class Lookalike implements IGroup {}\n'),
    ]);
    return buildViewData(graph, I_GROUP).members.find((member) => member.name === name)!;
  };

  it("should list the implementing classes and extending interfaces with their file and line, sorted by name", () => {
    const group = interfaceNamed("IGroup");

    expect(group.implementedBy).toEqual([
      { name: "GroupRepository", kind: "class", file: "src/groups/GroupRepository.ts", line: 2 },
      { name: "GroupService", kind: "class", file: "src/groups/GroupService.ts", line: 3 },
      { name: "IDepartment", kind: "interface", file: "src/groups/IDepartment.ts", line: 2 },
    ]);
  });

  it("should list nothing for an interface that no file implements", () => {
    const other = interfaceNamed("IOther");

    expect(other.implementedBy).toEqual([]);
  });

  it("should leave the list off an interface that is not exported", () => {
    const local = interfaceNamed("ILocal");

    expect(local.implementedBy).toBeUndefined();
  });
});

describe("when a class implements two interfaces of the open file or extends a class of it", () => {
  const FILE = "src/groups/Contracts.ts";
  const contractsMember = (name: string) => {
    const importer = analyzeSource(
      "src/groups/Service.ts",
      'import { IGroup, IAudited, Base } from "./Contracts";\nexport class Service extends Base implements IGroup, IAudited {}\n',
    );
    const graph = graphOf([
      analyzeSource(FILE, "export interface IGroup {}\nexport interface IAudited {}\nexport class Base {}\n"),
      { ...importer, imports: importer.imports.map((record) => ({ ...record, specifier: FILE })) },
    ]);
    return buildViewData(graph, FILE).members.find((member) => member.name === name)!;
  };

  it("should list the class under each interface it implements", () => {
    const names = ["IGroup", "IAudited"].map((name) => contractsMember(name).implementedBy?.map((implementation) => implementation.name));

    expect(names).toEqual([["Service"], ["Service"]]);
  });

  it("should not give a class of the open file an implementation list", () => {
    const base = contractsMember("Base");

    expect(base.implementedBy).toBeUndefined();
  });
});
