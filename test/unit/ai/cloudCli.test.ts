import { describe, expect, it } from "vitest";
import { cloudCliFor, cloudCliStatus, cloudConsentQuestion, readClaudeReply, readCodexReply } from "../../../src/ai/cloudCli";
import { parseScanReply } from "../../../src/ai/scanFile";

const FILE = "src/services/DocumentService.ts";
const lineCounts = new Map([[FILE, 40]]);
const scanReply = JSON.stringify({ summary: "Stores documents.", findings: [{ file: FILE, line: 12, text: "No error handling." }] });
const claudeCode = cloudCliFor("claude-code")!;
const codex = cloudCliFor("codex")!;

describe("readClaudeReply", () => {
  it("reads the result field of claude -p --output-format json into a reply the scan parser accepts", () => {
    const stdout = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: scanReply, session_id: "86e4" });
    expect(parseScanReply(readClaudeReply(stdout), lineCounts)).toEqual({
      summary: "Stores documents.",
      findings: [{ file: FILE, line: 12, text: "No error handling." }],
    });
  });

  it("removes a json code fence around the result", () => {
    const stdout = JSON.stringify({ is_error: false, result: "```json\n" + scanReply + "\n```" });
    expect(readClaudeReply(stdout)).toBe(scanReply);
  });

  it("throws the result text when claude reports an error", () => {
    expect(() => readClaudeReply(JSON.stringify({ is_error: true, result: "Not logged in" }))).toThrow("Not logged in");
  });

  it("throws when the result is not a string", () => {
    expect(() => readClaudeReply(JSON.stringify({ is_error: false, result: 42 }))).toThrow("Claude Code sent no reply");
  });

  it("throws the first line of the output when it is not json", () => {
    expect(() => readClaudeReply("  Error: unknown option '--foo'  \nUsage: claude [options]")).toThrow("Claude Code sent output that is not JSON: Error: unknown option '--foo'");
  });

  it("throws when the output has no result", () => {
    expect(() => readClaudeReply(JSON.stringify({ type: "result" }))).toThrow("Claude Code sent no reply");
  });
});

describe("readCodexReply", () => {
  const agentMessage = (text: string) => JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } });

  it("uses the last agent message when there are several", () => {
    expect(readCodexReply([agentMessage("first"), agentMessage(scanReply)].join("\n"))).toBe(scanReply);
  });

  it("removes a json code fence around the agent message", () => {
    expect(readCodexReply(agentMessage("```json\n" + scanReply + "\n```"))).toBe(scanReply);
  });

  it("throws the message of an error event when there is no agent message", () => {
    const stdout = ["not json", JSON.stringify({ type: "error", message: "stream disconnected" })].join("\n");
    expect(() => readCodexReply(stdout)).toThrow("stream disconnected");
  });

  it("reads the last agent message from codex exec --json events and skips log lines", () => {
    const stdout = [
      "2026-10-05T16:56:27Z ERROR codex_models_manager::manager: failed to refresh available models",
      JSON.stringify({ type: "thread.started", thread_id: "01a1" }),
      JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "reasoning", text: "thinking" } }),
      JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: scanReply } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10 } }),
    ].join("\n");
    expect(parseScanReply(readCodexReply(stdout), lineCounts)?.summary).toBe("Stores documents.");
  });

  it("throws the failure message when the turn fails without a reply", () => {
    const stdout = JSON.stringify({ type: "turn.failed", error: { message: "usage limit reached" } });
    expect(() => readCodexReply(stdout)).toThrow("usage limit reached");
  });

  it("throws when there is no agent message", () => {
    expect(() => readCodexReply("")).toThrow("Codex sent no reply");
  });
});

describe("cloudCliStatus", () => {
  it("is ready with a cloud label and names the company the code goes to", () => {
    expect(cloudCliStatus(claudeCode, "loggedIn")).toEqual({ ready: true, model: "Claude Code (cloud)", sendsCodeTo: "Anthropic" });
  });

  it("says the command is missing or tells the user how to log in", () => {
    expect(cloudCliStatus(codex, "missing")).toEqual({ ready: false, reason: "codex is not installed or not on the PATH" });
    expect(cloudCliStatus(claudeCode, "loggedOut")).toEqual({ ready: false, reason: "run claude auth login" });
  });
});

describe("cloudConsentQuestion", () => {
  it("names the file, the company and the CLI", () => {
    expect(cloudConsentQuestion("DocumentService.ts", claudeCode)).toBe("Scan with AI sends DocumentService.ts to Anthropic through Claude Code. With the wayfinder.ai.scope setting on neighbours, it also sends the code of its imports, tests and callers. Continue?");
  });
});

describe("cloudCliFor", () => {
  it("returns nothing for an Ollama model name", () => {
    expect(cloudCliFor("qwen2.5-coder:1.5b")).toBeUndefined();
  });
});
