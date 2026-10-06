import type { Fact, ViewData } from "./viewData";

export interface AiFinding {
  file: string;
  line: number;
  text: string;
}

export interface AiScan {
  summary: string;
  findings: AiFinding[];
}

export type AiStatus = { ready: true; model: string; sendsCodeTo?: string } | { ready: false; reason: string };

export type AiScanState = { state: "idle" } | { state: "loading" } | { state: "done"; result: AiScan; rulesCut: boolean } | { state: "error"; message: string };

export type HostMessage =
  | { type: "view"; data: ViewData }
  | { type: "git"; id: string; facts: Fact[] }
  | { type: "aiStatus"; status: AiStatus }
  | { type: "ai"; openFile: string; scan: AiScanState }
  | { type: "cursor"; line: number };

export type WebviewMessage = { type: "ready" } | { type: "select"; id: string } | { type: "open"; id: string } | { type: "reveal"; line: number } | { type: "scan" } | { type: "openAiSettings" };
