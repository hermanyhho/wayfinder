import type { AiStatus } from "../shared/messages";
import { SCAN_SYSTEM_PROMPT } from "./scanFile";

export type CliLogin = "missing" | "loggedOut" | "loggedIn";

export type CloudCli = {
  model: string;
  command: string;
  label: string;
  company: string;
  loginCheckArgs: string[];
  loginCommand: string;
  scanArgs: string[];
  scanInput: (prompt: string) => string;
  readReply: (stdout: string) => string;
};

export function readClaudeReply(stdout: string): string {
  const parsed = parseJson(stdout);
  if (parsed === undefined) throw new Error(`Claude Code sent output that is not JSON: ${stdout.trim().split(/\r?\n/)[0].trim().slice(0, 120)}`);
  if (!isRecord(parsed) || typeof parsed.result !== "string") throw new Error("Claude Code sent no reply");
  if (parsed.is_error) throw new Error(parsed.result);
  return withoutCodeFence(parsed.result);
}

export function readCodexReply(stdout: string): string {
  let lastMessage: string | undefined;
  let failure: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    const event = parseJson(line);
    if (!isRecord(event)) continue;
    if (event.type === "item.completed" && isRecord(event.item) && event.item.type === "agent_message" && typeof event.item.text === "string") lastMessage = event.item.text;
    if (event.type === "turn.failed" && isRecord(event.error) && typeof event.error.message === "string") failure = event.error.message;
    if (event.type === "error" && typeof event.message === "string") failure = event.message;
  }
  if (lastMessage === undefined) throw new Error(failure ?? "Codex sent no reply");
  return withoutCodeFence(lastMessage);
}

export const CLOUD_CLIS: CloudCli[] = [
  {
    model: "claude-code",
    command: "claude",
    label: "Claude Code",
    company: "Anthropic",
    loginCheckArgs: ["auth", "status"],
    loginCommand: "claude auth login",
    scanArgs: ["-p", "--output-format", "json", "--system-prompt", SCAN_SYSTEM_PROMPT, "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence"],
    scanInput: (prompt) => prompt,
    readReply: readClaudeReply,
  },
  {
    model: "codex",
    command: "codex",
    label: "Codex",
    company: "OpenAI",
    loginCheckArgs: ["login", "status"],
    loginCommand: "codex login",
    scanArgs: ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "--disable", "shell_tool", "--color", "never", "-"],
    scanInput: (prompt) => `${SCAN_SYSTEM_PROMPT}\n\n${prompt}`,
    readReply: readCodexReply,
  },
];

export const cloudCliFor = (model: string) => CLOUD_CLIS.find((cli) => cli.model === model);

export const cloudLabel = (cli: CloudCli) => `${cli.label} (cloud)`;

export function cloudCliStatus(cli: CloudCli, login: CliLogin): AiStatus {
  if (login === "missing") return { ready: false, reason: `${cli.command} is not installed or not on the PATH` };
  if (login === "loggedOut") return { ready: false, reason: `run ${cli.loginCommand}` };
  return { ready: true, model: cloudLabel(cli), sendsCodeTo: cli.company };
}

export const cloudConsentQuestion = (fileName: string, cli: CloudCli) => `Scan with AI sends ${fileName} to ${cli.company} through ${cli.label}. With the wayfinder.ai.scope setting on neighbours, it also sends the code of its imports, tests and callers. Continue?`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const withoutCodeFence = (reply: string) => reply.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1");
