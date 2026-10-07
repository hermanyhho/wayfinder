import { dependenciesOf, dependentsOf, type Graph } from "./buildGraph";

const TEST_PATTERN = /(\.|_)(spec|test)\.[cm]?[jt]sx?$|(^|\/)__tests__\//;
const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/;
const MIN_SIBLINGS = 3;
const MIN_SHARE = 0.75;
const OUTLIER_MIN_LINES = 300;
const OUTLIER_MEDIAN_MULTIPLE = 3;

export interface ExpectedFile {
  path: string;
  kind: "test" | "partner";
  reason: string;
}

const PARTNERS = [
  { label: "interface file", make: (base: string) => `I${base}` },
  { label: ".types file", make: (base: string) => `${base}.types` },
];

export const isTestFile = (path: string): boolean => TEST_PATTERN.test(path);
export const folderOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const fileNameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export function baseNameOf(path: string): string {
  return fileNameOf(path).replace(/\.d\.ts$/, "").replace(SOURCE_EXTENSION, "").replace(/(\.|_)(spec|test)$/, "");
}

function isPartnerFile(path: string): boolean {
  const base = baseNameOf(path);
  return /^I[A-Z]/.test(base) || base.endsWith(".types");
}

function isComparableSibling(path: string): boolean {
  return !isTestFile(path) && !path.endsWith(".d.ts") && !fileNameOf(path).startsWith("index.") && !isPartnerFile(path);
}

export function testsOf(graph: Graph, path: string): string[] {
  return dependentsOf(graph, path).map((dependency) => dependency.from).filter(isTestFile);
}

function bestSubjectByName(testPath: string, candidates: string[]): string | null {
  const testBase = baseNameOf(testPath);
  return (
    candidates.find((candidate) => baseNameOf(candidate) === testBase) ??
    candidates.find((candidate) => testBase.startsWith(`${baseNameOf(candidate)}.`)) ??
    null
  );
}

export function subjectOf(graph: Graph, testPath: string): string | null {
  return bestSubjectByName(testPath, dependenciesOf(graph, testPath).map((dependency) => dependency.to));
}

export function subjectByFileNameOf(graph: Graph, testPath: string): string | null {
  const testFolder = folderOf(testPath);
  const folders = fileNameOf(testFolder) === "__tests__" ? [testFolder, folderOf(testFolder)] : [testFolder];
  const sourcesNearby = [...graph.files.keys()].filter((file) => folders.includes(folderOf(file)) && !isTestFile(file) && !file.endsWith(".d.ts"));
  return bestSubjectByName(testPath, sourcesNearby);
}

function siblingsOf(graph: Graph, path: string): string[] {
  const folder = folderOf(path);
  return [...graph.files.keys()].filter((other) => other !== path && folderOf(other) === folder && isComparableSibling(other));
}

export function expectedFiles(graph: Graph, path: string): ExpectedFile[] {
  if (isTestFile(path) || isPartnerFile(path)) return [];
  const siblings = siblingsOf(graph, path);
  if (siblings.length < MIN_SIBLINGS) return [];
  const folder = folderOf(path);
  const base = baseNameOf(path);
  const extension = fileNameOf(path).match(SOURCE_EXTENSION)?.[0] ?? ".ts";
  const result: ExpectedFile[] = [];

  if (testsOf(graph, path).length === 0) {
    const tested = siblings.filter((sibling) => testsOf(graph, sibling).length > 0);
    const exampleTest = tested.length / siblings.length >= MIN_SHARE ? testsOf(graph, tested[0]).find((test) => subjectOf(graph, test) === tested[0]) : undefined;
    if (exampleTest) {
      result.push({
        path: [folderOf(exampleTest), fileNameOf(exampleTest).replace(baseNameOf(tested[0]), base)].filter(Boolean).join("/"),
        kind: "test",
        reason: `${tested.length} of ${siblings.length} files in ${folder} have a test that imports them.`,
      });
    }
  }

  const basesInFolder = new Set([...graph.files.keys()].filter((file) => folderOf(file) === folder).map(baseNameOf));
  for (const partner of PARTNERS) {
    if (basesInFolder.has(partner.make(base))) continue;
    const having = siblings.filter((sibling) => basesInFolder.has(partner.make(baseNameOf(sibling))));
    if (having.length / siblings.length < MIN_SHARE) continue;
    result.push({
      path: `${folder ? `${folder}/` : ""}${partner.make(base)}${extension}`,
      kind: "partner",
      reason: `${having.length} of ${siblings.length} files in ${folder} have a matching ${partner.label}.`,
    });
  }
  return result;
}

export function circularWith(graph: Graph, path: string): string[] {
  return dependenciesOf(graph, path)
    .filter((dependency) => dependenciesOf(graph, dependency.to).some((back) => back.to === path))
    .map((dependency) => dependency.to);
}

export function sizeOutlier(graph: Graph, path: string): { lines: number; median: number } | null {
  const lines = graph.files.get(path)?.lineCount ?? 0;
  const siblingSizes = siblingsOf(graph, path).map((sibling) => graph.files.get(sibling)!.lineCount).sort((a, b) => a - b);
  if (!siblingSizes.length) return null;
  const median = siblingSizes[Math.floor(siblingSizes.length / 2)];
  const isOutlier = lines >= OUTLIER_MIN_LINES && lines >= OUTLIER_MEDIAN_MULTIPLE * median;
  return isOutlier ? { lines, median } : null;
}
