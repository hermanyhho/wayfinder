import type { AiFinding, AiScan, AiStatus } from "../shared/messages";
import type { ViewData } from "../shared/viewData";

// counts the numbered source lines; num_ctx 8192 tokens is roughly 24,000 characters, which leaves room for the reply
export const MAX_SOURCE_CHARS = 20_000;

export const SCAN_SYSTEM_PROMPT = `You review one TypeScript or JavaScript file for a developer who is new to the codebase.
Reply with JSON only, in this form:
{"summary": "<two or three plain sentences: what the file does and who uses it>", "findings": [{"file": "<a path from the open file or the related files>", "line": <line number>, "text": "<one sentence: something worth checking>"}]}
Only name files from the open file or the related files. Return an empty findings list when nothing is worth checking.`;

export function buildScanPrompt(source: string, view: ViewData): string {
  const relatedFiles = view.nodes
    .filter((node) => node.id !== view.openFile && node.kind !== "package" && node.kind !== "expected")
    .map((node) => `- ${node.id} (${node.kind})`);
  const numberedLines = source.split(/\r?\n/).map((line, index) => `${index + 1}| ${line}`);
  let shownCount = 0;
  let shownChars = 0;
  while (shownCount < numberedLines.length && shownChars + numberedLines[shownCount].length < MAX_SOURCE_CHARS) {
    shownChars += numberedLines[shownCount].length + 1;
    shownCount++;
  }
  const cutNote = shownCount < numberedLines.length ? `The file was cut after line ${shownCount} of ${numberedLines.length}.` : "";
  return [
    `Open file: ${view.openFile}`,
    "Related files:",
    ...(relatedFiles.length ? relatedFiles : ["- none"]),
    cutNote,
    "Source, with line numbers:",
    numberedLines.slice(0, shownCount).join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

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
