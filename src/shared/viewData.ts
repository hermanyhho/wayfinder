export type NodeKind = "here" | "caller" | "dependency" | "types" | "test" | "subject" | "expected" | "cycle" | "package";

export interface Fact {
  label: string;
  value: string;
}

export interface CallSite {
  line: number;
  text: string;
}

export interface MemberUse {
  file: string;
  line: number;
}

/** a class that implements, or an interface that extends, an interface of the open file */
export interface Implementation extends MemberUse {
  name: string;
  kind: "class" | "interface";
}

export type MemberVisibility = "public" | "protected" | "private" | "exported" | "not exported";

export type MemberKind = "function" | "class" | "method" | "property" | "const" | "let" | "interface" | "type" | "enum" | "suite" | "test";

export interface Member {
  name: string;
  kind: MemberKind;
  line: number;
  /** last line of the declaration, so the editor cursor can be matched to the member it is in */
  endLine: number;
  /** for methods and properties: the class is exported and the member is not private or protected */
  exported: boolean;
  /** for methods and properties: the access modifier. For other members except tests: whether the file exports it */
  visibility?: MemberVisibility;
  /** the class a method or property belongs to */
  className?: string;
  /** for suites and tests: the title of the describe it is in */
  suiteTitle?: string;
  /** for suites and tests: marked with .only, or skipped with .skip or an x prefix */
  focus?: "only" | "skip";
  /** for members of the open file that are not tests: the first line in each other file that uses it, matched by name */
  usedIn?: MemberUse[];
  usedInOwnFile?: boolean;
  /** for classes and interfaces: the names in their implements and extends clauses, as written */
  implements?: string[];
  extends?: string[];
  /** for interfaces of the open file: classes in importing files that implement it and interfaces that extend it */
  implementedBy?: Implementation[];
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
  /** for the subject of an open test: found by file name because the test does not import it */
  matchedByFileName?: boolean;
}

export interface ViewEdge {
  from: string;
  to: string;
  style: "solid" | "dashed";
  label?: string;
}

export interface ViewData {
  openFile: string;
  openFileIsTest: boolean;
  nodes: ViewNode[];
  edges: ViewEdge[];
  lineMarks: { line: number; nodeId: string }[];
  /** what the open file defines, in source order */
  members: Member[];
  orphanChecks: Fact[] | null;
  scan: { done: number; total: number } | null;
}
