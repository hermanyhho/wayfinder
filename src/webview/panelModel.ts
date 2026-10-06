import type { Fact, NodeKind, ViewData, ViewNode } from "../shared/viewData";
import { colorOf } from "./layout";

export type Action = "context" | "why" | "where" | "checks";

export interface PanelModel {
  id: string;
  name: string;
  path: string;
  rel: string;
  color: string;
  facts: Fact[];
  connectionsTitle: string;
  connections: Fact[];
  canOpen: boolean;
}

const REL: Record<NodeKind, string> = {
  here: "Open file",
  caller: "Imports the open file",
  dependency: "Imported by the open file",
  types: "Types imported by the open file",
  test: "Tests the open file",
  subject: "Tested by the open file",
  expected: "Expected, not found",
  cycle: "Circular import",
  package: "External package",
};

const findNode = (view: ViewData, id: string): ViewNode => view.nodes.find((node) => node.id === id) ?? view.nodes.find((node) => node.id === view.openFile)!;

const namesOf = (view: ViewData, kinds: NodeKind[]) =>
  view.nodes.filter((node) => !node.secondLayer && kinds.includes(node.kind)).map((node) => node.name).join(", ");

function connectionsOf(view: ViewData, node: ViewNode): Fact[] {
  if (node.kind === "here") {
    return [
      { label: "uses", value: namesOf(view, ["dependency", "types", "subject", "cycle"]) },
      { label: "packages", value: namesOf(view, ["package"]) },
      { label: "used by", value: namesOf(view, ["caller", "cycle"]) },
      { label: "tested by", value: namesOf(view, ["test"]) },
      { label: "missing", value: namesOf(view, ["expected"]) },
    ].filter((fact) => fact.value);
  }
  if (node.secondLayer) return [{ label: "via", value: node.via.map((id) => findNode(view, id).name).join(", ") }];
  if (node.kind === "expected") return node.checks;
  if (node.kind === "caller" || node.kind === "test") return node.callSites.map((site) => ({ label: `${node.name}:${site.line}`, value: site.text }));
  return node.usageInOpenFile.map((site) => ({ label: `:${site.line}`, value: site.text }));
}

function titleFor(node: ViewNode, openName: string): string {
  if (node.kind === "here") return "Connections";
  if (node.secondLayer) return "How it connects";
  if (node.kind === "expected") return "Why it is expected";
  if (node.kind === "caller") return `Where it calls ${openName}`;
  return `Where ${openName} uses it`;
}

function pathOf(node: ViewNode): string {
  if (node.kind === "package") return "npm package";
  return node.dir ? `${node.dir}/${node.name}` : node.name;
}

export function panelFor(view: ViewData, id: string): PanelModel {
  const node = findNode(view, id);
  const openName = findNode(view, view.openFile).name;
  return {
    id: node.id,
    name: node.name,
    path: pathOf(node),
    rel: node.secondLayer ? "Second layer" : REL[node.kind],
    color: colorOf(node),
    facts: node.kind === "here" ? node.facts : [...node.facts, ...node.checks],
    connectionsTitle: titleFor(node, openName),
    connections: connectionsOf(view, node),
    canOpen: node.id !== view.openFile && node.kind !== "package" && node.kind !== "expected",
  };
}

// the labels come from the checks in src/graph/neighbourhood.ts, so renaming one there moves it out of Issues
const ISSUE_LABELS = ["Missing", "Circular import", "Cycle"];

export function groupChecks(checks: Fact[]): { issues: Fact[]; others: Fact[] } {
  const isIssue = (fact: Fact) => ISSUE_LABELS.includes(fact.label);
  return { issues: checks.filter(isIssue), others: checks.filter((fact) => !isIssue(fact)) };
}

export function answerFor(view: ViewData, id: string, action: Action, git: Fact[] = []): Fact[] {
  const node = findNode(view, id);
  switch (action) {
    case "context":
      return panelFor(view, id).facts;
    case "where": {
      const model = panelFor(view, id);
      return [{ label: "Defined in", value: model.path }, ...model.connections];
    }
    case "why": {
      const importedBy = node.kind === "here"
        ? { label: "Imported by", value: namesOf(view, ["caller", "cycle"]) || "no files" }
        : node.facts.find((fact) => fact.label === "Imported by");
      const history = git.length ? git : [{ label: "Git history", value: "No commits found for this file." }];
      return [...(importedBy ? [importedBy] : []), ...history];
    }
    case "checks":
      return node.checks.length ? node.checks : [{ label: "Result", value: "No differences found against the files in the same folder." }];
  }
}
