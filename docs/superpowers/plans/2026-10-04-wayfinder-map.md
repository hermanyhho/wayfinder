# Wayfinder Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A VS Code extension that shows the open file in a panel beside the editor: the files that import it, the files it imports, its tests, expected-but-missing files, and a second layer behind those, all worked out from the code without AI.

**Architecture:** The extension host scans the workspace with the TypeScript compiler API and keeps an import graph in memory. For the open file it builds a plain `ViewData` object and posts it to a webview. The webview computes the layout (floors, nodes, wires) with a pure function ported from the approved mockup and renders it as HTML. Editor gutter dots mark the lines that create each connection.

**Tech Stack:** TypeScript, VS Code extension API, TypeScript compiler API (`typescript` package, bundled), esbuild (two bundles: extension and webview), vitest for unit tests.

**TypeScript version:** pin `typescript@^5.9.3`. TypeScript 7 (the current `latest` on npm) is the native port and has no JavaScript compiler API, so `ts.createSourceFile` is undefined there. Import it as `import ts from "typescript"`.

**Tracking:** one GitHub issue per task, same number as the task (hermanyhho/wayfinder #1 to #15). Plan 2 is #16.

**Scope:** This is plan 1 of 2. Plan 2 (AI scan) adds the gold "Scan with AI" button, summaries and findings on top of this. Nothing in this plan calls an AI model.

---

## Design reference

The approved design is the Design canvas at https://claude.ai/artifact/MUHcCKRXFR9PNH6rBNHAPB. A copy of its engine is in the repo at `docs/design/wayfinder-mockup.dc.html`. When a value in this plan disagrees with the mockup, the mockup wins, except for the deviations listed below.

| Design element | Mockup source (`docs/design/wayfinder-mockup.dc.html`) | Task |
|---|---|---|
| Floors in order: Imports this file, Same folder, Imported by this file, Tests. Replaced by the #44 row: callers, the open file alone, then the Imported by this file, Members and Tests columns (#63 moved the Issues column into the Checks tab, #65 added Members) | `buildImmediateLayer`, floor titles in `SCENARIOS` | 9, #44, #63, #65 |
| Deviation, approved after user testing: the open file sits alone in its row; below it three columns side by side (Imported by this file, Members, Tests), each title with its card count. Imported by this file and Members group their cards by kind in a fixed order (imports: circular imports, dependencies, types, packages; members: classes, interfaces, types, enums, functions, constants, variables, properties, methods); Tests has no groups; when the open file is a test it is titled Tested file and holds the file the test checks. Cards sort A-Z inside a group. Each group has a heading with icon, name and count that collapses or expands it, and shows 4 cards then its own footer toggle. Second-layer wires below the frame start at the x of the column node they come through, or of its group heading when the card is hidden. The map is laid out at the panel width clamped to 800-1280px (scaled down below 800), column nodes fill their column less 14px each side, and one wire runs from the open file to the top centre of each column. A Members card stands for a name the open file defines, not a file, and clicking it moves the editor to that line | differs from `buildImmediateLayer` floors and wire loop | #44, #46, #65, #73, #92 |
| Node size 152x56, open file 220x64, 4 per row, row height 74, gap 16 | constants `NODE_W` ... `MAX_PER_ROW` | 9 |
| Footer "Show N more" / "Show fewer" toggle, no aggregate node | `layoutRow`, `floorToggle`, `.ftog` | 9, 11 |
| Wires: vertical bezier between neighbouring floors, side bezier on the same floor, right-hand lane for floors further apart. Replaced by the #44 row: only the vertical bezier from each caller to the open file remains | `buildImmediateLayer` wire loop | 9, #44 |
| Selected node: its wires brighten and animate, others fade to 30% | `wireState`, `.w.hi`, `.w.lo` | 9, 11 |
| Second layer: immediate layer shrinks to 0.56 inside a green frame, second-layer floors fade in above and below, wires end on the frame edge | `buildSecondLayer`, `.cluster`, `.frame`, `.layer2` | 9, 11 |
| Empty floors and the "Nothing connects to this file" card | `floor.empty`, `banner` | 6, 9 |
| First scan banner with progress bar | `scanning` scenario, `.banner`, `.bar` | 7, 9 |
| Colours: open file green, callers blue, dependencies and types violet, tests pink, circular import red, packages grey | `KINDS`, `.green` ... `.grey` | 9, 11 |
| Panel: four question tabs at the top (Context, Why, Where, Checks), Context selected first. Context holds the facts and connections, Why holds the AI summary, Checks the AI findings. Replaced the What it does and Connections sections | `<aside class="panel">`, `describe`, `codeAnswer` | 10, 11 |
| Light and dark themes | `.app` and `.app.light` tokens | 11 |
| Addition, not in the mockup: focus mode. One column takes the map width less 48px on each side, the other two sit behind it at 0.9 size with their outer edge at the map edge, and moving to another column rotates the three in a loop with an animation. The wires from the open file follow the columns | none | #110 |

Deviations, decided here:
- Fonts: the extension uses VS Code's own UI and editor fonts. A webview cannot load Google Fonts offline.
- Code column: the mockup draws a fake editor. The extension uses the real editor and marks lines with gutter dots and a highlight (Task 13).
- Theme: follows the VS Code colour theme (`body.vscode-light`) instead of a Dark/Light switch.
- AI: the AI button, AI blocks and gold role labels on floors belong to plan 2.
- Not in v1: the "Config that runs it" floor for test files and the "Used by similar files" pattern node from the test-file sample.

## File structure

```
src/
  extension.ts                     command wayfinder.showMap, creates the index and the panel
  shared/viewData.ts               types sent from the extension host to the webview
  shared/messages.ts               message types in both directions
  graph/analyzeSource.ts           one file's imports, exports, methods, usage lines (TS AST)
  graph/resolveImport.ts           import specifier -> file, package, builtin or unresolved
  graph/buildGraph.ts              in-memory import graph with dependents index
  graph/patterns.ts                tests, expected files, circular imports, size outliers
  graph/neighbourhood.ts           ViewData for one open file
  workspace/loadCompilerOptions.ts reads tsconfig.json or jsconfig.json
  workspace/WorkspaceIndex.ts      scans the workspace, watches changes
  workspace/gitFacts.ts            last 3 commits for a file
  view/WayfinderPanel.ts           webview panel host, follows the active editor
  view/EditorMarks.ts              gutter dots and line highlight in the editor
  webview/layout.ts                pure layout engine (port of the mockup)
  webview/panelModel.ts            pure panel content
  webview/render.ts                HTML strings for map and panel
  webview/main.ts                  webview entry: state, events, animation
  webview/styles.css               tokens and components
test/unit/                         vitest unit tests, mirrors src/
test/sample-project/               small workspace for manual checks in the Extension Development Host
```

Removed: `src/panel/`, `src/agents/`, `src/analyzer/`, `tmp-webview.js`, `public/`. Kept unchanged for plan 2: `src/providers/index.ts`.

---

### Task 1: Branch, tooling and clean-up (#1)

**Files:**
- Delete: `src/panel/MapMyCodePanel.ts`, `src/panel/webviewContent.ts`, `src/agents/index.ts`, `src/analyzer/GraphBuilder.ts`, `src/analyzer/RepoFetcher.ts`, `src/analyzer/WorkspaceScanner.ts`, `tmp-webview.js`, `public/`
- Modify: `package.json`, `tsconfig.json`, `.vscodeignore`, `.vscode/launch.json`, `LICENSE`, `src/extension.ts`
- Create: `esbuild.mjs`, `vitest.config.mts`, `test/unit/smoke.test.ts`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/hermanho/Development/wayfinder
git checkout -b feat/wayfinder-map
```

- [ ] **Step 2: Delete the MapMyCode UI, agents and scanner**

```bash
git rm -r src/panel src/agents src/analyzer tmp-webview.js public
```

- [ ] **Step 3: Replace `package.json`**

```json
{
  "name": "wayfinder",
  "displayName": "Wayfinder",
  "description": "Shows where the open file sits in the codebase: what imports it, what it imports, its tests and what is missing.",
  "version": "0.1.0",
  "publisher": "hermanho",
  "private": true,
  "license": "MIT",
  "engines": { "vscode": "^1.116.0" },
  "categories": ["Visualization"],
  "main": "./out/extension.js",
  "activationEvents": [],
  "contributes": {
    "commands": [
      { "command": "wayfinder.showMap", "title": "Wayfinder: Show map for this file", "icon": "$(type-hierarchy)" }
    ],
    "menus": {
      "editor/title": [{ "command": "wayfinder.showMap", "group": "navigation" }]
    }
  },
  "scripts": {
    "build": "node esbuild.mjs",
    "watch": "node esbuild.mjs --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "vscode:prepublish": "npm run typecheck && node esbuild.mjs --production",
    "package": "vsce package --no-dependencies"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^20.19.39",
    "@types/vscode": "^1.116.0"
  }
}
```

- [ ] **Step 4: Install dependencies**

`typescript` is a runtime dependency because the extension bundles the compiler API. It must stay on 5.x: version 7 has no JavaScript API.

```bash
npm install typescript@^5.9.3
npm install --save-dev esbuild vitest
```

Expected: `package.json` lists `typescript` `^5.9.3` under `dependencies` and `esbuild`, `vitest` under `devDependencies`. `node -e "console.log(require('typescript').version)"` prints `5.9.x`.

- [ ] **Step 5: Replace `tsconfig.json`**

esbuild produces the output, so `tsc` only type-checks.

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test/unit"]
}
```

- [ ] **Step 6: Create `esbuild.mjs`**

```js
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");
const shared = { bundle: true, sourcemap: !production, minify: production, logLevel: "info" };

const contexts = await Promise.all([
  esbuild.context({ ...shared, entryPoints: ["src/extension.ts"], outfile: "out/extension.js", platform: "node", format: "cjs", external: ["vscode"] }),
  esbuild.context({ ...shared, entryPoints: ["src/webview/main.ts"], outfile: "out/webview.js", platform: "browser", format: "iife" }),
  esbuild.context({ ...shared, entryPoints: ["src/webview/styles.css"], outfile: "out/webview.css" }),
]);

if (watch) {
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(contexts.map((context) => context.rebuild()));
  await Promise.all(contexts.map((context) => context.dispose()));
}
```

- [ ] **Step 7: Create `vitest.config.mts`**

The sample project in `test/sample-project/` contains `.spec.ts` files that must not run.

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["test/unit/**/*.test.ts"] } });
```

- [ ] **Step 8: Update `.vscodeignore`**

```
.vscode/**
.vscode-test/**
src/**
test/**
docs/**
.gitignore
**/*.map
node_modules/**
tsconfig.json
esbuild.mjs
vitest.config.mts
```

- [ ] **Step 9: Point `.vscode/launch.json` at the new build**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}", "${workspaceFolder}/test/sample-project"],
      "outFiles": ["${workspaceFolder}/out/**/*.js"],
      "preLaunchTask": "npm: build"
    }
  ]
}
```

- [ ] **Step 10: Add the second copyright line to `LICENSE`**

Replace line 3 with:

```
Copyright (c) 2026 MapMyCode Contributors
Copyright (c) 2026 Herman Ho
```

- [ ] **Step 11: Temporary `src/extension.ts`, replaced in Task 14**

```ts
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("wayfinder.showMap", () => {
      void vscode.window.showInformationMessage("Wayfinder: map not built yet.");
    }),
  );
}

export function deactivate() {}
```

Create empty placeholders so the esbuild entries exist (Task 11 fills them):

```bash
mkdir -p src/webview && printf '' > src/webview/main.ts && printf '' > src/webview/styles.css
```

- [ ] **Step 12: Smoke test**

`test/unit/smoke.test.ts`:

```ts
import { expect, it } from "vitest";

it("runs the unit test suite", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 13: Run build, type-check and tests**

```bash
npm run build && npm run typecheck && npm test
```

Expected: esbuild writes `out/extension.js`, `out/webview.js`, `out/webview.css`. tsc prints nothing. vitest reports `1 passed`.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "chore: rename to wayfinder, switch build to esbuild and add vitest"
```

---

### Task 2: Shared types (#2)

**Files:**
- Create: `src/shared/viewData.ts`, `src/shared/messages.ts`

- [ ] **Step 1: Create `src/shared/viewData.ts`**

```ts
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
```

- [ ] **Step 2: Create `src/shared/messages.ts`**

```ts
import type { Fact, ViewData } from "./viewData";

export type HostMessage = { type: "view"; data: ViewData } | { type: "git"; id: string; facts: Fact[] };

export type WebviewMessage = { type: "ready" } | { type: "select"; id: string } | { type: "open"; id: string };
```

- [ ] **Step 3: Type-check and commit**

```bash
npm run typecheck
git add src/shared
git commit -m "feat: add view data and message types"
```

---

### Task 3: Analyse one source file (#3)

**Files:**
- Create: `src/graph/analyzeSource.ts`
- Test: `test/unit/graph/analyzeSource.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { analyzeSource } from "../../../src/graph/analyzeSource";

const documentService = [
  'import { DocumentRepository } from "../db/repositories/DocumentRepository"',
  'import { StorageClient } from "../integrations/storage/StorageClient"',
  'import { PermissionPolicy } from "../auth/PermissionPolicy"',
  'import type { Document, NewDocument } from "../types/document.types"',
  "",
  "export class DocumentService {",
  "  constructor(",
  "    private readonly documents: DocumentRepository,",
  "    private readonly storage: StorageClient,",
  "    private readonly permissions: PermissionPolicy,",
  "  ) {}",
  "",
  "  async listForEmployee(actorId: string, employeeId: string): Promise<Document[]> {",
  "    await this.permissions.assertCanRead(actorId, employeeId)",
  "    return this.documents.findByEmployee(employeeId)",
  "  }",
  "",
  "  async upload(actorId: string, input: NewDocument, file: Buffer): Promise<Document> {",
  "    await this.permissions.assertCanWrite(actorId, input.employeeId)",
  "    const fileKey = await this.storage.put(file)",
  "    return this.documents.save({ ...input, fileKey })",
  "  }",
  "",
  "  async remindUnsigned(): Promise<number> {",
  "    const unsigned = await this.documents.findUnsigned()",
  "    for (const document of unsigned) {",
  "      await this.documents.markReminded(document.id)",
  "    }",
  "    return unsigned.length",
  "  }",
  "}",
].join("\n");

const lines = (sites: { line: number }[] | undefined) => (sites ?? []).map((site) => site.line);

describe("analyzeSource", () => {
  const analysis = analyzeSource("src/services/DocumentService.ts", documentService);

  it("lists static imports with their line and whether they are type-only", () => {
    expect(analysis.imports.map(({ specifier, line, typeOnly }) => ({ specifier, line, typeOnly }))).toEqual([
      { specifier: "../db/repositories/DocumentRepository", line: 1, typeOnly: false },
      { specifier: "../integrations/storage/StorageClient", line: 2, typeOnly: false },
      { specifier: "../auth/PermissionPolicy", line: 3, typeOnly: false },
      { specifier: "../types/document.types", line: 4, typeOnly: true },
    ]);
  });

  it("finds the lines that use an imported name, including through constructor fields", () => {
    expect(lines(analysis.usage.DocumentRepository)).toEqual([8, 15, 21, 25, 27]);
    expect(lines(analysis.usage.PermissionPolicy)).toEqual([10, 14, 19]);
    expect(lines(analysis.usage.StorageClient)).toEqual([9, 20]);
    expect(lines(analysis.usage.NewDocument)).toEqual([18]);
    expect(analysis.usage.DocumentRepository?.[1]).toEqual({ line: 15, text: "return this.documents.findByEmployee(employeeId)" });
  });

  it("lists exports, public methods, size and doc comment", () => {
    expect(analysis.exports).toEqual(["class DocumentService"]);
    expect(analysis.publicMethods).toEqual(["listForEmployee", "upload", "remindUnsigned"]);
    expect(analysis.lineCount).toBe(31);
    expect(analysis.hasDocComment).toBe(false);
  });

  it("records re-exports, dynamic imports and require calls", () => {
    const text = [
      'import chalk, * as all from "chalk"',
      'export { formatDate } from "./formatDate"',
      'const lazy = () => import("./lazy")',
      'const legacy = require("./legacy")',
      "/** Entry point. */",
      "export default function main() { return chalk }",
    ].join("\n");
    const result = analyzeSource("src/main.ts", text);
    expect(result.imports.map(({ specifier, dynamic }) => ({ specifier, dynamic }))).toEqual([
      { specifier: "chalk", dynamic: false },
      { specifier: "./formatDate", dynamic: false },
      { specifier: "./lazy", dynamic: true },
      { specifier: "./legacy", dynamic: true },
    ]);
    expect(result.imports[0].names).toEqual(["chalk", "all"]);
    expect(result.exports).toEqual(["function main"]);
    expect(result.hasDocComment).toBe(true);
    expect(lines(result.usage.chalk)).toEqual([6]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- test/unit/graph/analyzeSource.test.ts`
Expected: FAIL, `Failed to resolve import "../../../src/graph/analyzeSource"`.

- [ ] **Step 3: Implement `src/graph/analyzeSource.ts`**

```ts
import ts from "typescript";
import type { CallSite } from "../shared/viewData";

export interface ImportRecord {
  specifier: string;
  line: number;
  text: string;
  /** local names this import binds */
  names: string[];
  typeOnly: boolean;
  /** import() or require() */
  dynamic: boolean;
}

export interface SourceAnalysis {
  path: string;
  lineCount: number;
  imports: ImportRecord[];
  exports: string[];
  publicMethods: string[];
  hasDocComment: boolean;
  /** imported name -> lines in this file that use it */
  usage: Record<string, CallSite[]>;
}

export function analyzeSource(path: string, text: string): SourceAnalysis {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindFor(path));
  const sourceLines = text.split(/\r?\n/);
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const textOf = (line: number) => (sourceLines[line - 1] ?? "").trim().slice(0, 100);

  const imports: ImportRecord[] = [];
  const exports: string[] = [];
  const publicMethods: string[] = [];
  let hasDocComment = false;
  const addImport = (specifier: string, node: ts.Node, names: string[], typeOnly: boolean, dynamic: boolean) => {
    const line = lineOf(node);
    imports.push({ specifier, line, text: textOf(line), names, typeOnly, dynamic });
  };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      addImport(statement.moduleSpecifier.text, statement, importedNames(statement.importClause), isTypeOnlyImport(statement.importClause), false);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      addImport(statement.moduleSpecifier.text, statement, [], statement.isTypeOnly, false);
    } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference) && ts.isStringLiteral(statement.moduleReference.expression)) {
      addImport(statement.moduleReference.expression.text, statement, [statement.name.text], statement.isTypeOnly, false);
    }
    collectExports(statement, exports, publicMethods);
    if (!hasDocComment && isExported(statement)) hasDocComment = hasJsDoc(text, statement);
  }

  const importedNameSet = new Set(imports.flatMap((record) => record.names));
  const fieldTypes = fieldsTypedWithImports(source, importedNameSet);
  const usage: Record<string, CallSite[]> = {};
  const record = (name: string, node: ts.Node) => {
    const line = lineOf(node);
    const sites = (usage[name] ??= []);
    if (!sites.some((site) => site.line === line)) sites.push({ line, text: textOf(line) });
  };

  const visit = (node: ts.Node) => {
    if (isDynamicImportOrRequire(node)) addImport((node.arguments[0] as ts.StringLiteral).text, node, [], false, true);
    if (ts.isIdentifier(node) && importedNameSet.has(node.text) && !isInsideImport(node)) record(node.text, node);
    if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const typeName = fieldTypes.get(node.name.text);
      if (typeName) record(typeName, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return { path, lineCount: sourceLines.length, imports, exports, publicMethods, hasDocComment, usage };
}

function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function importedNames(clause: ts.ImportClause | undefined): string[] {
  if (!clause) return [];
  const names: string[] = [];
  if (clause.name) names.push(clause.name.text);
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
  if (bindings && ts.isNamedImports(bindings)) names.push(...bindings.elements.map((element) => element.name.text));
  return names;
}

function isTypeOnlyImport(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  return !clause.name && !!bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

function isExported(statement: ts.Statement): boolean {
  return hasModifier(statement, ts.SyntaxKind.ExportKeyword);
}

function hasJsDoc(text: string, statement: ts.Statement): boolean {
  return (ts.getLeadingCommentRanges(text, statement.getFullStart()) ?? []).some((range) => text.startsWith("/**", range.pos));
}

function collectExports(statement: ts.Statement, exports: string[], methods: string[]): void {
  if (ts.isExportAssignment(statement)) {
    exports.push("default");
    return;
  }
  if (!isExported(statement)) return;
  if (ts.isClassDeclaration(statement)) {
    exports.push(`class ${statement.name?.text ?? "default"}`);
    for (const member of statement.members) {
      const isPublic = !hasModifier(member, ts.SyntaxKind.PrivateKeyword) && !hasModifier(member, ts.SyntaxKind.ProtectedKeyword);
      if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && isPublic) methods.push(member.name.text);
    }
  } else if (ts.isFunctionDeclaration(statement)) exports.push(`function ${statement.name?.text ?? "default"}`);
  else if (ts.isInterfaceDeclaration(statement)) exports.push(`interface ${statement.name.text}`);
  else if (ts.isTypeAliasDeclaration(statement)) exports.push(`type ${statement.name.text}`);
  else if (ts.isEnumDeclaration(statement)) exports.push(`enum ${statement.name.text}`);
  else if (ts.isVariableStatement(statement)) {
    const keyword = statement.declarationList.flags & ts.NodeFlags.Const ? "const" : "let";
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) exports.push(`${keyword} ${declaration.name.text}`);
    }
  }
}

/** class fields whose type is an imported name, e.g. `private readonly documents: DocumentRepository` */
function fieldsTypedWithImports(source: ts.SourceFile, importedNames: Set<string>): Map<string, string> {
  const fields = new Map<string, string>();
  const typeNameOf = (type: ts.TypeNode | undefined) =>
    type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && importedNames.has(type.typeName.text) ? type.typeName.text : undefined;
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    for (const member of statement.members) {
      if (ts.isConstructorDeclaration(member)) {
        for (const parameter of member.parameters) {
          const typeName = typeNameOf(parameter.type);
          if (typeName && ts.isParameterPropertyDeclaration(parameter, member) && ts.isIdentifier(parameter.name)) fields.set(parameter.name.text, typeName);
        }
      }
      if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
        const typeName = typeNameOf(member.type);
        if (typeName) fields.set(member.name.text, typeName);
      }
    }
  }
  return fields;
}

function isDynamicImportOrRequire(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) return false;
  return node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require");
}

function isInsideImport(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isImportDeclaration(current) || ts.isImportEqualsDeclaration(current) || ts.isExportDeclaration(current)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- test/unit/graph/analyzeSource.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/graph/analyzeSource.ts test/unit/graph/analyzeSource.test.ts
git commit -m "feat: analyse imports, exports and usage lines of a source file"
```

---

### Task 4: Resolve import specifiers (#4)

**Files:**
- Create: `src/graph/resolveImport.ts`, `src/workspace/loadCompilerOptions.ts`
- Test: `test/unit/graph/resolveImport.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createResolver } from "../../../src/graph/resolveImport";

const files = new Map([
  ["/repo/src/a.ts", ""],
  ["/repo/src/b.ts", ""],
  ["/repo/src/lib/index.ts", ""],
]);
const host = { fileExists: (path: string) => files.has(path), readFile: (path: string) => files.get(path) };
const options: ts.CompilerOptions = { baseUrl: "/repo", paths: { "@/*": ["src/*"] }, moduleResolution: ts.ModuleResolutionKind.Node10, allowJs: true };
const resolve = createResolver("/repo", options, host);
const from = "/repo/src/a.ts";

describe("createResolver", () => {
  it("resolves relative imports and tsconfig path aliases to files", () => {
    expect(resolve("./b", from)).toEqual({ kind: "file", path: "/repo/src/b.ts" });
    expect(resolve("@/lib", from)).toEqual({ kind: "file", path: "/repo/src/lib/index.ts" });
  });

  it("reports bare specifiers as packages, using the scope when there is one", () => {
    expect(resolve("date-fns/locale", from)).toEqual({ kind: "package", name: "date-fns" });
    expect(resolve("@scope/pkg/deep", from)).toEqual({ kind: "package", name: "@scope/pkg" });
  });

  it("reports node built-ins and unresolved imports", () => {
    expect(resolve("node:fs", from)).toEqual({ kind: "builtin" });
    expect(resolve("path", from)).toEqual({ kind: "builtin" });
    expect(resolve("./missing", from)).toEqual({ kind: "unresolved" });
    expect(resolve("@/nope", from)).toEqual({ kind: "unresolved" });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- test/unit/graph/resolveImport.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/graph/resolveImport.ts`**

```ts
import { builtinModules } from "node:module";
import ts from "typescript";

export interface ResolveHost {
  fileExists(path: string): boolean;
  readFile(path: string): string | undefined;
}

export type Resolution = { kind: "file"; path: string } | { kind: "package"; name: string } | { kind: "builtin" } | { kind: "unresolved" };

const BUILTINS = new Set(builtinModules);

export function createResolver(root: string, options: ts.CompilerOptions, host: ResolveHost) {
  const cache = ts.createModuleResolutionCache(root, (fileName) => fileName, options);
  return (specifier: string, fromAbsolutePath: string): Resolution => {
    if (specifier.startsWith("node:") || BUILTINS.has(specifier)) return { kind: "builtin" };
    const resolved = ts.resolveModuleName(specifier, fromAbsolutePath, options, host, cache).resolvedModule;
    if (resolved && !resolved.isExternalLibraryImport && !resolved.resolvedFileName.includes("/node_modules/")) {
      return { kind: "file", path: resolved.resolvedFileName };
    }
    const name = packageName(specifier);
    return name ? { kind: "package", name } : { kind: "unresolved" };
  };
}

function packageName(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return undefined;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts[0].length > 1 && parts[1] ? `${parts[0]}/${parts[1]}` : undefined;
  return parts[0] || undefined;
}
```

- [ ] **Step 4: Implement `src/workspace/loadCompilerOptions.ts`**

No unit test: it only calls `ts.sys`. Task 15 checks the alias import in the sample project.

```ts
import * as path from "node:path";
import ts from "typescript";

const NO_INPUTS_FOUND = 18003;

export function loadCompilerOptions(root: string): { options: ts.CompilerOptions; problems: string[] } {
  const fallback: ts.CompilerOptions = { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Node10, baseUrl: root };
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json") ?? ts.findConfigFile(root, ts.sys.fileExists, "jsconfig.json");
  if (!configPath) return { options: fallback, problems: [] };
  const configName = path.basename(configPath);
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    return { options: fallback, problems: [`${configName}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`] };
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
  const problems = parsed.errors
    .filter((error) => error.code !== NO_INPUTS_FOUND)
    .map((error) => `${configName}: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`);
  return { options: { ...parsed.options, allowJs: true }, problems };
}
```

- [ ] **Step 5: Run the test and type-check**

```bash
npm test -- test/unit/graph/resolveImport.test.ts && npm run typecheck
```

Expected: PASS, 3 tests. No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/graph/resolveImport.ts src/workspace/loadCompilerOptions.ts test/unit/graph/resolveImport.test.ts
git commit -m "feat: resolve imports with tsconfig paths, packages and built-ins"
```

---

### Task 5: Import graph (#5)

**Files:**
- Create: `src/graph/buildGraph.ts`, `test/unit/helpers/fixtures.ts`
- Test: `test/unit/graph/buildGraph.test.ts`

- [ ] **Step 1: Write the test fixtures helper `test/unit/helpers/fixtures.ts`**

Specifiers in fixtures are already workspace paths. `pkg:` marks a package and `type:` marks a type-only import.

```ts
import type { SourceAnalysis } from "../../../src/graph/analyzeSource";
import { createGraph, setFile, type Graph, type RelResolver } from "../../../src/graph/buildGraph";

const nameFrom = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\..*$/, "");

export function analysisOf(path: string, imports: string[] = [], extra: Partial<SourceAnalysis> = {}): SourceAnalysis {
  return {
    path,
    lineCount: 20,
    imports: imports.map((raw, index) => {
      const typeOnly = raw.startsWith("type:");
      const specifier = raw.replace(/^type:/, "");
      return { specifier, line: index + 1, text: `import { ${nameFrom(specifier)} } from "${specifier}"`, names: [nameFrom(specifier)], typeOnly, dynamic: false };
    }),
    exports: [],
    publicMethods: [],
    hasDocComment: false,
    usage: {},
    ...extra,
  };
}

export const directResolver: RelResolver = (specifier) =>
  specifier.startsWith("pkg:") ? { kind: "package", name: specifier.slice(4) } : { kind: "file", path: specifier };

export function graphOf(files: SourceAnalysis[]): Graph {
  const graph = createGraph();
  for (const file of files) setFile(graph, file, directResolver);
  return graph;
}

export const DOCUMENT_SERVICE = "src/services/DocumentService.ts";

/** the "Typical service" sample from the design canvas */
export function serviceGraph(): Graph {
  return graphOf([
    analysisOf(DOCUMENT_SERVICE, ["src/db/repositories/DocumentRepository.ts", "src/integrations/storage/StorageClient.ts", "src/auth/PermissionPolicy.ts", "type:src/types/document.types.ts"], {
      lineCount: 31,
      exports: ["class DocumentService"],
      publicMethods: ["listForEmployee", "upload", "remindUnsigned"],
      usage: { DocumentRepository: [{ line: 15, text: "return this.documents.findByEmployee(employeeId)" }] },
    }),
    ...["Employee", "Contract", "Leave", "Payroll"].flatMap((name) => [
      analysisOf(`src/services/${name}Service.ts`, [`src/services/I${name}Service.ts`], { lineCount: 120 }),
      analysisOf(`src/services/I${name}Service.ts`),
      analysisOf(`test/services/${name}Service.spec.ts`, [`src/services/${name}Service.ts`]),
    ]),
    analysisOf("src/api/controllers/DocumentController.ts", [DOCUMENT_SERVICE], {
      usage: { DocumentService: [{ line: 27, text: "return this.service.listForEmployee(actor, id)" }] },
    }),
    analysisOf("src/jobs/SendReminderJob.ts", [DOCUMENT_SERVICE]),
    analysisOf("src/api/routes.ts", ["src/api/controllers/DocumentController.ts"]),
    analysisOf("src/jobs/scheduler.ts", ["src/jobs/SendReminderJob.ts"]),
    analysisOf("src/db/repositories/DocumentRepository.ts", ["src/db/schema.ts"]),
    analysisOf("src/db/schema.ts"),
    analysisOf("src/integrations/storage/StorageClient.ts", ["src/config/storage.config.ts"]),
    analysisOf("src/config/storage.config.ts"),
    analysisOf("src/auth/PermissionPolicy.ts", ["src/auth/roles.ts"]),
    analysisOf("src/auth/roles.ts"),
    analysisOf("src/types/document.types.ts"),
    analysisOf("test/services/DocumentService.spec.ts", [DOCUMENT_SERVICE, "test/fixtures/documents.fixture.ts"]),
    analysisOf("test/fixtures/documents.fixture.ts"),
  ]);
}
```

- [ ] **Step 2: Write the failing test `test/unit/graph/buildGraph.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { dependenciesOf, dependentsOf, removeFile, setFile } from "../../../src/graph/buildGraph";
import { analysisOf, directResolver, graphOf } from "../helpers/fixtures";

describe("import graph", () => {
  it("merges several imports of the same file into one dependency", () => {
    const graph = graphOf([analysisOf("src/a.ts", ["src/b.ts", "src/b.ts", "pkg:lodash"]), analysisOf("src/b.ts")]);
    expect(dependenciesOf(graph, "src/a.ts")).toEqual([{ from: "src/a.ts", to: "src/b.ts", names: ["b"], typeOnly: false, line: 1 }]);
    expect(dependentsOf(graph, "src/b.ts").map((dependency) => dependency.from)).toEqual(["src/a.ts"]);
    expect(graph.packages.get("src/a.ts")).toEqual([{ name: "lodash", line: 3 }]);
  });

  it("replaces a file's edges when the file is read again", () => {
    const graph = graphOf([analysisOf("src/a.ts", ["src/b.ts"]), analysisOf("src/b.ts")]);
    setFile(graph, analysisOf("src/a.ts", []), directResolver);
    expect(dependentsOf(graph, "src/b.ts")).toEqual([]);
  });

  it("removes a deleted file but keeps the files that still import it", () => {
    const graph = graphOf([analysisOf("src/a.ts", ["src/b.ts"]), analysisOf("src/b.ts")]);
    removeFile(graph, "src/b.ts");
    expect(graph.files.has("src/b.ts")).toBe(false);
    expect(dependentsOf(graph, "src/b.ts").map((dependency) => dependency.from)).toEqual(["src/a.ts"]);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -- test/unit/graph/buildGraph.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `src/graph/buildGraph.ts`**

```ts
import type { SourceAnalysis } from "./analyzeSource";

export type RelResolution = { kind: "file"; path: string } | { kind: "package"; name: string } | { kind: "builtin" } | { kind: "unresolved" };
/** resolves a specifier written in fromPath; both paths are workspace-relative */
export type RelResolver = (specifier: string, fromPath: string) => RelResolution;

export interface Dependency {
  from: string;
  to: string;
  names: string[];
  typeOnly: boolean;
  line: number;
}

export interface PackageUse {
  name: string;
  line: number;
}

export interface Graph {
  files: Map<string, SourceAnalysis>;
  dependencies: Map<string, Dependency[]>;
  dependents: Map<string, Dependency[]>;
  packages: Map<string, PackageUse[]>;
}

export function createGraph(): Graph {
  return { files: new Map(), dependencies: new Map(), dependents: new Map(), packages: new Map() };
}

export function setFile(graph: Graph, analysis: SourceAnalysis, resolve: RelResolver): void {
  removeFile(graph, analysis.path);
  graph.files.set(analysis.path, analysis);
  const byTarget = new Map<string, Dependency>();
  const packages = new Map<string, PackageUse>();
  for (const record of analysis.imports) {
    const resolution = resolve(record.specifier, analysis.path);
    if (resolution.kind === "package" && !packages.has(resolution.name)) packages.set(resolution.name, { name: resolution.name, line: record.line });
    if (resolution.kind !== "file" || resolution.path === analysis.path) continue;
    const existing = byTarget.get(resolution.path);
    if (existing) {
      existing.names = [...new Set([...existing.names, ...record.names])];
      existing.typeOnly = existing.typeOnly && record.typeOnly;
      continue;
    }
    byTarget.set(resolution.path, { from: analysis.path, to: resolution.path, names: [...new Set(record.names)], typeOnly: record.typeOnly, line: record.line });
  }
  const dependencies = [...byTarget.values()];
  graph.dependencies.set(analysis.path, dependencies);
  graph.packages.set(analysis.path, [...packages.values()]);
  for (const dependency of dependencies) {
    graph.dependents.set(dependency.to, [...(graph.dependents.get(dependency.to) ?? []), dependency]);
  }
}

export function removeFile(graph: Graph, path: string): void {
  for (const dependency of graph.dependencies.get(path) ?? []) {
    graph.dependents.set(dependency.to, (graph.dependents.get(dependency.to) ?? []).filter((incoming) => incoming.from !== path));
  }
  graph.dependencies.delete(path);
  graph.packages.delete(path);
  graph.files.delete(path);
}

export const dependenciesOf = (graph: Graph, path: string): Dependency[] => graph.dependencies.get(path) ?? [];
export const dependentsOf = (graph: Graph, path: string): Dependency[] => graph.dependents.get(path) ?? [];
```

- [ ] **Step 5: Run the test**

Run: `npm test -- test/unit/graph/buildGraph.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/graph/buildGraph.ts test/unit/helpers/fixtures.ts test/unit/graph/buildGraph.test.ts
git commit -m "feat: keep an import graph with a dependents index"
```

---

### Task 6: Pattern rules (#6)

**Files:**
- Create: `src/graph/patterns.ts`
- Test: `test/unit/graph/patterns.test.ts`

Rules, all without AI:
- A test file matches `.spec.*`, `.test.*`, `_test.*` or sits in `__tests__/`. "Tested by" means a test file imports the file.
- Expected test: at least 3 siblings in the folder and at least 75% of them have a test, but this file has none.
- Expected partner file: same thresholds for `I<Name>` and `<name>.types` partner files.
- Circular import: the open file imports X and X imports the open file.
- Size outlier: at least 300 lines and at least 3 times the median of the siblings.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { removeFile } from "../../../src/graph/buildGraph";
import { circularWith, expectedFiles, isTestFile, sizeOutlier, subjectOf, testsOf } from "../../../src/graph/patterns";
import { DOCUMENT_SERVICE, analysisOf, graphOf, serviceGraph } from "../helpers/fixtures";

describe("pattern rules", () => {
  it("recognises test files by name and folder", () => {
    expect(["a.spec.ts", "a.test.tsx", "src/__tests__/a.ts", "a_test.js"].every(isTestFile)).toBe(true);
    expect(isTestFile("src/specification.ts")).toBe(false);
  });

  it("finds the tests that import a file and the file a test is for", () => {
    const graph = serviceGraph();
    expect(testsOf(graph, DOCUMENT_SERVICE)).toEqual(["test/services/DocumentService.spec.ts"]);
    expect(subjectOf(graph, "test/services/DocumentService.spec.ts")).toBe(DOCUMENT_SERVICE);
  });

  it("expects an interface file when most siblings have one", () => {
    expect(expectedFiles(serviceGraph(), DOCUMENT_SERVICE)).toEqual([
      { path: "src/services/IDocumentService.ts", kind: "partner", reason: "4 of 4 files in src/services have a matching interface file." },
    ]);
  });

  it("expects a test when most siblings have one and this file has none", () => {
    const graph = serviceGraph();
    removeFile(graph, "test/services/DocumentService.spec.ts");
    expect(expectedFiles(graph, DOCUMENT_SERVICE)[0]).toEqual({
      path: "test/services/DocumentService.spec.ts",
      kind: "test",
      reason: "4 of 4 files in src/services have a test that imports them.",
    });
  });

  it("expects nothing when the folder has fewer than 3 siblings", () => {
    const graph = graphOf([analysisOf("src/x/A.ts"), analysisOf("src/x/IB.ts"), analysisOf("src/x/B.ts")]);
    expect(expectedFiles(graph, "src/x/A.ts")).toEqual([]);
  });

  it("finds circular imports", () => {
    const graph = graphOf([analysisOf("src/a.ts", ["src/b.ts"]), analysisOf("src/b.ts", ["src/a.ts"])]);
    expect(circularWith(graph, "src/a.ts")).toEqual(["src/b.ts"]);
  });

  it("flags a file much larger than its siblings", () => {
    const sizes = [1240, 120, 110, 130];
    const graph = graphOf(sizes.map((lineCount, index) => analysisOf(`src/s/F${index}.ts`, [], { lineCount })));
    expect(sizeOutlier(graph, "src/s/F0.ts")).toEqual({ lines: 1240, median: 120 });
    expect(sizeOutlier(graph, "src/s/F1.ts")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- test/unit/graph/patterns.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/graph/patterns.ts`**

```ts
import { dependenciesOf, dependentsOf, type Graph } from "./buildGraph";

const TEST_PATTERN = /(\.|_)(spec|test)\.[cm]?[jt]sx?$|(^|\/)__tests__\//;
const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/;
const MIN_SIBLINGS = 3;
const MIN_SHARE = 0.75;

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

const isPartnerFile = (path: string) => /^I[A-Z]/.test(baseNameOf(path)) || baseNameOf(path).endsWith(".types");

export function testsOf(graph: Graph, path: string): string[] {
  return dependentsOf(graph, path).map((dependency) => dependency.from).filter(isTestFile);
}

export function subjectOf(graph: Graph, testPath: string): string | null {
  const base = baseNameOf(testPath);
  return dependenciesOf(graph, testPath).find((dependency) => baseNameOf(dependency.to) === base)?.to ?? null;
}

function siblingsOf(graph: Graph, path: string): string[] {
  const folder = folderOf(path);
  return [...graph.files.keys()].filter(
    (other) => other !== path && folderOf(other) === folder && !isTestFile(other) && !other.endsWith(".d.ts") && !fileNameOf(other).startsWith("index.") && !isPartnerFile(other),
  );
}

export function expectedFiles(graph: Graph, path: string): ExpectedFile[] {
  if (isTestFile(path) || isPartnerFile(path)) return [];
  const siblings = siblingsOf(graph, path);
  if (siblings.length < MIN_SIBLINGS) return [];
  const folder = folderOf(path);
  const base = baseNameOf(path);
  const result: ExpectedFile[] = [];

  if (testsOf(graph, path).length === 0) {
    const tested = siblings.filter((sibling) => testsOf(graph, sibling).length > 0);
    if (tested.length / siblings.length >= MIN_SHARE) {
      const exampleTest = testsOf(graph, tested[0])[0];
      result.push({
        path: exampleTest.replace(baseNameOf(tested[0]), base),
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
    const extension = fileNameOf(path).match(SOURCE_EXTENSION)?.[0] ?? ".ts";
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
  return lines >= 300 && lines >= 3 * median ? { lines, median } : null;
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- test/unit/graph/patterns.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/graph/patterns.ts test/unit/graph/patterns.test.ts
git commit -m "feat: add rules for tests, expected files, circular imports and size"
```

---

### Task 7: View data for one open file (#7)

**Files:**
- Create: `src/graph/neighbourhood.ts`
- Test: `test/unit/graph/neighbourhood.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildViewData } from "../../../src/graph/neighbourhood";
import { DOCUMENT_SERVICE, analysisOf, graphOf, serviceGraph } from "../helpers/fixtures";

const kinds = (view: ReturnType<typeof buildViewData>) =>
  Object.fromEntries(view.nodes.map((node) => [node.id, `${node.kind}${node.secondLayer ? " (second)" : ""}`]));

describe("buildViewData", () => {
  it("places every connection of the typical service sample", () => {
    expect(kinds(buildViewData(serviceGraph(), DOCUMENT_SERVICE))).toEqual({
      [DOCUMENT_SERVICE]: "here",
      "src/api/controllers/DocumentController.ts": "caller",
      "src/jobs/SendReminderJob.ts": "caller",
      "test/services/DocumentService.spec.ts": "test",
      "src/db/repositories/DocumentRepository.ts": "dependency",
      "src/integrations/storage/StorageClient.ts": "dependency",
      "src/auth/PermissionPolicy.ts": "dependency",
      "src/types/document.types.ts": "types",
      "expected:src/services/IDocumentService.ts": "expected",
      "src/api/routes.ts": "caller (second)",
      "src/jobs/scheduler.ts": "caller (second)",
      "src/db/schema.ts": "dependency (second)",
      "src/config/storage.config.ts": "dependency (second)",
      "src/auth/roles.ts": "dependency (second)",
      "test/fixtures/documents.fixture.ts": "dependency (second)",
    });
  });

  it("connects second-layer files through the immediate layer", () => {
    const view = buildViewData(serviceGraph(), DOCUMENT_SERVICE);
    expect(view.nodes.find((node) => node.id === "src/api/routes.ts")?.via).toEqual(["src/api/controllers/DocumentController.ts"]);
    expect(view.edges).toContainEqual({ from: "src/api/routes.ts", to: "src/api/controllers/DocumentController.ts", style: "solid" });
    expect(view.edges).toContainEqual({ from: DOCUMENT_SERVICE, to: "expected:src/services/IDocumentService.ts", style: "dashed" });
  });

  it("collects usage lines, call sites and gutter marks", () => {
    const view = buildViewData(serviceGraph(), DOCUMENT_SERVICE);
    const repository = view.nodes.find((node) => node.id === "src/db/repositories/DocumentRepository.ts")!;
    expect(repository.usageInOpenFile.map((site) => site.line)).toEqual([1, 15]);
    const controller = view.nodes.find((node) => node.id === "src/api/controllers/DocumentController.ts")!;
    expect(controller.callSites).toEqual([
      { line: 1, text: 'import { DocumentService } from "src/services/DocumentService.ts"' },
      { line: 27, text: "return this.service.listForEmployee(actor, id)" },
    ]);
    expect(view.lineMarks).toContainEqual({ line: 15, nodeId: "src/db/repositories/DocumentRepository.ts" });
  });

  it("lists facts and pattern checks for the open file", () => {
    const center = buildViewData(serviceGraph(), DOCUMENT_SERVICE).nodes[0];
    expect(center.facts).toContainEqual({ label: "Size", value: "31 lines" });
    expect(center.facts).toContainEqual({ label: "Public methods", value: "listForEmployee, upload, remindUnsigned" });
    expect(center.checks).toContainEqual({ label: "Missing", value: "IDocumentService.ts: 4 of 4 files in src/services have a matching interface file." });
  });

  it("marks the file under test when a test file is open", () => {
    const view = buildViewData(serviceGraph(), "test/services/DocumentService.spec.ts");
    expect(view.nodes.find((node) => node.id === DOCUMENT_SERVICE)?.kind).toBe("subject");
  });

  it("shows both directions of a circular import", () => {
    const view = buildViewData(graphOf([analysisOf("src/a.ts", ["src/b.ts"]), analysisOf("src/b.ts", ["src/a.ts"])]), "src/a.ts");
    expect(view.nodes.find((node) => node.id === "src/b.ts")?.kind).toBe("cycle");
    expect(view.edges).toEqual([
      { from: "src/a.ts", to: "src/b.ts", style: "solid", label: "circular import" },
      { from: "src/b.ts", to: "src/a.ts", style: "solid" },
    ]);
  });

  it("explains what was checked when nothing connects to a file", () => {
    const view = buildViewData(graphOf([analysisOf("src/utils/currency.ts")]), "src/utils/currency.ts", { packageJsonText: '{"scripts":{}}' });
    expect(view.nodes).toHaveLength(1);
    expect(view.orphanChecks?.map((check) => check.label)).toEqual(["imports", "dynamic", "config"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- test/unit/graph/neighbourhood.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/graph/neighbourhood.ts`**

```ts
import type { CallSite, Fact, NodeKind, ViewData, ViewEdge, ViewNode } from "../shared/viewData";
import type { SourceAnalysis } from "./analyzeSource";
import { dependenciesOf, dependentsOf, type Dependency, type Graph } from "./buildGraph";
import { baseNameOf, circularWith, expectedFiles, fileNameOf, folderOf, isTestFile, sizeOutlier, subjectOf, testsOf } from "./patterns";

export interface ViewOptions {
  packageJsonText?: string;
  scan?: { done: number; total: number } | null;
}

export function buildViewData(graph: Graph, path: string, options: ViewOptions = {}): ViewData {
  const nodes = new Map<string, ViewNode>();
  const edges: ViewEdge[] = [];
  const edgeKeys = new Set<string>();
  const center = graph.files.get(path);
  const add = (node: ViewNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
    return nodes.get(node.id)!;
  };
  const connect = (edge: ViewEdge) => {
    const key = `${edge.from}>${edge.to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  };

  const here = add(fileNode(graph, path, "here", false));
  const cycles = new Set(circularWith(graph, path));
  const tests = new Set(isTestFile(path) ? [] : testsOf(graph, path));
  const subject = isTestFile(path) ? subjectOf(graph, path) : null;

  for (const dependency of dependentsOf(graph, path)) {
    if (cycles.has(dependency.from)) continue;
    const node = add(fileNode(graph, dependency.from, tests.has(dependency.from) ? "test" : "caller", false));
    node.callSites = sitesIn(graph.files.get(dependency.from), dependency);
    connect({ from: node.id, to: path, style: "solid" });
  }

  for (const dependency of dependenciesOf(graph, path)) {
    const kind: NodeKind = cycles.has(dependency.to) ? "cycle" : dependency.to === subject ? "subject" : isTypesDependency(dependency) ? "types" : "dependency";
    const node = add(fileNode(graph, dependency.to, kind, false));
    node.usageInOpenFile = sitesIn(center, dependency);
    if (kind !== "cycle") {
      connect({ from: path, to: node.id, style: "solid" });
      continue;
    }
    const back = dependenciesOf(graph, dependency.to).find((candidate) => candidate.to === path)!;
    node.callSites = sitesIn(graph.files.get(dependency.to), back);
    connect({ from: path, to: node.id, style: "solid", label: "circular import" });
    connect({ from: node.id, to: path, style: "solid" });
    const cycleText = `${fileNameOf(path)} imports it on line ${dependency.line}. It imports ${fileNameOf(path)} on line ${back.line}.`;
    node.checks.push({ label: "Cycle", value: cycleText });
    here.checks.push({ label: "Circular import", value: `${fileNameOf(dependency.to)}: ${cycleText}` });
  }

  for (const use of graph.packages.get(path) ?? []) {
    const node = add({ ...emptyNode(`package:${use.name}`, "package", use.name, ""), facts: [{ label: "Package", value: use.name }] });
    node.usageInOpenFile.push({ line: use.line, text: center?.imports.find((record) => record.line === use.line)?.text ?? "" });
    connect({ from: path, to: node.id, style: "solid" });
  }

  for (const expected of expectedFiles(graph, path)) {
    const node = add({ ...emptyNode(`expected:${expected.path}`, "expected", fileNameOf(expected.path), folderOf(expected.path)), expectedKind: expected.kind });
    node.facts = [{ label: "Status", value: "File does not exist" }];
    node.checks = [{ label: "Rule", value: expected.reason }];
    here.checks.push({ label: "Missing", value: `${node.name}: ${expected.reason}` });
    connect(expected.kind === "test" ? { from: node.id, to: path, style: "dashed" } : { from: path, to: node.id, style: "dashed" });
  }

  const outlier = sizeOutlier(graph, path);
  if (outlier) here.checks.push({ label: "Size", value: `${outlier.lines} lines. Files in this folder have a median of ${outlier.median}.` });
  if (!isTestFile(path) && tests.size === 0 && !here.checks.some((check) => check.label === "Missing" && check.value.includes("test"))) {
    here.checks.push({ label: "Tests", value: "No test imports this file." });
  }

  const immediate = new Set(nodes.keys());
  const addSecond = (id: string, kind: NodeKind, via: string, direction: "up" | "down") => {
    if (id === path || immediate.has(id)) return;
    const node = add(fileNode(graph, id, kind, true));
    if (!node.via.includes(via)) node.via.push(via);
    connect(direction === "up" ? { from: id, to: via, style: "solid" } : { from: via, to: id, style: "solid" });
  };
  for (const near of [...nodes.values()]) {
    if (near.kind === "caller") for (const dependency of dependentsOf(graph, near.id)) addSecond(dependency.from, "caller", near.id, "up");
    if (["dependency", "types", "subject", "test", "cycle"].includes(near.kind)) {
      for (const dependency of dependenciesOf(graph, near.id)) addSecond(dependency.to, "dependency", near.id, "down");
    }
  }

  const lineMarks: ViewData["lineMarks"] = [];
  const marked = new Set<number>();
  for (const node of nodes.values()) {
    for (const site of node.usageInOpenFile) {
      if (marked.has(site.line)) continue;
      marked.add(site.line);
      lineMarks.push({ line: site.line, nodeId: node.id });
    }
  }

  return {
    openFile: path,
    nodes: [...nodes.values()],
    edges,
    lineMarks,
    orphanChecks: nodes.size === 1 + countExpected(nodes) ? orphanChecks(path, options.packageJsonText ?? "") : null,
    scan: options.scan ?? null,
  };
}

function emptyNode(id: string, kind: NodeKind, name: string, dir: string): ViewNode {
  return { id, kind, name, dir, secondLayer: false, via: [], usageInOpenFile: [], callSites: [], facts: [], checks: [] };
}

function fileNode(graph: Graph, path: string, kind: NodeKind, secondLayer: boolean): ViewNode {
  return { ...emptyNode(path, kind, fileNameOf(path), folderOf(path)), secondLayer, facts: factsOf(graph, path) };
}

function isTypesDependency(dependency: Dependency): boolean {
  return dependency.typeOnly || /\.types?\.[cm]?[jt]sx?$|\.d\.ts$/.test(dependency.to);
}

/** import line plus every line that uses a name from that import */
function sitesIn(analysis: SourceAnalysis | undefined, dependency: Dependency): CallSite[] {
  if (!analysis) return [];
  const importText = analysis.imports.find((record) => record.line === dependency.line)?.text ?? "";
  const sites = [{ line: dependency.line, text: importText }, ...dependency.names.flatMap((name) => analysis.usage[name] ?? [])];
  const byLine = new Map(sites.map((site) => [site.line, site]));
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const listOf = (items: string[], max = 4) => items.slice(0, max).join(", ") + (items.length > max ? `, +${items.length - max} more` : "");

function factsOf(graph: Graph, path: string): Fact[] {
  const analysis = graph.files.get(path);
  if (!analysis) return [{ label: "Status", value: "Not read yet" }];
  const facts: Fact[] = [];
  if (analysis.exports.length) facts.push({ label: "Exports", value: listOf(analysis.exports) });
  if (analysis.publicMethods.length) facts.push({ label: "Public methods", value: listOf(analysis.publicMethods) });
  facts.push({ label: "Size", value: `${analysis.lineCount} lines` });
  facts.push({ label: "Doc comment", value: analysis.hasDocComment ? "yes" : "none" });
  facts.push({ label: "Imports", value: plural(dependenciesOf(graph, path).length, "project file") });
  facts.push({ label: "Imported by", value: plural(dependentsOf(graph, path).length, "file") });
  return facts;
}

const countExpected = (nodes: Map<string, ViewNode>) => [...nodes.values()].filter((node) => node.kind === "expected").length;

function orphanChecks(path: string, packageJsonText: string): Fact[] {
  const name = fileNameOf(path);
  const namedInPackageJson = packageJsonText.includes(baseNameOf(path));
  return [
    { label: "imports", value: `No file imports ${name}, directly or through an index file.` },
    { label: "dynamic", value: "No dynamic import() or require() points to it." },
    { label: "config", value: namedInPackageJson ? `${baseNameOf(path)} is named in package.json, so a script may run it.` : "Not named in package.json." },
  ];
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- test/unit/graph/neighbourhood.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/graph/neighbourhood.ts test/unit/graph/neighbourhood.test.ts
git commit -m "feat: build view data for the open file and its second layer"
```

---

### Task 8: Git history (#8)

**Files:**
- Create: `src/workspace/gitFacts.ts`
- Test: `test/unit/workspace/gitFacts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, it } from "vitest";
import { parseGitLog } from "../../../src/workspace/gitFacts";

it("turns git log lines into facts", () => {
  const stdout = "3 weeks ago\tadd remindUnsigned for the reminder job\n4 months ago\tcheck permissions on upload\n";
  expect(parseGitLog(stdout)).toEqual([
    { label: "3 weeks ago", value: "add remindUnsigned for the reminder job" },
    { label: "4 months ago", value: "check permissions on upload" },
  ]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- test/unit/workspace/gitFacts.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/workspace/gitFacts.ts`**

```ts
import { execFile } from "node:child_process";
import type { Fact } from "../shared/viewData";

export function parseGitLog(stdout: string): Fact[] {
  return stdout
    .split("\n")
    .filter((line) => line.includes("\t"))
    .map((line) => {
      const [when, subject] = line.split("\t");
      return { label: when, value: subject };
    });
}

export function gitHistory(root: string, relativePath: string): Promise<Fact[]> {
  return new Promise((resolve) => {
    execFile("git", ["log", "-n", "3", "--follow", "--format=%cr%x09%s", "--", relativePath], { cwd: root, timeout: 3000 }, (error, stdout) => {
      resolve(error ? [] : parseGitLog(stdout));
    });
  });
}
```

- [ ] **Step 4: Run the test and commit**

```bash
npm test -- test/unit/workspace/gitFacts.test.ts
git add src/workspace/gitFacts.ts test/unit/workspace/gitFacts.test.ts
git commit -m "feat: read the last commits of a file"
```

Expected: PASS, 1 test.

---

### Task 9: Layout engine (#9)

Port of `buildImmediateLayer`, `buildSecondLayer` and the wire routing in `docs/design/wayfinder-mockup.dc.html`.

**Files:**
- Create: `src/webview/layout.ts`
- Test: `test/unit/webview/layout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildViewData } from "../../../src/graph/neighbourhood";
import { layout, type UiState } from "../../../src/webview/layout";
import { DOCUMENT_SERVICE, analysisOf, graphOf, serviceGraph } from "../helpers/fixtures";

const ui = (patch: Partial<UiState> = {}): UiState => ({ selected: DOCUMENT_SERVICE, layer: 1, open: {}, ...patch });
const view = () => buildViewData(serviceGraph(), DOCUMENT_SERVICE);
const CONTROLLER = "src/api/controllers/DocumentController.ts";

describe("layout", () => {
  it("stacks the four floors and centres each row", () => {
    const { inner } = layout(view(), ui());
    expect(inner.floors.map((floor) => [floor.title, floor.y, floor.h])).toEqual([
      ["Imports this file", 16, 112],
      ["Same folder", 142, 112],
      ["Imported by this file", 268, 112],
      ["Tests", 394, 112],
    ]);
    const x = (id: string) => inner.nodes.find((node) => node.id === id)?.x;
    expect([x(CONTROLLER), x("src/jobs/SendReminderJob.ts")]).toEqual([196, 364]);
    expect(inner.nodes.find((node) => node.id === DOCUMENT_SERVICE)).toMatchObject({ x: 380, y: 176, w: 220 });
    expect(x("expected:src/services/IDocumentService.ts")).toBe(28);
    expect(x("test/services/DocumentService.spec.ts")).toBe(280);
  });

  it("routes the test wire along the right-hand lane", () => {
    const testWire = layout(view(), ui()).inner.wires.find((wire) => wire.cls.startsWith("pink"));
    expect(testWire?.d.startsWith("M356 484 V487")).toBe(true);
  });

  it("shows four nodes and a footer toggle when a floor has more", () => {
    const callers = Array.from({ length: 6 }, (_, index) => analysisOf(`src/c/C${index}.ts`, ["src/x.ts"]));
    const crowded = buildViewData(graphOf([analysisOf("src/x.ts"), ...callers]), "src/x.ts");
    const closed = layout(crowded, ui({ selected: "src/x.ts" })).inner.floors[0];
    expect(closed).toMatchObject({ h: 142, toggle: { text: "Show 2 more", icon: "plus", y: 128 } });
    const opened = layout(crowded, ui({ selected: "src/x.ts", open: { callers: true } }));
    expect(opened.inner.floors[0]).toMatchObject({ h: 216, toggle: { text: "Show fewer", icon: "minus" } });
    expect(opened.inner.nodes.filter((node) => node.id.startsWith("src/c/"))).toHaveLength(6);
  });

  it("brightens the wires of the selected node and fades the rest", () => {
    const wires = layout(view(), ui({ selected: CONTROLLER })).inner.wires;
    expect(wires.filter((wire) => wire.cls.endsWith(" hi"))).toHaveLength(1);
    expect(wires.every((wire) => wire.cls.endsWith(" hi") || wire.cls.endsWith(" lo"))).toBe(true);
  });

  it("shrinks the immediate layer into a frame for the second layer", () => {
    const result = layout(view(), ui({ layer: 2 }));
    expect(result.outer?.frame).toEqual({ x: 166, y: 172, w: 468, h: 356 });
    expect(result.outer?.transform).toBe("translate(176px, 182px) scale(0.56)");
    expect(result.outer?.floors.map((floor) => floor.title)).toEqual(["Second layer: imports the callers", "Second layer: imported by the immediate layer"]);
    expect(layout(view(), ui()).outer).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- test/unit/webview/layout.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/webview/layout.ts`**

```ts
import type { Fact, NodeKind, ViewData, ViewNode } from "../shared/viewData";

export const NODE_W = 152;
export const NODE_H = 56;
export const HERE_W = 220;
export const HERE_H = 64;
export const COL_GAP = 16;
export const ROW_H = 74;
export const MAX_PER_ROW = 4;
export const AREA_LEFT = 28;
export const AREA_W = 656;
export const LANE_X = 756;
export const CANVAS_W = 800;
export const CLUSTER_SCALE = 0.56;

export interface UiState {
  selected: string;
  layer: 1 | 2;
  open: Record<string, boolean>;
}

export interface Box { x: number; y: number; w: number; h: number; floor: number; }
export interface FloorToggle { text: string; icon: "plus" | "minus"; y: number; }
export interface FloorView { key: string; title: string; path: string; cls: string; y: number; h: number; emptyText: string; toggle: FloorToggle | null; }
export interface NodeView { id: string; x: number; y: number; w: number; cls: string; tag: string; name: string; path: string; }
export interface WireView { cls: string; d: string; }
export interface PortView { cls: string; x: number; y: number; incoming: boolean; }
export interface LabelView { cls: string; x: number; y: number; text: string; }
export interface BannerView { y: number; title: string; items: Fact[]; progress: number | null; }
export interface LayerView { floors: FloorView[]; nodes: NodeView[]; wires: WireView[]; ports: PortView[]; labels: LabelView[]; banners: BannerView[]; height: number; }
export interface SecondLayerView extends LayerView { frame: { x: number; y: number; w: number; h: number }; transform: string; }
export interface Layout { inner: LayerView; outer: SecondLayerView | null; }

const KIND_COLOR: Record<NodeKind, string> = {
  here: "green", caller: "blue", dependency: "violet", types: "violet", test: "pink", subject: "pink", expected: "violet", cycle: "red", package: "grey",
};
const KIND_TAG: Record<NodeKind, string> = {
  here: "Open file", caller: "Caller", dependency: "Dependency", types: "Types", test: "Test", subject: "Under test", expected: "Expected, not found", cycle: "Circular import", package: "Package",
};

export const colorOf = (node: ViewNode): string => (node.kind === "expected" && node.expectedKind === "test" ? "pink" : KIND_COLOR[node.kind]);

const FLOORS: { key: string; title: string; takes: (node: ViewNode) => boolean; empty: (name: string) => string }[] = [
  { key: "callers", title: "Imports this file", takes: (node) => node.kind === "caller", empty: (name) => `No file imports ${name}.` },
  { key: "mine", title: "Same folder", takes: (node) => node.kind === "here" || node.kind === "cycle" || (node.kind === "expected" && node.expectedKind === "partner"), empty: () => "" },
  { key: "deps", title: "Imported by this file", takes: (node) => ["dependency", "types", "subject", "package"].includes(node.kind), empty: (name) => `${name} imports no project files.` },
  { key: "tests", title: "Tests", takes: (node) => node.kind === "test" || (node.kind === "expected" && node.expectedKind === "test"), empty: (name) => `No test imports ${name}.` },
];

export function layout(view: ViewData, ui: UiState): Layout {
  const inner = layoutImmediate(view, ui);
  return { inner: inner.layer, outer: ui.layer === 2 ? layoutSecond(view, ui, inner) : null };
}

function foldersOf(nodes: ViewNode[]): string {
  const dirs = [...new Set(nodes.map((node) => node.dir).filter(Boolean))];
  return dirs.slice(0, 4).join(", ") + (dirs.length > 4 ? `, +${dirs.length - 4} more` : "");
}

function layoutRow(ids: string[], open: boolean, top: number, floor: number) {
  const collapsible = ids.length > MAX_PER_ROW;
  const shown = collapsible && !open ? ids.slice(0, MAX_PER_ROW) : ids;
  const rows = Math.max(1, Math.ceil(shown.length / MAX_PER_ROW));
  const boxes: Record<string, Box> = {};
  shown.forEach((id, index) => {
    const row = Math.floor(index / MAX_PER_ROW);
    const col = index % MAX_PER_ROW;
    const inRow = Math.min(MAX_PER_ROW, shown.length - row * MAX_PER_ROW);
    const startX = AREA_LEFT + (AREA_W - (inRow * NODE_W + (inRow - 1) * COL_GAP)) / 2;
    boxes[id] = { x: startX + col * (NODE_W + COL_GAP), y: top + 34 + row * ROW_H, w: NODE_W, h: NODE_H, floor };
  });
  const h = 34 + rows * ROW_H + 4 + (collapsible ? 30 : 0);
  const toggle: FloorToggle | null = collapsible
    ? { text: open ? "Show fewer" : `Show ${ids.length - shown.length} more`, icon: open ? "minus" : "plus", y: top + h - 30 }
    : null;
  return { boxes, h, toggle };
}

function nodeView(node: ViewNode, box: Box, ui: UiState): NodeView {
  const cls = [colorOf(node), node.secondLayer ? "two" : "", node.kind === "expected" ? "ghost" : "", node.kind === "here" ? "here" : "", ui.selected === node.id ? "sel" : ""]
    .filter(Boolean)
    .join(" ");
  return {
    id: node.id, x: box.x, y: box.y, w: box.w, cls,
    tag: node.secondLayer ? "Second layer" : KIND_TAG[node.kind],
    name: node.name,
    path: node.kind === "package" ? "npm package" : node.dir,
  };
}

function wireState(view: ViewData, ui: UiState, ends: string[]): string {
  if (ui.selected === view.openFile) return "";
  return ends.includes(ui.selected) ? " hi" : " lo";
}

export function routeWire(a: Box, b: Box, dy: number, laneIndex: number) {
  if (a.floor === b.floor) {
    const x1 = a.x < b.x ? a.x + a.w : a.x;
    const x2 = a.x < b.x ? b.x : b.x + b.w;
    const y1 = a.y + a.h / 2 + dy;
    const y2 = b.y + b.h / 2 + dy;
    const mx = (x1 + x2) / 2;
    return { d: `M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`, x1, y1, x2, y2, usedLane: false };
  }
  if (Math.abs(a.floor - b.floor) === 1) {
    const x1 = a.x + a.w / 2;
    const x2 = b.x + b.w / 2;
    const y1 = a.floor < b.floor ? a.y + a.h : a.y;
    const y2 = a.floor < b.floor ? b.y : b.y + b.h;
    const k = (y2 - y1) / 2;
    return { d: `M${x1} ${y1} C${x1} ${y1 + k}, ${x2} ${y2 - k}, ${x2} ${y2}`, x1, y1, x2, y2, usedLane: false };
  }
  const lane = LANE_X + laneIndex * 12;
  const x1 = a.x + a.w / 2;
  const y1 = a.y + a.h;
  const x2 = b.x + b.w;
  const y2 = b.y + b.h / 2;
  const under = y1 + 11 + laneIndex * 6;
  const d = `M${x1} ${y1} V${under - 8} Q${x1} ${under} ${x1 + 8} ${under} H${lane - 14} Q${lane} ${under} ${lane} ${under - 14} V${y2 + 14} Q${lane} ${y2} ${lane - 14} ${y2} H${x2}`;
  return { d, x1, y1, x2, y2, usedLane: true };
}

function layoutImmediate(view: ViewData, ui: UiState): { layer: LayerView; boxes: Record<string, Box> } {
  const immediate = view.nodes.filter((node) => !node.secondLayer);
  const byId = new Map(view.nodes.map((node) => [node.id, node]));
  const center = byId.get(view.openFile)!;
  const floors: FloorView[] = [];
  const banners: BannerView[] = [];
  const boxes: Record<string, Box> = {};
  let y = 16;

  if (view.scan) {
    const { done, total } = view.scan;
    banners.push({ y, title: "Reading the workspace", items: [{ label: "done", value: `${done} of ${total} files read. The map fills in as files are read.` }], progress: Math.round((100 * done) / Math.max(1, total)) });
    y += 136;
  }

  FLOORS.forEach((def, floorIndex) => {
    const members = immediate.filter(def.takes);
    if (def.key === "mine") {
      floors.push({ key: def.key, title: def.title, path: center.dir, cls: "mine", y, h: 112, emptyText: "", toggle: null });
      boxes[center.id] = { x: 380, y: y + 34, w: HERE_W, h: HERE_H, floor: floorIndex };
      members
        .filter((member) => member.kind !== "here")
        .slice(0, 2)
        .forEach((member, index) => {
          boxes[member.id] = { x: AREA_LEFT + index * (NODE_W + COL_GAP), y: y + 38, w: NODE_W, h: NODE_H, floor: floorIndex };
        });
      y += 112 + 14;
      return;
    }
    if (!members.length) {
      floors.push({ key: def.key, title: def.title, path: "", cls: "empty", y, h: 64, emptyText: def.empty(center.name), toggle: null });
      y += 64 + 14;
      return;
    }
    const row = layoutRow(members.map((member) => member.id), !!ui.open[def.key], y, floorIndex);
    Object.assign(boxes, row.boxes);
    floors.push({ key: def.key, title: def.title, path: foldersOf(members), cls: def.key === "tests" ? "annex" : "", y, h: row.h, emptyText: "", toggle: row.toggle });
    y += row.h + 14;
  });

  if (view.orphanChecks) {
    banners.push({ y: y + 4, title: "Nothing connects to this file", items: view.orphanChecks, progress: null });
    y += 210;
  }

  const wires: WireView[] = [];
  const ports: PortView[] = [];
  const labels: LabelView[] = [];
  let laneIndex = 0;
  for (const edge of view.edges) {
    const a = boxes[edge.from];
    const b = boxes[edge.to];
    if (!a || !b) continue;
    const fromNode = byId.get(edge.from)!;
    const toNode = byId.get(edge.to)!;
    const touchesCycle = fromNode.kind === "cycle" || toNode.kind === "cycle";
    const dy = touchesCycle ? (fromNode.kind === "cycle" ? 8 : -8) : 0;
    const route = routeWire(a, b, dy, laneIndex);
    if (route.usedLane) laneIndex++;
    const color = colorOf(edge.from === view.openFile ? toNode : fromNode);
    wires.push({ cls: `${color}${edge.style === "dashed" ? " dashed" : ""}${wireState(view, ui, [edge.from, edge.to])}`, d: route.d });
    ports.push({ cls: color, x: route.x1, y: route.y1, incoming: false }, { cls: color, x: route.x2, y: route.y2, incoming: true });
    if (edge.label) {
      labels.push({ cls: color, x: (route.x1 + route.x2) / 2, y: a.floor === b.floor ? Math.min(route.y1, route.y2) - 14 : (route.y1 + route.y2) / 2, text: edge.label });
    }
  }

  const nodes = immediate.filter((node) => boxes[node.id]).map((node) => nodeView(node, boxes[node.id], ui));
  return { layer: { floors, nodes, wires, ports, labels, banners, height: Math.max(y + 8, 600) }, boxes };
}

function layoutSecond(view: ViewData, ui: UiState, inner: { layer: LayerView; boxes: Record<string, Box> }): SecondLayerView | null {
  const second = view.nodes.filter((node) => node.secondLayer);
  if (!second.length) return null;
  const up = second.filter((node) => node.kind === "caller");
  const down = second.filter((node) => node.kind !== "caller");
  const floors: FloorView[] = [];
  const boxes: Record<string, Box> = {};
  const side = new Map<string, "up" | "down">();
  let y = 16;

  if (up.length) {
    const row = layoutRow(up.map((node) => node.id), !!ui.open.l2up, y, 0);
    Object.assign(boxes, row.boxes);
    floors.push({ key: "l2up", title: "Second layer: imports the callers", path: foldersOf(up), cls: "", y, h: row.h, emptyText: "", toggle: row.toggle });
    up.forEach((node) => side.set(node.id, "up"));
    y += row.h + 44;
  }
  const scaledWidth = Math.round(CANVAS_W * CLUSTER_SCALE);
  const ox = (CANVAS_W - scaledWidth) / 2;
  const oy = y + 10;
  const frame = { x: ox - 10, y: oy - 10, w: scaledWidth + 20, h: Math.round(inner.layer.height * CLUSTER_SCALE) + 20 };
  y = frame.y + frame.h + 44;
  if (down.length) {
    const row = layoutRow(down.map((node) => node.id), !!ui.open.l2down, y, 2);
    Object.assign(boxes, row.boxes);
    floors.push({ key: "l2down", title: "Second layer: imported by the immediate layer", path: foldersOf(down), cls: "", y, h: row.h, emptyText: "", toggle: row.toggle });
    down.forEach((node) => side.set(node.id, "down"));
    y += row.h + 16;
  }

  const wires: WireView[] = [];
  const ports: PortView[] = [];
  for (const edge of view.edges) {
    const outerId = side.has(edge.from) ? edge.from : side.has(edge.to) ? edge.to : null;
    if (!outerId) continue;
    const innerId = outerId === edge.from ? edge.to : edge.from;
    const p2 = boxes[outerId];
    const pi = inner.boxes[innerId];
    if (!p2 || !pi) continue;
    const xs = ox + (pi.x + pi.w / 2) * CLUSTER_SCALE;
    const goingUp = side.get(outerId) === "up";
    const x1 = goingUp ? p2.x + p2.w / 2 : xs;
    const y1 = goingUp ? p2.y + p2.h : frame.y + frame.h;
    const x2 = goingUp ? xs : p2.x + p2.w / 2;
    const y2 = goingUp ? frame.y : p2.y;
    const k = (y2 - y1) / 2;
    const color = colorOf(view.nodes.find((node) => node.id === outerId)!);
    wires.push({ cls: `${color}${wireState(view, ui, [outerId, innerId])}`, d: `M${x1} ${y1} C${x1} ${y1 + k}, ${x2} ${y2 - k}, ${x2} ${y2}` });
    ports.push({ cls: color, x: x1, y: y1, incoming: false }, { cls: color, x: x2, y: y2, incoming: true });
  }

  const nodes = second.filter((node) => boxes[node.id]).map((node) => nodeView(node, boxes[node.id], ui));
  return { floors, nodes, wires, ports, labels: [], banners: [], height: y + 8, frame, transform: `translate(${ox}px, ${oy}px) scale(${CLUSTER_SCALE})` };
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- test/unit/webview/layout.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/webview/layout.ts test/unit/webview/layout.test.ts
git commit -m "feat: port the floors and second layer layout from the mockup"
```

---

### Task 10: Panel content (#10)

**Files:**
- Create: `src/webview/panelModel.ts`
- Test: `test/unit/webview/panelModel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildViewData } from "../../../src/graph/neighbourhood";
import { answerFor, panelFor } from "../../../src/webview/panelModel";
import { DOCUMENT_SERVICE, serviceGraph } from "../helpers/fixtures";

const view = () => buildViewData(serviceGraph(), DOCUMENT_SERVICE);
const CONTROLLER = "src/api/controllers/DocumentController.ts";

describe("panel content", () => {
  it("summarises the open file's connections", () => {
    const model = panelFor(view(), DOCUMENT_SERVICE);
    expect(model).toMatchObject({ rel: "Open file", color: "green", canOpen: false, connectionsTitle: "Connections" });
    expect(model.connections).toContainEqual({ label: "used by", value: "DocumentController.ts, SendReminderJob.ts" });
    expect(model.connections).toContainEqual({ label: "missing", value: "IDocumentService.ts" });
  });

  it("shows where a caller uses the open file", () => {
    const model = panelFor(view(), CONTROLLER);
    expect(model).toMatchObject({ rel: "Imports the open file", connectionsTitle: "Where it uses DocumentService.ts", canOpen: true });
    expect(model.connections).toContainEqual({ label: "DocumentController.ts:27", value: "return this.service.listForEmployee(actor, id)" });
  });

  it("answers Why with importers and git history, and Checks with the rule results", () => {
    const git = [{ label: "3 weeks ago", value: "add remindUnsigned" }];
    expect(answerFor(view(), DOCUMENT_SERVICE, "why", git)).toEqual([
      { label: "Imported by", value: "DocumentController.ts, SendReminderJob.ts" },
      ...git,
    ]);
    expect(answerFor(view(), DOCUMENT_SERVICE, "checks", [])).toContainEqual({
      label: "Missing",
      value: "IDocumentService.ts: 4 of 4 files in src/services have a matching interface file.",
    });
    expect(answerFor(view(), "src/db/schema.ts", "checks", [])).toEqual([{ label: "Result", value: "No differences found against the files in the same folder." }]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- test/unit/webview/panelModel.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/webview/panelModel.ts`**

```ts
import type { Fact, NodeKind, ViewData, ViewNode } from "../shared/viewData";
import { colorOf } from "./layout";

export type Action = "context" | "why" | "where" | "checks";

export interface PanelModel {
  id: string;
  name: string;
  path: string;
  rel: string;
  color: string;
  facts: Fact[];
  connectionsTitle: string;
  connections: Fact[];
  canOpen: boolean;
}

const REL: Record<NodeKind, string> = {
  here: "Open file",
  caller: "Imports the open file",
  dependency: "Imported by the open file",
  types: "Types imported by the open file",
  test: "Tests the open file",
  subject: "Tested by the open file",
  expected: "Expected, not found",
  cycle: "Circular import",
  package: "External package",
};

const findNode = (view: ViewData, id: string): ViewNode => view.nodes.find((node) => node.id === id) ?? view.nodes.find((node) => node.id === view.openFile)!;

const namesOf = (view: ViewData, kinds: NodeKind[]) =>
  view.nodes.filter((node) => !node.secondLayer && kinds.includes(node.kind)).map((node) => node.name).join(", ");

function connectionsOf(view: ViewData, node: ViewNode): Fact[] {
  if (node.kind === "here") {
    return [
      { label: "uses", value: namesOf(view, ["dependency", "types", "subject", "cycle"]) },
      { label: "packages", value: namesOf(view, ["package"]) },
      { label: "used by", value: namesOf(view, ["caller", "cycle"]) },
      { label: "tested by", value: namesOf(view, ["test"]) },
      { label: "missing", value: namesOf(view, ["expected"]) },
    ].filter((fact) => fact.value);
  }
  if (node.secondLayer) return [{ label: "via", value: node.via.map((id) => findNode(view, id).name).join(", ") }];
  if (node.kind === "expected") return node.checks;
  if (node.kind === "caller" || node.kind === "test") return node.callSites.map((site) => ({ label: `${node.name}:${site.line}`, value: site.text }));
  return node.usageInOpenFile.map((site) => ({ label: `:${site.line}`, value: site.text }));
}

function titleFor(node: ViewNode, openName: string): string {
  if (node.kind === "here") return "Connections";
  if (node.secondLayer) return "How it connects";
  if (node.kind === "expected") return "Why it is expected";
  if (node.kind === "caller" || node.kind === "test") return `Where it uses ${openName}`;
  return `Where ${openName} uses it`;
}

export function panelFor(view: ViewData, id: string): PanelModel {
  const node = findNode(view, id);
  const openName = findNode(view, view.openFile).name;
  return {
    id: node.id,
    name: node.name,
    path: node.kind === "package" ? "npm package" : node.dir ? `${node.dir}/${node.name}` : node.name,
    rel: node.secondLayer ? "Second layer" : REL[node.kind],
    color: colorOf(node),
    facts: node.kind === "here" ? node.facts : [...node.facts, ...node.checks],
    connectionsTitle: titleFor(node, openName),
    connections: connectionsOf(view, node),
    canOpen: node.id !== view.openFile && node.kind !== "package" && node.kind !== "expected",
  };
}

export function answerFor(view: ViewData, id: string, action: Action, git: Fact[] = []): Fact[] {
  const node = findNode(view, id);
  const model = panelFor(view, id);
  if (action === "context") return model.facts.slice(0, 5);
  if (action === "where") return [{ label: "Defined in", value: model.path }, ...model.connections];
  if (action === "why") {
    const importedBy = node.kind === "here"
      ? { label: "Imported by", value: namesOf(view, ["caller", "cycle"]) || "no files" }
      : node.facts.find((fact) => fact.label === "Imported by");
    const history = git.length ? git : [{ label: "Git history", value: "No commits found for this file." }];
    return [...(importedBy ? [importedBy] : []), ...history];
  }
  return node.checks.length ? node.checks : [{ label: "Result", value: "No differences found against the files in the same folder." }];
}
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: PASS, every test file.

- [ ] **Step 5: Commit**

```bash
git add src/webview/panelModel.ts test/unit/webview/panelModel.test.ts
git commit -m "feat: build the panel facts, connections and answers"
```

---

### Task 11: Webview rendering, styles and animation (#11)

No unit tests: this is presentation code. Task 15 checks it against the canvas.

**Files:**
- Create: `src/webview/render.ts`, `src/webview/main.ts` (replace placeholder), `src/webview/styles.css` (replace placeholder)

- [ ] **Step 1: Create `src/webview/render.ts`**

```ts
import type { Fact, ViewData } from "../shared/viewData";
import type { BannerView, FloorView, LabelView, LayerView, Layout, NodeView, PortView, SecondLayerView, UiState, WireView } from "./layout";
import type { Action, PanelModel } from "./panelModel";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value: string) => value.replace(/[&<>"']/g, (character) => ESCAPES[character]);

const ASKS: { action: Action; label: string; icon: string }[] = [
  { action: "context", label: "Context", icon: '<path d="M12 3 3 8l9 5 9-5-9-5z"></path><path d="m3 13 9 5 9-5"></path>' },
  { action: "why", label: "Why", icon: '<circle cx="12" cy="12" r="9"></circle><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"></path><path d="M12 17h.01"></path>' },
  { action: "where", label: "Where", icon: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"></path><circle cx="12" cy="10" r="2.5"></circle>' },
  { action: "checks", label: "Checks", icon: '<path d="M20 6 9 17l-5-5"></path>' },
];

const LEGEND = `<div class="legend">
<span class="green"><span class="lsw"></span>Open file</span>
<span class="blue"><span class="lsw"></span>Imports this file</span>
<span class="violet"><span class="lsw"></span>Imported by this file</span>
<span class="pink"><span class="lsw"></span>Tests</span>
<span class="violet"><span class="lsw dash"></span>Expected, not found</span>
<span class="red"><span class="lsw dash"></span>Circular import</span>
<span class="grey"><span class="lsw"></span>Package</span>
</div>`;

const immediateCount = (view: ViewData) => view.nodes.filter((node) => !node.secondLayer && node.kind !== "here" && node.kind !== "expected").length;

function countLabel(view: ViewData): string {
  if (view.scan) return `Reading the workspace: ${view.scan.done} of ${view.scan.total} files`;
  const second = view.nodes.filter((node) => node.secondLayer).length;
  return `Immediate layer: ${immediateCount(view)} files. ${second ? `Second layer: ${second} files.` : "No second layer."}`;
}

const renderFloor = (floor: FloorView) =>
  `<div class="fl ${floor.cls}" style="top:${floor.y}px;height:${floor.h}px">${floor.emptyText ? `<span class="phtext">${esc(floor.emptyText)}</span>` : ""}</div>`;
const renderFloorHeader = (floor: FloorView) =>
  `<div class="flh ${floor.cls}" style="top:${floor.y + 9}px"><span class="ti">${esc(floor.title)}</span><span class="fp">${esc(floor.path)}</span></div>`;
const renderWires = (wires: WireView[]) => `<svg class="wires" aria-hidden="true">${wires.map((wire) => `<path class="w ${wire.cls}" d="${wire.d}"></path>`).join("")}</svg>`;
const renderNode = (node: NodeView) =>
  `<button class="nd ${node.cls}" style="left:${node.x}px;top:${node.y}px;width:${node.w}px" data-action="select" data-id="${esc(node.id)}" title="${esc(node.id)}"><span class="nh"><span class="sw"></span>${esc(node.tag)}</span><span class="nn">${esc(node.name)}</span><span class="np">${esc(node.path)}</span></button>`;
const renderPort = (port: PortView) => `<span class="port ${port.cls}${port.incoming ? " in" : ""}" style="left:${port.x}px;top:${port.y}px"></span>`;
const renderLabel = (label: LabelView) => `<span class="wl ${label.cls}" style="left:${label.x}px;top:${label.y}px">${esc(label.text)}</span>`;
const renderToggles = (floors: FloorView[]) =>
  floors
    .filter((floor) => floor.toggle)
    .map((floor) => `<button class="ftog" style="top:${floor.toggle!.y}px" data-action="toggle" data-value="${floor.key}"><span class="ftic ${floor.toggle!.icon}"></span>${esc(floor.toggle!.text)}</button>`)
    .join("");
const factList = (facts: Fact[]) => `<ul class="facts">${facts.map((fact) => `<li><span class="fk">${esc(fact.label)}</span><span class="fv">${esc(fact.value)}</span></li>`).join("")}</ul>`;

function renderBanner(banner: BannerView): string {
  const bar = banner.progress === null ? "" : `<div class="bar"><span style="width:${banner.progress}%"></span></div>`;
  const items = banner.items.map((item) => `<li><span class="ck">${esc(item.label)}</span><span>${esc(item.value)}</span></li>`).join("");
  return `<div class="banner" style="top:${banner.y}px"><h4>${esc(banner.title)}</h4>${bar}<ul>${items}</ul></div>`;
}

function renderLayer(layer: LayerView): string {
  return [
    layer.floors.map(renderFloor).join(""),
    layer.banners.map(renderBanner).join(""),
    renderWires(layer.wires),
    layer.floors.map(renderFloorHeader).join(""),
    layer.nodes.map(renderNode).join(""),
    layer.ports.map(renderPort).join(""),
    layer.labels.map(renderLabel).join(""),
    renderToggles(layer.floors),
  ].join("");
}

function renderOuterBack(outer: SecondLayerView, fileName: string, count: number): string {
  const { frame } = outer;
  return `<div class="layer2">${outer.floors.map(renderFloor).join("")}${outer.floors.map(renderFloorHeader).join("")}
<div class="frame" style="left:${frame.x}px;top:${frame.y}px;width:${frame.w}px;height:${frame.h}px"></div>
<button class="framelabel" style="top:${frame.y}px" data-action="layer" data-value="1"><span class="fk1">${esc(fileName)}</span><span class="fk2">and its immediate layer: ${count} files</span><span class="fk3">Show immediate layer only</span></button>
${renderWires(outer.wires)}</div>`;
}

export function renderMap(result: Layout, view: ViewData, ui: UiState): string {
  const open = view.nodes.find((node) => node.id === view.openFile)!;
  const { inner, outer } = result;
  return `<div class="toolbar">
<div class="crumb"><span class="k">Open file</span><span class="mono">${esc(open.dir || ".")}</span><span>/</span><b class="mono">${esc(open.name)}</b></div>
<div class="seg" role="group" aria-label="Layers to show">
<button class="${ui.layer === 1 ? "on" : ""}" data-action="layer" data-value="1">Immediate layer</button>
<button class="${ui.layer === 2 ? "on" : ""}" data-action="layer" data-value="2">Second layer</button>
</div>
<div class="count">${esc(countLabel(view))}</div>
</div>
<div class="ne"><div class="fit"><div class="cv" style="height:${outer ? outer.height : inner.height}px">
${outer ? renderOuterBack(outer, open.name, immediateCount(view)) : ""}
<div class="cluster" style="height:${inner.height}px">${renderLayer(inner)}</div>
${outer ? `<div class="layer2 late">${outer.nodes.map(renderNode).join("")}${outer.ports.map(renderPort).join("")}${renderToggles(outer.floors)}</div>` : ""}
${ui.layer === 2 && !outer ? `<div class="nolayer">No second layer. Nothing is connected beyond the immediate layer.</div>` : ""}
</div></div></div>
${LEGEND}`;
}

export function renderPanel(model: PanelModel, action: Action | null, answer: Fact[] | null): string {
  const connections = model.connections.length
    ? model.connections.map((connection) => `<div class="lk"><span class="ref">${esc(connection.label)}</span><span class="lt">${esc(connection.value)}</span></div>`).join("")
    : `<div class="lt">None</div>`;
  const asks = ASKS.map(
    (ask) => `<button class="ask ${ask.action === action ? "on" : ""}" data-action="ask" data-value="${ask.action}"><svg viewBox="0 0 24 24" aria-hidden="true">${ask.icon}</svg>${ask.label}</button>`,
  ).join("");
  const answerLabel = ASKS.find((ask) => ask.action === action)?.label ?? "";
  const answerBlock = action && answer
    ? `<div class="answer"><div class="ah"><span>${esc(answerLabel)}: ${esc(model.name)}</span><span class="src-tag">From code</span></div>${factList(answer)}</div>`
    : "";
  return `<div class="pcard">
<div class="kickrow"><span class="chip ${model.color}">${esc(model.rel)}</span></div>
<h2 class="title">${esc(model.name)}</h2>
<div class="path">${esc(model.path)}</div>
${model.canOpen ? `<button class="openbtn" data-action="open" data-id="${esc(model.id)}">Open file</button>` : ""}
</div>
<section><div class="sechead"><h3 class="label">What it does</h3><span class="src-tag">From code</span></div>${factList(model.facts)}</section>
<section><div class="sechead"><h3 class="label">${esc(model.connectionsTitle)}</h3><span class="src-tag">From code</span></div><div class="links">${connections}</div></section>
<section><h3 class="label">More about this file</h3><div class="asks">${asks}</div>${answerBlock}</section>`;
}
```

- [ ] **Step 2: Replace `src/webview/main.ts`**

```ts
import type { HostMessage, WebviewMessage } from "../shared/messages";
import type { Fact, ViewData } from "../shared/viewData";
import { CANVAS_W, layout, type UiState } from "./layout";
import { answerFor, panelFor, type Action } from "./panelModel";
import { renderMap, renderPanel } from "./render";

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void };

const vscode = acquireVsCodeApi();
const IDENTITY = "translate(0px, 0px) scale(1)";
let view: ViewData | null = null;
let ui: UiState = { selected: "", layer: 1, open: {} };
let action: Action | null = null;
let lastTransform = IDENTITY;
const git = new Map<string, Fact[]>();

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === "view") {
    const openFileChanged = view?.openFile !== message.data.openFile;
    view = message.data;
    if (openFileChanged) {
      ui = { selected: view.openFile, layer: 1, open: {} };
      action = null;
      lastTransform = IDENTITY;
    }
  }
  if (message.type === "git") git.set(message.id, message.facts);
  render();
});

document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!target || !view) return;
  const { action: kind, id, value } = target.dataset;
  if (kind === "select" && id) {
    ui = { ...ui, selected: id };
    vscode.postMessage({ type: "select", id });
  }
  if (kind === "toggle" && value) ui = { ...ui, open: { ...ui.open, [value]: !ui.open[value] } };
  if (kind === "layer" && value) ui = { ...ui, layer: value === "2" ? 2 : 1 };
  if (kind === "ask" && value) action = action === value ? null : (value as Action);
  if (kind === "open" && id) vscode.postMessage({ type: "open", id });
  render();
});

document.addEventListener("dblclick", (event) => {
  const node = (event.target as HTMLElement).closest<HTMLElement>('[data-action="select"]');
  if (node?.dataset.id) vscode.postMessage({ type: "open", id: node.dataset.id });
});

function render(): void {
  if (!view) return;
  const result = layout(view, ui);
  document.getElementById("map")!.innerHTML = renderMap(result, view, ui);
  const nextTransform = result.outer ? result.outer.transform : IDENTITY;
  const cluster = document.querySelector<HTMLElement>(".cluster");
  if (cluster) {
    // the new element starts at the previous transform so the CSS transition animates the change
    cluster.style.transform = lastTransform;
    requestAnimationFrame(() => requestAnimationFrame(() => (cluster.style.transform = nextTransform)));
  }
  lastTransform = nextTransform;
  const facts = git.get(ui.selected) ?? [];
  const answer = action ? answerFor(view, ui.selected, action, facts) : null;
  document.getElementById("panel")!.innerHTML = renderPanel(panelFor(view, ui.selected), action, answer);
  fitMap();
}

function fitMap(): void {
  const box = document.querySelector<HTMLElement>(".fit");
  const canvas = document.querySelector<HTMLElement>(".cv");
  if (!box || !canvas) return;
  const scale = Math.min(1, box.clientWidth / CANVAS_W);
  canvas.style.transform = `scale(${scale})`;
  box.style.height = `${canvas.offsetHeight * scale}px`;
}

new ResizeObserver(fitMap).observe(document.body);
vscode.postMessage({ type: "ready" });
```

The comment in `render` is allowed under the comment rules (case 4): without it, a reviewer would remove the two-step transform as redundant.

- [ ] **Step 3: Replace `src/webview/styles.css`**

Values come from `docs/design/wayfinder-mockup.dc.html`. Fonts use VS Code's fonts.

```css
body { margin: 0; padding: 0; font-family: var(--vscode-font-family, system-ui, sans-serif); font-size: 13px; }
.app {
  --bg: #0E1116; --bg2: #0B0E12; --panel: #151A21; --raise: #1A2029; --node: #232A35; --nodehead: #1B212A;
  --floor: #181E27; --floormine: #1C2430; --l1: #232A34; --l2: #2C343F; --l3: #3A4452; --l4: #4D5866;
  --text: #E7EAEE; --strong: #F2F4F7; --text2: #C3CAD3; --muted: #98A2AE; --faint: #7F8996; --ghosttext: #C9BCF9; --green: #5DD68A;
  --mono: var(--vscode-editor-font-family, ui-monospace, Menlo, monospace);
  display: grid; grid-template-columns: minmax(0, 1fr) 360px; height: 100vh; background: var(--bg); color: var(--text);
}
body.vscode-light .app {
  --bg: #F5F6F8; --bg2: #ECEFF3; --panel: #FFFFFF; --raise: #F0F2F5; --node: #FFFFFF; --nodehead: #F5F7F9;
  --floor: #E6EAF0; --floormine: #DDE6E0; --l1: #E2E6EB; --l2: #D3D9E0; --l3: #BFC7D1; --l4: #9AA4B1;
  --text: #1B2230; --strong: #0E1116; --text2: #3D4654; --muted: #5B6573; --faint: #6F7986; --ghosttext: #5B3FC4; --green: #17924B;
}
.blue { --c: #4C93EA; } .violet { --c: #A68BF5; } .pink { --c: #EE7FB0; } .green { --c: #5DD68A; } .red { --c: #F26D6D; } .grey { --c: #98A2AE; }
body.vscode-light .blue { --c: #2F6FD0; } body.vscode-light .violet { --c: #6E52DB; } body.vscode-light .pink { --c: #C93F78; }
body.vscode-light .green { --c: #17924B; } body.vscode-light .red { --c: #D23A3A; } body.vscode-light .grey { --c: #6B7584; }
.mono { font-family: var(--mono); }
@media (max-width: 900px) { .app { grid-template-columns: 1fr; height: auto; } .panel { border-left: 0; border-top: 1px solid var(--l1); } }

.map { position: relative; display: flex; flex-direction: column; min-width: 0; height: 100%; overflow: hidden; }
.toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--l1); background: var(--bg2); }
.crumb { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); }
.crumb .k { font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #0E1116; background: var(--green); border-radius: 4px; padding: 3px 7px 2px; }
.crumb b { color: var(--strong); font-weight: 600; }
.seg { display: flex; gap: 2px; background: var(--raise); border: 1px solid var(--l2); border-radius: 8px; padding: 3px; }
.seg button { font: inherit; font-size: 12px; font-weight: 600; color: var(--muted); background: none; border: 0; border-radius: 6px; padding: 6px 11px 5px; cursor: pointer; }
.seg button.on { background: var(--strong); color: var(--bg); }
.count { margin-left: auto; font-size: 12px; color: var(--text2); }
.ne { flex: 1; overflow: auto; padding-bottom: 44px; }
.fit { position: relative; overflow: hidden; }
.cv { position: relative; width: 800px; transform-origin: 0 0; }
.legend { position: absolute; left: 16px; bottom: 12px; display: flex; flex-wrap: wrap; gap: 12px; font-size: 11.5px; color: var(--text2); background: var(--bg); }
.legend span { display: flex; align-items: center; gap: 6px; }
.lsw { width: 10px; height: 10px; border-radius: 3px; background: var(--c); display: block; }
.lsw.dash { background: transparent; border: 1.5px dashed var(--c); box-sizing: border-box; width: 12px; height: 12px; }

.fl { position: absolute; left: 16px; width: 768px; box-sizing: border-box; border: 1px solid var(--l1); border-radius: 14px; background: var(--floor); }
.fl.mine { border-color: var(--l3); background: var(--floormine); }
.fl.annex, .fl.empty { border-style: dashed; }
.fl.empty { background: transparent; }
.phtext { position: absolute; left: 0; right: 0; bottom: 12px; text-align: center; color: var(--muted); font-size: 12.5px; }
.flh { position: absolute; left: 30px; display: flex; align-items: baseline; gap: 8px; white-space: nowrap; padding: 0 8px 2px 0; background: var(--floor); border-radius: 6px; }
.flh.mine { background: var(--floormine); }
.flh.empty { background: var(--bg); }
.flh .ti { font-size: 12px; font-weight: 700; color: var(--text); }
.flh .fp { font-family: var(--mono); font-size: 10.5px; color: var(--muted); }
.wires { position: absolute; left: 0; top: 0; width: 800px; height: 100%; overflow: visible; fill: none; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.w { stroke: var(--c); stroke-width: 2.4; transition: opacity .25s, stroke-width .25s; }
.w.dashed { stroke-dasharray: 5 6; }
.w.lo { opacity: .3; }
.w.hi { opacity: 1; stroke-width: 3.4; stroke-dasharray: 7 7; animation: flow .9s linear infinite; filter: drop-shadow(0 0 3px var(--c)); }
@keyframes flow { to { stroke-dashoffset: -14; } }
.wl { position: absolute; transform: translate(-50%, -50%); font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; color: var(--c); background: var(--bg); border: 1px dashed var(--c); border-radius: 999px; padding: 3px 8px 2px; }
.port { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; box-sizing: border-box; border-radius: 50%; background: var(--c); border: 2px solid var(--bg); pointer-events: none; }
.port.in { background: var(--bg); border-color: var(--c); }

.nd { position: absolute; height: 56px; box-sizing: border-box; display: flex; flex-direction: column; align-items: stretch; background: var(--node); border: 1px solid var(--l3); border-radius: 7px; padding: 0; overflow: hidden; cursor: pointer; font: inherit; color: inherit; text-align: left; box-shadow: 0 6px 16px rgba(0, 0, 0, .35); animation: pop .35s ease-out both; }
body.vscode-light .nd { box-shadow: 0 2px 8px rgba(20, 30, 50, .10); }
@keyframes pop { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.nd .nh { display: flex; align-items: center; gap: 6px; height: 18px; flex: none; padding: 0 8px; background: var(--nodehead); border-bottom: 1px solid var(--l2); font-size: 9.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--c); white-space: nowrap; }
.nd .sw { width: 7px; height: 7px; border-radius: 50%; background: var(--c); flex: none; }
.nd .nn { padding: 6px 8px 0; font-size: 12px; font-weight: 600; line-height: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nd .np { padding: 1px 8px 0; font-family: var(--mono); font-size: 10px; line-height: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nd:hover { border-color: var(--l4); }
.nd:focus-visible { outline: 2px solid var(--strong); outline-offset: 2px; }
.nd.sel { border-color: var(--c); box-shadow: 0 0 0 3px color-mix(in oklab, var(--c) 30%, transparent), 0 6px 16px rgba(0, 0, 0, .35); }
.nd.sel .nn { color: var(--c); }
.nd.two { border-style: dashed; }
.nd.two .nn { font-weight: 400; color: var(--text2); }
.nd.ghost { background: var(--bg); border: 1.5px dashed var(--c); box-shadow: none; }
.nd.ghost .nh { background: transparent; border-bottom: 1px dashed var(--l3); }
.nd.ghost .nn { color: var(--ghosttext); }
.nd.here { height: 64px; border: 2px solid var(--green); }
.nd.here .nh { color: #0E1116; background: var(--green); height: 20px; letter-spacing: .14em; }
.nd.here .nn { font-size: 15px; line-height: 18px; padding-top: 7px; color: var(--strong); }
.nd.here.sel { box-shadow: 0 0 0 5px rgba(93, 214, 138, .22), 0 6px 16px rgba(0, 0, 0, .35); }

.ftog { position: absolute; left: 30px; display: inline-flex; align-items: center; gap: 7px; height: 22px; padding: 0 10px 0 4px; font: inherit; font-size: 11.5px; font-weight: 600; color: var(--text2); background: var(--raise); border: 1px solid var(--l3); border-radius: 999px; cursor: pointer; }
.ftog:hover { color: var(--strong); border-color: var(--l4); }
.ftic { position: relative; width: 16px; height: 16px; border-radius: 50%; background: var(--l2); }
.ftic::before, .ftic::after { content: ""; position: absolute; left: 4px; top: 7.25px; width: 8px; height: 1.5px; border-radius: 1px; background: var(--strong); }
.ftic.plus::after { transform: rotate(90deg); }
.ftic.minus::after { display: none; }

.banner { position: absolute; left: 16px; width: 768px; box-sizing: border-box; border: 1px dashed var(--l3); border-radius: 14px; background: var(--bg); padding: 16px 18px 14px; }
.banner h4 { margin: 0 0 8px; font-size: 14px; font-weight: 700; color: var(--strong); }
.banner ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.banner li { display: flex; gap: 10px; font-size: 12.5px; line-height: 17px; color: var(--text2); }
.banner .ck { flex: none; font-family: var(--mono); font-size: 10.5px; color: #0E1116; background: var(--muted); border-radius: 4px; padding: 1px 6px 0; height: 16px; }
.bar { height: 6px; border-radius: 999px; background: var(--l1); overflow: hidden; margin: 4px 0 10px; }
.bar span { display: block; height: 100%; background: #4C93EA; border-radius: 999px; }

.cluster { position: absolute; left: 0; top: 0; width: 800px; transform-origin: 0 0; transition: transform .6s cubic-bezier(.2, .7, .2, 1); }
.layer2 { animation: fade .45s ease-out .25s both; }
.layer2.late { animation-delay: .45s; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
.frame { position: absolute; border: 1.5px solid var(--green); border-radius: 18px; box-shadow: 0 0 0 6px rgba(93, 214, 138, .08); pointer-events: none; }
.framelabel { position: absolute; left: 16px; width: 136px; display: flex; flex-direction: column; gap: 3px; text-align: left; background: none; border: 0; padding: 0; cursor: pointer; font: inherit; color: inherit; }
.framelabel .fk1 { font-size: 12.5px; font-weight: 700; color: var(--green); overflow-wrap: anywhere; }
.framelabel .fk2 { font-size: 11.5px; line-height: 15px; color: var(--text2); }
.framelabel .fk3 { margin-top: 6px; font-size: 11.5px; font-weight: 600; color: var(--strong); text-decoration: underline; text-underline-offset: 3px; }
.nolayer { position: absolute; left: 16px; right: 16px; bottom: 16px; text-align: center; font-size: 12.5px; color: var(--muted); border: 1px dashed var(--l3); border-radius: 12px; padding: 12px; }

.panel { background: var(--panel); border-left: 1px solid var(--l1); padding: 20px; display: flex; flex-direction: column; gap: 22px; overflow-y: auto; }
.kickrow { margin-bottom: 10px; }
.chip { font-size: 10.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--c); background: color-mix(in oklab, var(--c) 15%, transparent); border-radius: 4px; padding: 4px 8px 3px; }
.title { margin: 0; font-size: 20px; line-height: 26px; font-weight: 700; overflow-wrap: anywhere; color: var(--strong); }
.path { font-family: var(--mono); font-size: 11.5px; color: var(--muted); margin-top: 4px; }
.openbtn { margin-top: 12px; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--strong); background: var(--raise); border: 1px solid var(--l3); border-radius: 8px; padding: 7px 12px 6px; cursor: pointer; }
.sechead { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.label { margin: 0 0 10px; font-size: 10.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.sechead .label { margin: 0; }
.src-tag { flex: none; font-size: 9.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text2); border: 1px solid var(--l3); border-radius: 4px; padding: 2px 5px 1px; }
.facts { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 7px; }
.facts li { display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: 10px; font-size: 13px; line-height: 18px; }
.facts .fk { font-size: 11.5px; color: var(--muted); }
.facts .fv { color: var(--text2); overflow-wrap: anywhere; }
.links { display: flex; flex-direction: column; gap: 6px; }
.lk { display: flex; gap: 10px; align-items: baseline; font-size: 13px; line-height: 18px; }
.ref { font-family: var(--mono); font-size: 11.5px; color: var(--strong); background: var(--l1); border-radius: 4px; padding: 2px 6px 1px; white-space: nowrap; }
.lt { color: var(--text2); overflow-wrap: anywhere; }
.asks { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.ask { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 58px; background: var(--raise); border: 1px solid var(--l2); border-radius: 10px; color: var(--text2); font: inherit; font-size: 11.5px; font-weight: 600; line-height: 13px; cursor: pointer; padding: 8px 4px 6px; }
.ask svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.ask:hover { border-color: var(--l3); color: var(--strong); }
.ask.on { background: var(--strong); border-color: var(--strong); color: var(--bg); }
.answer { margin-top: 10px; background: var(--bg); border: 1px solid var(--l2); border-radius: 10px; padding: 14px 16px 12px; }
.ah { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 600; color: var(--strong); margin-bottom: 8px; }
button:focus-visible { outline: 2px solid var(--strong); outline-offset: 2px; }
```

- [ ] **Step 4: Build and type-check**

```bash
npm run build && npm run typecheck
```

Expected: three output files, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/webview
git commit -m "feat: render the map and panel in the webview"
```

---

### Task 12: Workspace index (#12)

**Files:**
- Create: `src/workspace/WorkspaceIndex.ts`

No unit test: every line calls the VS Code API. Task 15 checks it.

`findFiles` gets no exclude argument, so the user's `files.exclude` setting applies. `SKIPPED` removes build and dependency folders on top of that.

- [ ] **Step 1: Create `src/workspace/WorkspaceIndex.ts`**

```ts
import * as path from "node:path";
import ts from "typescript";
import * as vscode from "vscode";
import { analyzeSource } from "../graph/analyzeSource";
import { createGraph, removeFile, setFile, type RelResolver } from "../graph/buildGraph";
import { createResolver } from "../graph/resolveImport";
import { loadCompilerOptions } from "./loadCompilerOptions";

const SOURCE_GLOB = "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}";
const SKIPPED = /(^|\/)(node_modules|dist|out|build|coverage|\.next|\.git)\//;
const MAX_BYTES = 1_000_000;
const BATCH_SIZE = 50;

export class WorkspaceIndex implements vscode.Disposable {
  readonly graph = createGraph();
  progress: { done: number; total: number } | null = null;
  packageJsonText = "";
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly resolve: RelResolver;
  private readonly watcher: vscode.FileSystemWatcher;
  private scanning: Promise<void> | undefined;

  constructor(readonly root: vscode.Uri) {
    const { options, problems } = loadCompilerOptions(root.fsPath);
    if (problems.length > 0) void vscode.window.showWarningMessage(`Wayfinder: ${problems.join(" ")}`);
    const resolveAbsolute = createResolver(root.fsPath, options, ts.sys);
    this.resolve = (specifier, fromPath) => {
      const result = resolveAbsolute(specifier, path.join(root.fsPath, fromPath));
      if (result.kind !== "file") return result;
      const relative = this.toRelative(result.path);
      return relative ? { kind: "file", path: relative } : { kind: "unresolved" };
    };
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, SOURCE_GLOB));
    this.watcher.onDidChange((uri) => void this.updateFile(uri));
    this.watcher.onDidCreate((uri) => void this.updateFile(uri));
    this.watcher.onDidDelete((uri) => {
      const relative = this.relativePath(uri);
      if (!relative) return;
      removeFile(this.graph, relative);
      this.changed.fire();
    });
  }

  scan(): Promise<void> {
    this.scanning ??= this.scanAll();
    return this.scanning;
  }

  relativePath(uri: vscode.Uri): string | undefined {
    return uri.scheme === "file" ? this.toRelative(uri.fsPath) : undefined;
  }

  uriOf(relativePath: string): vscode.Uri {
    return vscode.Uri.joinPath(this.root, relativePath);
  }

  async updateFile(uri: vscode.Uri, notify = true): Promise<void> {
    const relative = this.relativePath(uri);
    if (!relative || SKIPPED.test(relative)) return;
    const text = await this.readText(uri);
    if (text === undefined) return;
    setFile(this.graph, analyzeSource(relative, text), this.resolve);
    if (notify) this.changed.fire();
  }

  dispose(): void {
    this.watcher.dispose();
    this.changed.dispose();
  }

  private async scanAll(): Promise<void> {
    this.packageJsonText = (await this.readText(vscode.Uri.joinPath(this.root, "package.json"))) ?? "";
    const uris = (await vscode.workspace.findFiles(new vscode.RelativePattern(this.root, SOURCE_GLOB))).filter((uri) => {
      const relative = this.relativePath(uri);
      return !!relative && !SKIPPED.test(relative);
    });
    this.progress = { done: 0, total: uris.length };
    this.changed.fire();
    for (let start = 0; start < uris.length; start += BATCH_SIZE) {
      await Promise.all(uris.slice(start, start + BATCH_SIZE).map((uri) => this.updateFile(uri, false)));
      this.progress = { done: Math.min(start + BATCH_SIZE, uris.length), total: uris.length };
      this.changed.fire();
    }
    this.progress = null;
    this.changed.fire();
  }

  private toRelative(absolutePath: string): string | undefined {
    const relative = path.relative(this.root.fsPath, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    return relative.split(path.sep).join("/");
  }

  private async readText(uri: vscode.Uri): Promise<string | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return bytes.byteLength > MAX_BYTES ? undefined : new TextDecoder().decode(bytes);
    } catch {
      return undefined;
    }
  }
}
```

- [ ] **Step 2: Type-check and commit**

```bash
npm run typecheck
git add src/workspace/WorkspaceIndex.ts
git commit -m "feat: scan and watch the workspace into the import graph"
```

---

### Task 13: Editor marks (#13)

**Files:**
- Create: `src/view/EditorMarks.ts`

Gutter dots use the same colours as the map (dark theme values from `src/webview/styles.css`).

- [ ] **Step 1: Create `src/view/EditorMarks.ts`**

```ts
import * as vscode from "vscode";
import type { NodeKind, ViewData } from "../shared/viewData";

const DOT_COLORS: Record<NodeKind, string> = {
  here: "#5DD68A", caller: "#4C93EA", dependency: "#A68BF5", types: "#A68BF5", test: "#EE7FB0", subject: "#EE7FB0", expected: "#A68BF5", cycle: "#F26D6D", package: "#98A2AE",
};

const dotIcon = (color: string) =>
  vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="4" fill="${color}"/></svg>`)}`);

export class EditorMarks implements vscode.Disposable {
  private readonly dots = new Map<NodeKind, vscode.TextEditorDecorationType>(
    (Object.entries(DOT_COLORS) as [NodeKind, string][]).map(([kind, color]) => [
      kind,
      vscode.window.createTextEditorDecorationType({ gutterIconPath: dotIcon(color), gutterIconSize: "60%" }),
    ]),
  );
  private readonly highlight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
  });

  apply(editor: vscode.TextEditor | undefined, view: ViewData, selected: string): void {
    if (!editor) return;
    const kindOf = new Map(view.nodes.map((node) => [node.id, node.kind]));
    const linesByKind = new Map<NodeKind, number[]>();
    for (const mark of view.lineMarks) {
      const kind = kindOf.get(mark.nodeId);
      if (kind) linesByKind.set(kind, [...(linesByKind.get(kind) ?? []), mark.line]);
    }
    for (const [kind, type] of this.dots) editor.setDecorations(type, this.ranges(editor, linesByKind.get(kind) ?? []));
    const node = view.nodes.find((candidate) => candidate.id === selected);
    const lines = node && selected !== view.openFile ? node.usageInOpenFile.map((site) => site.line) : [];
    editor.setDecorations(this.highlight, this.ranges(editor, lines));
  }

  dispose(): void {
    this.highlight.dispose();
    for (const type of this.dots.values()) type.dispose();
  }

  private ranges(editor: vscode.TextEditor, lines: number[]): vscode.Range[] {
    return lines.filter((line) => line >= 1 && line <= editor.document.lineCount).map((line) => new vscode.Range(line - 1, 0, line - 1, 0));
  }
}
```

- [ ] **Step 2: Type-check and commit**

```bash
npm run typecheck
git add src/view/EditorMarks.ts
git commit -m "feat: mark connection lines in the editor gutter"
```

---

### Task 14: Panel host and command (#14)

**Files:**
- Create: `src/view/WayfinderPanel.ts`
- Modify: `src/extension.ts` (replace the temporary version from Task 1)

- [ ] **Step 1: Create `src/view/WayfinderPanel.ts`**

The map follows the active editor. When focus moves to the map itself, `activeTextEditor` becomes `undefined` and the map keeps the last file.

```ts
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { buildViewData } from "../graph/neighbourhood";
import type { HostMessage, WebviewMessage } from "../shared/messages";
import type { ViewData } from "../shared/viewData";
import { gitHistory } from "../workspace/gitFacts";
import type { WorkspaceIndex } from "../workspace/WorkspaceIndex";
import { EditorMarks } from "./EditorMarks";

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

export class WayfinderPanel implements vscode.Disposable {
  private static current: WayfinderPanel | undefined;
  private readonly marks = new EditorMarks();
  private readonly disposables: vscode.Disposable[] = [];
  private openFile: string | undefined;
  private selected: string | undefined;
  private lastView: ViewData | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;

  static show(context: vscode.ExtensionContext, index: WorkspaceIndex): void {
    if (WayfinderPanel.current) {
      WayfinderPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      WayfinderPanel.current.followEditor(vscode.window.activeTextEditor);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "wayfinder.map",
      "Wayfinder",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out")] },
    );
    WayfinderPanel.current = new WayfinderPanel(panel, context, index);
  }

  private constructor(private readonly panel: vscode.WebviewPanel, context: vscode.ExtensionContext, private readonly index: WorkspaceIndex) {
    panel.webview.html = this.html(context);
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => void this.onMessage(message)),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.followEditor(editor)),
      index.onDidChange(() => this.scheduleRefresh()),
    );
    this.followEditor(vscode.window.activeTextEditor);
  }

  dispose(): void {
    WayfinderPanel.current = undefined;
    clearTimeout(this.refreshTimer);
    this.marks.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }

  private followEditor(editor: vscode.TextEditor | undefined): void {
    const relative = editor ? this.index.relativePath(editor.document.uri) : undefined;
    if (!relative || !SOURCE_FILE.test(relative)) return;
    this.openFile = relative;
    this.selected = relative;
    this.post();
  }

  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.post(), 150);
  }

  private post(): void {
    if (!this.openFile) return;
    this.lastView = buildViewData(this.index.graph, this.openFile, { scan: this.index.progress, packageJsonText: this.index.packageJsonText });
    this.send({ type: "view", data: this.lastView });
    this.marks.apply(this.editorFor(this.openFile), this.lastView, this.selected ?? this.openFile);
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    if (message.type === "ready") this.post();
    if (message.type === "select") {
      this.selected = message.id;
      if (this.openFile && this.lastView) this.marks.apply(this.editorFor(this.openFile), this.lastView, message.id);
      if (!message.id.includes(":")) this.send({ type: "git", id: message.id, facts: await gitHistory(this.index.root.fsPath, message.id) });
    }
    if (message.type === "open" && !message.id.includes(":")) {
      const document = await vscode.workspace.openTextDocument(this.index.uriOf(message.id));
      await vscode.window.showTextDocument(document, { viewColumn: this.editorColumn(), preview: false });
    }
  }

  private send(message: HostMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private editorFor(relativePath: string): vscode.TextEditor | undefined {
    return vscode.window.visibleTextEditors.find((editor) => this.index.relativePath(editor.document.uri) === relativePath);
  }

  private editorColumn(): vscode.ViewColumn {
    return (this.openFile && this.editorFor(this.openFile)?.viewColumn) || vscode.ViewColumn.One;
  }

  private html(context: vscode.ExtensionContext): string {
    const webview = this.panel.webview;
    const asset = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "out", file));
    const nonce = randomBytes(16).toString("base64");
    // node positions are inline style attributes, which need 'unsafe-inline' in style-src
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${asset("webview.css")}">
<title>Wayfinder</title>
</head>
<body>
<div class="app"><main id="map" class="map"></main><aside id="panel" class="panel"></aside></div>
<script nonce="${nonce}" src="${asset("webview.js")}"></script>
</body>
</html>`;
  }
}
```

- [ ] **Step 2: Replace `src/extension.ts`**

```ts
import * as vscode from "vscode";
import { WayfinderPanel } from "./view/WayfinderPanel";
import { WorkspaceIndex } from "./workspace/WorkspaceIndex";

let index: WorkspaceIndex | undefined;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("wayfinder.showMap", () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showInformationMessage("Wayfinder needs an open folder.");
        return;
      }
      if (!index) {
        index = new WorkspaceIndex(folder.uri);
        context.subscriptions.push(index);
        void index.scan();
      }
      WayfinderPanel.show(context, index);
    }),
  );
}

export function deactivate() {}
```

- [ ] **Step 3: Build, type-check, test**

```bash
npm run build && npm run typecheck && npm test
```

Expected: build succeeds, no type errors, all unit tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/view/WayfinderPanel.ts src/extension.ts
git commit -m "feat: open the map beside the editor and follow the active file"
```

---

### Task 15: Sample project and check against the design (#15)

**Files:**
- Create: the files under `test/sample-project/` listed below
- Modify: `README.md`

- [ ] **Step 1: Create the sample project**

Each file is small but has real imports. One import uses the `@/` alias to check `tsconfig` paths.

`test/sample-project/package.json`:
```json
{ "name": "sample-project", "private": true, "scripts": { "backfill": "node scripts/backfill.js" } }
```

`test/sample-project/tsconfig.json`:
```json
{ "compilerOptions": { "strict": true, "baseUrl": ".", "paths": { "@/*": ["src/*"] } }, "include": ["src", "test"] }
```

`test/sample-project/src/services/DocumentService.ts`:
```ts
import { DocumentRepository } from "../db/repositories/DocumentRepository";
import { StorageClient } from "../integrations/storage/StorageClient";
import { PermissionPolicy } from "@/auth/PermissionPolicy";
import type { Document, NewDocument } from "../types/document.types";

export class DocumentService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly storage: StorageClient,
    private readonly permissions: PermissionPolicy,
  ) {}

  async listForEmployee(actorId: string, employeeId: string): Promise<Document[]> {
    await this.permissions.assertCanRead(actorId, employeeId);
    return this.documents.findByEmployee(employeeId);
  }

  async upload(actorId: string, input: NewDocument, file: string): Promise<Document> {
    await this.permissions.assertCanWrite(actorId, input.employeeId);
    const fileKey = await this.storage.put(file);
    return this.documents.save({ ...input, fileKey });
  }
}
```

`test/sample-project/src/services/EmployeeService.ts` (circular import with ContractService):
```ts
import type { IEmployeeService } from "./IEmployeeService";
import { ContractService } from "./ContractService";
import { formatDate } from "../utils/formatDate";

export class EmployeeService implements IEmployeeService {
  constructor(private readonly contracts: ContractService) {}
  offboard(id: string, endDate: Date) {
    return this.contracts.endAll(id, formatDate(endDate));
  }
}
```

`test/sample-project/src/services/ContractService.ts`:
```ts
import type { IContractService } from "./IContractService";
import { EmployeeService } from "./EmployeeService";
import { formatDate } from "../utils/formatDate";

export class ContractService implements IContractService {
  employees?: EmployeeService;
  endAll(id: string, endDate: string) {
    return `${id} ends ${endDate} ${formatDate(new Date())}`;
  }
}
```

`test/sample-project/src/services/LeaveService.ts` and `PayrollService.ts` (same shape, replace `Leave` with `Payroll` in the second file):
```ts
import type { ILeaveService } from "./ILeaveService";
import { formatDate } from "../utils/formatDate";

export class LeaveService implements ILeaveService {
  describe(start: Date) {
    return formatDate(start);
  }
}
```

`test/sample-project/src/services/IEmployeeService.ts`, `IContractService.ts`, `ILeaveService.ts`, `IPayrollService.ts` (same shape, one per name):
```ts
export interface IEmployeeService {}
```

`test/sample-project/src/api/controllers/DocumentController.ts`:
```ts
import { DocumentService } from "../../services/DocumentService";
import { formatDate } from "../../utils/formatDate";

export class DocumentController {
  constructor(private readonly service: DocumentService) {}
  list(actorId: string, employeeId: string) {
    return this.service.listForEmployee(actorId, employeeId).then((documents) => ({ documents, at: formatDate(new Date()) }));
  }
}
```

`test/sample-project/src/jobs/SendReminderJob.ts`:
```ts
import { DocumentService } from "../services/DocumentService";
import { formatDate } from "../utils/formatDate";

export class SendReminderJob {
  constructor(private readonly service: DocumentService) {}
  run() {
    return `${formatDate(new Date())} ${typeof this.service}`;
  }
}
```

`test/sample-project/src/api/routes.ts`:
```ts
import { DocumentController } from "./controllers/DocumentController";

export const routes = { documents: DocumentController };
```

`test/sample-project/src/jobs/scheduler.ts`:
```ts
import { SendReminderJob } from "./SendReminderJob";

export const jobs = [SendReminderJob];
```

`test/sample-project/src/db/repositories/DocumentRepository.ts`:
```ts
import { documentsTable } from "../schema";
import type { Document, NewDocument } from "../../types/document.types";

export class DocumentRepository {
  async findByEmployee(employeeId: string): Promise<Document[]> {
    return [{ id: documentsTable, employeeId, fileKey: "" }];
  }
  async save(input: NewDocument & { fileKey: string }): Promise<Document> {
    return { id: "1", ...input };
  }
}
```

`test/sample-project/src/db/schema.ts`:
```ts
export const documentsTable = "documents";
```

`test/sample-project/src/integrations/storage/StorageClient.ts`:
```ts
import { bucket } from "../../config/storage.config";

export class StorageClient {
  async put(file: string) {
    return `${bucket}/${file}`;
  }
}
```

`test/sample-project/src/config/storage.config.ts`:
```ts
export const bucket = "documents-bucket";
```

`test/sample-project/src/auth/PermissionPolicy.ts`:
```ts
import { roles } from "./roles";

export class PermissionPolicy {
  async assertCanRead(actorId: string, employeeId: string) {
    if (!roles.length) throw new Error(`${actorId} cannot read ${employeeId}`);
  }
  async assertCanWrite(actorId: string, employeeId: string) {
    if (!roles.length) throw new Error(`${actorId} cannot write ${employeeId}`);
  }
}
```

`test/sample-project/src/auth/roles.ts`:
```ts
export const roles = ["Admin", "HR", "Manager", "Employee"];
```

`test/sample-project/src/types/document.types.ts`:
```ts
export interface NewDocument { employeeId: string; }
export interface Document extends NewDocument { id: string; fileKey: string; }
```

`test/sample-project/src/utils/formatDate.ts`:
```ts
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
```

`test/sample-project/src/utils/currency.ts` (nothing imports it):
```ts
const RATES: Record<string, number> = { NOK: 1, SEK: 0.98, EUR: 11.6 };

export function toNok(amount: number, currency: string): number {
  return amount * (RATES[currency] ?? 1);
}
```

`test/sample-project/test/services/DocumentService.spec.ts`, and the same shape for `EmployeeService.spec.ts`, `ContractService.spec.ts`, `LeaveService.spec.ts`, `PayrollService.spec.ts`:
```ts
import { DocumentService } from "../../src/services/DocumentService";
import { buildDocument } from "../fixtures/documents.fixture";

export const subject = [DocumentService, buildDocument];
```

For the four other specs, drop the fixture import and import the matching service instead of `DocumentService`.

`test/sample-project/test/fixtures/documents.fixture.ts`:
```ts
export const buildDocument = () => ({ id: "1", employeeId: "e1", fileKey: "k" });
```

- [ ] **Step 2: Run the extension**

Press F5 in VS Code (launch config "Run Extension"). The Extension Development Host opens `test/sample-project`. Open `src/services/DocumentService.ts`, then click the map button in the editor title bar.

- [ ] **Step 3: Check each case against the canvas**

Open the canvas board named in each row and compare.

| Open this file | Expected result | Canvas board |
|---|---|---|
| `src/services/DocumentService.ts` | Callers DocumentController and SendReminderJob. Dependencies DocumentRepository, StorageClient, PermissionPolicy (resolved through `@/`), document.types tagged Types. Test DocumentService.spec in the Tests floor with its wire on the right-hand lane. IDocumentService.ts as a dashed "Expected, not found" node in Same folder. | 3. Typical service |
| same, click "Second layer" | Immediate layer shrinks into the green frame over 0.6 s. routes.ts and scheduler.ts above, schema.ts, storage.config.ts, roles.ts, documents.fixture.ts below, wires ending on the frame edge. | 3. Typical service |
| `src/utils/formatDate.ts` | 6 callers: 4 drawn and "Show 2 more" in the floor footer. Click it: all 6 and "Show fewer". | 2. Used by many |
| `src/services/EmployeeService.ts` | ContractService.ts in Same folder, red, two wires with a "circular import" label. | 4. Many connections |
| `src/utils/currency.ts` | Empty dashed floors and the "Nothing connects to this file" card. The config line says currency is not named in package.json. | 1. Unused file |
| `test/services/DocumentService.spec.ts` | DocumentService.ts tagged "Under test" in "Imported by this file". | 5. Test file |
| Reload the window, open the map straight away | Progress banner "Reading the workspace" until the scan finishes. | 6. First scan |
| Click any node | Its wires brighten and animate, the others fade. Panel shows facts, connections with line numbers, and the 4 questions. Lines in the editor that use the node are highlighted. | all |
| Click "Open file" in the panel, or double-click a node | File opens in the editor and the map re-centres on it. | all |
| Switch VS Code to a light theme | Map and panel switch to the light tokens. | any, light |

Write down every difference. Fix it in the matching task's file and repeat the row.

- [ ] **Step 4: Replace `README.md`**

```markdown
# Wayfinder

Shows where the open file sits in the codebase, in a panel beside the editor.

- **Imports this file:** files that import the open file.
- **Imported by this file:** project files and packages the open file imports.
- **Tests:** test files that import the open file.
- **Same folder:** files the folder pattern expects but that are missing, and circular imports.
- **Second layer:** one more step out in both directions.

Everything comes from the code. No AI is used.

## Use

Open a TypeScript or JavaScript file and run **Wayfinder: Show map for this file**, or click the map button in the editor title bar.

## Develop

    npm install
    npm run build
    npm test

Press F5 to start the Extension Development Host with `test/sample-project`.

## Limits

- TypeScript and JavaScript only.
- Uses the first workspace folder and its root `tsconfig.json` or `jsconfig.json`.
- Unsaved changes show after the file is saved.

Forked from MapMyCode (MIT).
```

- [ ] **Step 5: Commit**

```bash
git add test/sample-project README.md
git commit -m "test: add sample project and design checklist"
```

---

## Follow-up: plan 2 (AI scan)

Not part of this plan. It covers:
- **Gold "Scan with AI" button:** adds a summary, "Worth checking" findings and written answers under the facts from the code, never replacing them. The panel hides the old AI text and shows loading bars while a rescan runs.
- **Gold AI role labels on floors:** added after the open file is scanned.
- **Provider:** reuse `src/providers/index.ts`. Set Ollama `num_ctx`, request JSON with citations, and drop any file or line that is not in the graph.
- **Settings:** provider, model and base URL. Show "AI not set up" when nothing is configured.
