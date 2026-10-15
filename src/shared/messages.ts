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

export interface MemberFinding {
  line: number;
  text: string;
}

export interface MemberExplanation {
  summary: string;
  findings: MemberFinding[];
}

export type MemberExplainState =
  | { state: "loading" }
  | { state: "done"; result: MemberExplanation; model: string; firstLine: number; lastLine: number }
  | { state: "error"; message: string };

export const memberKeyOf = (member: { line: number; name: string }) => `${member.line}:${member.name}`;

export type AiStatus = { ready: true; model: string; sendsCodeTo?: string } | { ready: false; reason: string };

export type AiScanState = { state: "idle" } | { state: "loading" } | { state: "done"; result: AiScan; rulesCut: boolean } | { state: "error"; message: string };

export type ColumnFocusChange = "toggle" | "next" | "previous";

export type HostMessage =
  | { type: "view"; data: ViewData }
  | { type: "git"; id: string; facts: Fact[] }
  | { type: "aiStatus"; status: AiStatus }
  | { type: "ai"; openFile: string; scan: AiScanState }
  | { type: "explanations"; openFile: string; byMember: Record<string, MemberExplainState> }
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
  | { type: "explain"; line: number; name: string }
  | { type: "openSettings" }
  | { type: "showCallChain"; file: string; line: number }
  | { type: "extendCallChain"; direction: CallDirection }
  | { type: "flipCallChain" };
