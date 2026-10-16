import type { AiFinding, AiScan, AiStatus, MemberExplanation, MemberFinding } from "../shared/messages";
import type { Member, NodeKind, ViewData } from "../shared/viewData";

// num_ctx 8192 tokens is roughly 24,000 characters; source and rules together take 20,000, which leaves room for the reply
export const MAX_SOURCE_CHARS = 18_000;
export const MAX_RULES_CHARS = 2_000;
export const RULES_FILE = ".wayfinder/rules.md";

export const SCAN_SYSTEM_PROMPT = `You review one TypeScript or JavaScript file for a developer who is new to the codebase.
Reply with JSON only, in this form:
{"summary": "<two or three plain sentences: what the file does and who uses it>", "findings": [{"file": "<a path from the open file or the related files>", "line": <line number>, "text": "<one sentence: something worth checking>"}]}
Only name files from the open file or the related files. Return an empty findings list when nothing is worth checking.`;

export const EXPLAIN_SYSTEM_PROMPT = `You explain one part of a TypeScript or JavaScript file to a developer who is new to the codebase.
Reply with JSON only, in this form:
{"summary": "<two or three plain sentences: what it does, or for a test what it checks>", "findings": [{"line": <line number>, "text": "<one sentence: something worth checking>"}]}
Only name line numbers from the lines you were given. Return an empty findings list when nothing is worth checking.`;

export const BUILT_IN_RULES = `- Flag missing error handling around file, network and database calls.
- Flag code that does something different from what its name says.`;

export const STARTER_RULES_FILE = `# Wayfinder AI rules

Wayfinder adds these rules to its built-in rules when it scans a file or the branch impact with AI.
Write one rule per line. Keep them short: rules are cut at ${MAX_RULES_CHARS} characters.

- Flag every function longer than 40 lines.
`;

export type NeighbourSource = { file: string; source: string };
export type AiRules = { repoRules?: string; userRules?: string };
export type ScanPromptExtras = AiRules & { neighbourSources?: NeighbourSource[] };

const NEIGHBOUR_KIND_ORDER: NodeKind[] = ["dependency", "types", "subject", "cycle", "test", "caller"];

export function neighbourFiles(view: ViewData): string[] {
  return view.nodes
    .filter((node) => !node.secondLayer && NEIGHBOUR_KIND_ORDER.includes(node.kind))
    .sort((first, second) => NEIGHBOUR_KIND_ORDER.indexOf(first.kind) - NEIGHBOUR_KIND_ORDER.indexOf(second.kind))
    .map((node) => node.id);
}

export function buildScanPrompt(source: string, view: ViewData, extras: ScanPromptExtras = {}): { prompt: string; rulesCut: boolean } {
  const relatedFiles = view.nodes
    .filter((node) => node.id !== view.openFile && node.kind !== "package" && node.kind !== "expected")
    .map((node) => `- ${node.id} (${node.kind})`);
  const openFileLines = numberedLinesWithin(source, MAX_SOURCE_CHARS);
  let remainingChars = MAX_SOURCE_CHARS - openFileLines.text.length;
  const neighbourBlocks: string[] = [];
  for (const neighbour of extras.neighbourSources ?? []) {
    const header = `Source of ${neighbour.file}, with line numbers:`;
    const neighbourLines = numberedLinesWithin(neighbour.source, remainingChars - header.length);
    if (!neighbourLines.shownCount) break;
    neighbourBlocks.push(header, cutNote(neighbour.file, neighbourLines), neighbourLines.text);
    remainingChars -= header.length + neighbourLines.text.length;
  }
  const rules = rulesWithin(extras);
  return {
    prompt: [
      `Open file: ${view.openFile}`,
      "Related files:",
      ...(relatedFiles.length ? relatedFiles : ["- none"]),
      "Rules for what to check:",
      BUILT_IN_RULES,
      rules.text,
      cutNote(view.openFile, openFileLines),
      "Source, with line numbers:",
      openFileLines.text,
      ...neighbourBlocks,
    ]
      .filter(Boolean)
      .join("\n"),
    rulesCut: rules.cut,
  };
}

export function rulesWithin({ repoRules = "", userRules = "" }: AiRules): { text: string; cut: boolean } {
  const text = [
    repoRules.trim() && `Team rules from ${RULES_FILE}:\n${repoRules.trim()}`,
    userRules.trim() && `Rules from the developer's settings:\n${userRules.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
  return text.length > MAX_RULES_CHARS ? { text: text.slice(0, MAX_RULES_CHARS), cut: true } : { text, cut: false };
}

export function numberedLinesWithin(source: string, maxChars: number, firstLineNumber = 1): { text: string; shownCount: number; totalCount: number } {
  const numberedLines = source.split(/\r?\n/).map((line, index) => `${firstLineNumber + index}| ${line}`);
  let shownCount = 0;
  let shownChars = 0;
  while (shownCount < numberedLines.length && shownChars + numberedLines[shownCount].length < maxChars) {
    shownChars += numberedLines[shownCount].length + 1;
    shownCount++;
  }
  return { text: numberedLines.slice(0, shownCount).join("\n"), shownCount, totalCount: numberedLines.length };
}

const cutNote = (file: string, lines: { shownCount: number; totalCount: number }) =>
  lines.shownCount < lines.totalCount ? `${file} was cut after line ${lines.shownCount} of ${lines.totalCount}.` : "";

export function parseScanReply(reply: string, lineCountByFile: ReadonlyMap<string, number>): AiScan | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed.summary !== "string" || !parsed.summary.trim()) return undefined;
  const findings: AiFinding[] = [];
  for (const candidate of Array.isArray(parsed.findings) ? parsed.findings : []) {
    if (isCitedFinding(candidate, lineCountByFile)) findings.push({ file: candidate.file, line: candidate.line, text: candidate.text.trim() });
  }
  return { summary: parsed.summary.trim(), findings };
}

const EXPLAINED_KIND_LABELS: Partial<Record<Member["kind"], string>> = { suite: "test group", test: "test case" };

export function buildExplainPrompt(source: string, file: string, member: Member): { prompt: string; firstLine: number; lastLine: number } {
  const memberSource = source.split(/\r?\n/).slice(member.line - 1, member.endLine).join("\n");
  const memberLines = numberedLinesWithin(memberSource, MAX_SOURCE_CHARS, member.line);
  const lastLine = member.line + memberLines.shownCount - 1;
  const isTest = member.kind === "suite" || member.kind === "test";
  return {
    prompt: [
      `File: ${file}`,
      `Explain the ${EXPLAINED_KIND_LABELS[member.kind] ?? member.kind} ${[member.className, member.name].filter(Boolean).join(".")}.`,
      isTest ? "The summary says what it checks." : "The summary says what it does.",
      memberLines.shownCount < memberLines.totalCount ? `Its source was cut after line ${lastLine} of ${member.endLine}.` : "",
      "Source, with line numbers:",
      memberLines.text,
    ]
      .filter(Boolean)
      .join("\n"),
    firstLine: member.line,
    lastLine,
  };
}

export function parseExplainReply(reply: string, sentLines: { firstLine: number; lastLine: number }): MemberExplanation | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed.summary !== "string" || !parsed.summary.trim()) return undefined;
  const findings: MemberFinding[] = [];
  for (const candidate of Array.isArray(parsed.findings) ? parsed.findings : []) {
    if (isRecord(candidate) && isLineWithin(candidate.line, sentLines) && typeof candidate.text === "string" && candidate.text.trim()) findings.push({ line: candidate.line, text: candidate.text.trim() });
  }
  return { summary: parsed.summary.trim(), findings };
}

const isLineWithin = (line: unknown, sentLines: { firstLine: number; lastLine: number }): line is number =>
  Number.isInteger(line) && (line as number) >= sentLines.firstLine && (line as number) <= sentLines.lastLine;

export function aiStatusFor(model: string, baseUrl: string, installedModels: string[] | null): AiStatus {
  if (!model) return { ready: false, reason: "no model is set" };
  if (!installedModels) return { ready: false, reason: `Ollama is not running at ${baseUrl}` };
  const installed = installedModels.some((name) => name === model || name === `${model}:latest`);
  return installed ? { ready: true, model } : { ready: false, reason: `run ollama pull ${model}` };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function isCitedFinding(candidate: unknown, lineCountByFile: ReadonlyMap<string, number>): candidate is AiFinding {
  if (!isRecord(candidate) || typeof candidate.file !== "string" || typeof candidate.text !== "string" || !candidate.text.trim()) return false;
  const lineCount = lineCountByFile.get(candidate.file);
  return lineCount !== undefined && Number.isInteger(candidate.line) && (candidate.line as number) >= 1 && (candidate.line as number) <= lineCount;
}
