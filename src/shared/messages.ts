import type { CallChain, CallDirection, Fact, ViewData } from "./viewData";

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

export type ColumnFocusChange = "toggle" | "next" | "previous";

export type HostMessage =
  | { type: "view"; data: ViewData }
  | { type: "git"; id: string; facts: Fact[] }
  | { type: "aiStatus"; status: AiStatus }
  | { type: "ai"; openFile: string; scan: AiScanState }
  | { type: "cursor"; line: number }
  | { type: "focusOpenFile" }
  | { type: "columnFocus"; change: ColumnFocusChange }
  | { type: "callChain"; chain: CallChain; callersOnTop: boolean };

export type WebviewMessage =
  | { type: "ready" }
  | { type: "select"; id: string }
  | { type: "open"; id: string; line?: number }
  | { type: "reveal"; line: number }
  | { type: "scan" }
  | { type: "openSettings" }
  | { type: "showCallChain"; file: string; line: number }
  | { type: "extendCallChain"; direction: CallDirection }
  | { type: "flipCallChain" };
