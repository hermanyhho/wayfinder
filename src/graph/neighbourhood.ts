import type { CallSite, Fact, Member, MemberUse, NodeKind, ViewData, ViewEdge, ViewNode } from "../shared/viewData";
import type { SourceAnalysis } from "./analyzeSource";
import { dependenciesOf, dependentsOf, type Dependency, type Graph } from "./buildGraph";
import { baseNameOf, circularWith, expectedFiles, fileNameOf, folderOf, isTestFile, sizeOutlier, subjectByFileNameOf, subjectOf, testsOf } from "./patterns";

export interface ViewOptions {
  packageJsonText?: string;
  scan?: { done: number; total: number } | null;
}

export function buildViewData(graph: Graph, path: string, options: ViewOptions = {}): ViewData {
  const nodes = new Map<string, ViewNode>();
  const edges: ViewEdge[] = [];
  const edgeKeys = new Set<string>();
  const center = graph.files.get(path);
  const add = (node: ViewNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
    return nodes.get(node.id)!;
  };
  const connect = (edge: ViewEdge) => {
    const key = `${edge.from}>${edge.to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  };

  const here = add(fileNode(graph, path, "here", false));
  const cycles = new Set(circularWith(graph, path));
  const tests = new Set(isTestFile(path) ? [] : testsOf(graph, path));
  const subject = isTestFile(path) ? subjectOf(graph, path) : null;

  for (const dependency of dependentsOf(graph, path)) {
    if (cycles.has(dependency.from)) continue;
    const node = add(fileNode(graph, dependency.from, tests.has(dependency.from) ? "test" : "caller", false));
    node.callSites = importAndUsageSites(graph.files.get(dependency.from), dependency);
    connect({ from: node.id, to: path, style: "solid" });
  }

  for (const dependency of dependenciesOf(graph, path)) {
    const kind = dependencyKind(dependency, cycles, subject);
    const node = add(fileNode(graph, dependency.to, kind, false));
    node.usageInOpenFile = importAndUsageSites(center, dependency);
    if (kind !== "cycle") {
      connect({ from: path, to: node.id, style: "solid" });
      continue;
    }
    const back = dependenciesOf(graph, dependency.to).find((candidate) => candidate.to === path)!;
    node.callSites = importAndUsageSites(graph.files.get(dependency.to), back);
    connect({ from: path, to: node.id, style: "solid", label: "circular import" });
    connect({ from: node.id, to: path, style: "solid" });
    const cycleText = `${fileNameOf(path)} imports it on line ${dependency.line}. It imports ${fileNameOf(path)} on line ${back.line}.`;
    node.checks.push({ label: "Cycle", value: cycleText });
    here.checks.push({ label: "Circular import", value: `${fileNameOf(dependency.to)}: ${cycleText}` });
  }

  const subjectByFileName = isTestFile(path) && !subject ? subjectByFileNameOf(graph, path) : null;
  if (subjectByFileName) {
    add({ ...fileNode(graph, subjectByFileName, "subject", false), matchedByFileName: true });
  }

  for (const use of graph.packages.get(path) ?? []) {
    const node = add({ ...emptyNode(`package:${use.name}`, "package", use.name, ""), facts: [{ label: "Package", value: use.name }] });
    node.usageInOpenFile.push({ line: use.line, text: center?.imports.find((record) => record.line === use.line)?.text ?? "" });
    connect({ from: path, to: node.id, style: "solid" });
  }

  const missingFiles = expectedFiles(graph, path);
  for (const expected of missingFiles) {
    const node = add({ ...emptyNode(`expected:${expected.path}`, "expected", fileNameOf(expected.path), folderOf(expected.path)), expectedKind: expected.kind });
    node.facts = [{ label: "Status", value: "File does not exist" }];
    node.checks = [{ label: "Rule", value: expected.reason }];
    here.checks.push({ label: "Missing", value: `${node.name}: ${expected.reason}` });
    connect(expected.kind === "test" ? { from: node.id, to: path, style: "dashed" } : { from: path, to: node.id, style: "dashed" });
  }

  const outlier = sizeOutlier(graph, path);
  if (outlier) here.checks.push({ label: "Size", value: `${outlier.lines} lines. Files in this folder have a median of ${outlier.median}.` });
  if (!isTestFile(path) && tests.size === 0 && !missingFiles.some((expected) => expected.kind === "test")) {
    here.checks.push({ label: "Tests", value: "No test imports this file." });
  }

  for (const member of center?.members ?? []) {
    if (member.focus === "only") here.checks.push({ label: "Only", value: `.only on line ${member.line} skips every other test.` });
  }

  const immediate = new Set(nodes.keys());
  const addSecond = (id: string, kind: NodeKind, via: string, direction: "up" | "down") => {
    if (id === path || immediate.has(id)) return;
    const node = add(fileNode(graph, id, kind, true));
    if (!node.via.includes(via)) node.via.push(via);
    connect(direction === "up" ? { from: id, to: via, style: "solid" } : { from: via, to: id, style: "solid" });
  };
  for (const near of [...nodes.values()]) {
    if (near.kind === "caller") for (const dependency of dependentsOf(graph, near.id)) addSecond(dependency.from, "caller", near.id, "up");
    if (["dependency", "types", "subject", "test", "cycle"].includes(near.kind)) {
      for (const dependency of dependenciesOf(graph, near.id)) addSecond(dependency.to, "dependency", near.id, "down");
    }
  }

  const lineMarks: ViewData["lineMarks"] = [];
  const marked = new Set<number>();
  for (const node of nodes.values()) {
    for (const site of node.usageInOpenFile) {
      if (marked.has(site.line)) continue;
      marked.add(site.line);
      lineMarks.push({ line: site.line, nodeId: node.id });
    }
  }

  return {
    openFile: path,
    openFileIsTest: isTestFile(path),
    nodes: [...nodes.values()],
    edges,
    lineMarks,
    members: center ? membersWithUsage(graph, center) : [],
    orphanChecks: nodes.size === 1 + countExpected(nodes) ? orphanChecks(path, options.packageJsonText ?? "") : null,
    scan: options.scan ?? null,
  };
}

function membersWithUsage(graph: Graph, analysis: SourceAnalysis): Member[] {
  const importers = dependentsOf(graph, analysis.path);
  return analysis.members.map((member) => {
    if (member.kind === "suite" || member.kind === "test") return member;
    const usedIn = member.exported ? importers.flatMap((dependency) => useInImporter(graph, dependency, member)) : [];
    return { ...member, usedIn: usedIn.sort((left, right) => left.file.localeCompare(right.file)), usedInOwnFile: analysis.referencedNames.has(member.name) };
  });
}

// methods and properties match by name only, because the map does not run the type checker
function useInImporter(graph: Graph, dependency: Dependency, member: Member): MemberUse[] {
  const importer = graph.files.get(dependency.from);
  if (!importer) return [];
  if (member.className) {
    if (!dependency.names.includes(member.className)) return [];
    const line = importer.firstPropertyAccessLine.get(member.name);
    return line === undefined ? [] : [{ file: dependency.from, line }];
  }
  if (!dependency.names.includes(member.name)) return [];
  return [{ file: dependency.from, line: importer.usage[member.name]?.[0]?.line ?? dependency.line }];
}

function emptyNode(id: string, kind: NodeKind, name: string, dir: string): ViewNode {
  return { id, kind, name, dir, secondLayer: false, via: [], usageInOpenFile: [], callSites: [], facts: [], checks: [] };
}

function fileNode(graph: Graph, path: string, kind: NodeKind, secondLayer: boolean): ViewNode {
  return { ...emptyNode(path, kind, fileNameOf(path), folderOf(path)), secondLayer, facts: factsOf(graph, path) };
}

function dependencyKind(dependency: Dependency, cycles: Set<string>, subject: string | null): NodeKind {
  if (cycles.has(dependency.to)) return "cycle";
  if (dependency.to === subject) return "subject";
  if (isTypesDependency(dependency)) return "types";
  return "dependency";
}

function isTypesDependency(dependency: Dependency): boolean {
  return dependency.typeOnly || /\.types?\.[cm]?[jt]sx?$|\.d\.ts$/.test(dependency.to);
}

function importAndUsageSites(analysis: SourceAnalysis | undefined, dependency: Dependency): CallSite[] {
  if (!analysis) return [];
  const importText = analysis.imports.find((record) => record.line === dependency.line)?.text ?? "";
  const sites = [{ line: dependency.line, text: importText }, ...dependency.names.flatMap((name) => analysis.usage[name] ?? [])];
  const byLine = new Map(sites.map((site) => [site.line, site]));
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const listOf = (items: string[], max = 4) => items.slice(0, max).join(", ") + (items.length > max ? `, +${items.length - max} more` : "");

function factsOf(graph: Graph, path: string): Fact[] {
  const analysis = graph.files.get(path);
  if (!analysis) return [{ label: "Status", value: "Not read yet" }];
  const facts: Fact[] = [];
  if (analysis.exports.length) facts.push({ label: "Exports", value: listOf(analysis.exports) });
  if (analysis.publicMethods.length) facts.push({ label: "Public methods", value: listOf(analysis.publicMethods) });
  facts.push({ label: "Size", value: `${analysis.lineCount} lines` });
  facts.push({ label: "Doc comment", value: analysis.hasDocComment ? "yes" : "none" });
  facts.push({ label: "Imports", value: plural(dependenciesOf(graph, path).length, "project file") });
  facts.push({ label: "Imported by", value: plural(dependentsOf(graph, path).length, "file") });
  return facts;
}

const countExpected = (nodes: Map<string, ViewNode>) => [...nodes.values()].filter((node) => node.kind === "expected").length;

function orphanChecks(path: string, packageJsonText: string): Fact[] {
  const name = fileNameOf(path);
  const namedInPackageJson = packageJsonText.includes(baseNameOf(path));
  return [
    { label: "imports", value: `No file imports ${name}, directly or through an index file.` },
    { label: "dynamic", value: "No dynamic import() or require() points to it." },
    { label: "config", value: namedInPackageJson ? `${baseNameOf(path)} is named in package.json, so a script may run it.` : "Not named in package.json." },
  ];
}
