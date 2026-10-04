export type NodeKind = "here" | "caller" | "dependency" | "types" | "test" | "subject" | "expected" | "cycle" | "package";

export interface Fact {
  label: string;
  value: string;
}

export interface CallSite {
  line: number;
  text: string;
}

export interface ViewNode {
  /** workspace-relative path, "package:<name>" or "expected:<path>" */
  id: string;
  kind: NodeKind;
  name: string;
  dir: string;
  secondLayer: boolean;
  /** ids in the immediate layer that a second-layer node connects through */
  via: string[];
  /** lines in the open file that import or use this node */
  usageInOpenFile: CallSite[];
  /** lines in this node's file that import or use the open file */
  callSites: CallSite[];
  facts: Fact[];
  checks: Fact[];
  expectedKind?: "test" | "partner";
}

export interface ViewEdge {
  from: string;
  to: string;
  style: "solid" | "dashed";
  label?: string;
}

export interface ViewData {
  openFile: string;
  nodes: ViewNode[];
  edges: ViewEdge[];
  lineMarks: { line: number; nodeId: string }[];
  orphanChecks: Fact[] | null;
  scan: { done: number; total: number } | null;
}
