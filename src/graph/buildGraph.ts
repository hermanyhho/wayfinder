import type { SourceAnalysis } from "./analyzeSource";
import type { Resolution } from "./resolveImport";

/** resolves a specifier written in fromPath; both paths are workspace-relative */
export type RelResolver = (specifier: string, fromPath: string) => Resolution;

export interface Dependency {
  from: string;
  to: string;
  names: string[];
  typeOnly: boolean;
  line: number;
}

export interface PackageUse {
  name: string;
  line: number;
}

export interface Graph {
  files: Map<string, SourceAnalysis>;
  dependencies: Map<string, Dependency[]>;
  dependents: Map<string, Dependency[]>;
  packages: Map<string, PackageUse[]>;
}

export function createGraph(): Graph {
  return { files: new Map(), dependencies: new Map(), dependents: new Map(), packages: new Map() };
}

export function setFile(graph: Graph, analysis: SourceAnalysis, resolve: RelResolver): void {
  removeFile(graph, analysis.path);
  graph.files.set(analysis.path, analysis);
  const byTarget = new Map<string, Dependency>();
  const packages = new Map<string, PackageUse>();
  for (const record of analysis.imports) {
    const resolution = resolve(record.specifier, analysis.path);
    if (resolution.kind === "package") {
      if (!packages.has(resolution.name)) packages.set(resolution.name, { name: resolution.name, line: record.line });
      continue;
    }
    if (resolution.kind !== "file" || resolution.path === analysis.path) continue;
    const existing = byTarget.get(resolution.path);
    if (existing) {
      existing.names = [...new Set([...existing.names, ...record.names])];
      existing.typeOnly = existing.typeOnly && record.typeOnly;
      continue;
    }
    byTarget.set(resolution.path, { from: analysis.path, to: resolution.path, names: [...new Set(record.names)], typeOnly: record.typeOnly, line: record.line });
  }
  const dependencies = [...byTarget.values()];
  graph.dependencies.set(analysis.path, dependencies);
  graph.packages.set(analysis.path, [...packages.values()]);
  for (const dependency of dependencies) {
    graph.dependents.set(dependency.to, [...(graph.dependents.get(dependency.to) ?? []), dependency]);
  }
}

export function removeFile(graph: Graph, path: string): void {
  for (const dependency of graph.dependencies.get(path) ?? []) {
    graph.dependents.set(dependency.to, (graph.dependents.get(dependency.to) ?? []).filter((incoming) => incoming.from !== path));
  }
  graph.dependencies.delete(path);
  graph.packages.delete(path);
  graph.files.delete(path);
}

export function dependenciesOf(graph: Graph, path: string): Dependency[] {
  return graph.dependencies.get(path) ?? [];
}

export function dependentsOf(graph: Graph, path: string): Dependency[] {
  return graph.dependents.get(path) ?? [];
}
