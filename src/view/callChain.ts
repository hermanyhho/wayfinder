import * as vscode from "vscode";
import { type CallHierarchy, CallChainBuilder, isInsideInterface } from "../graph/callChain";
import type { WorkspaceIndex } from "../workspace/WorkspaceIndex";

// arrow functions in a const or a class property show up as variables and properties in the outline
const FUNCTION_SYMBOLS = new Set([
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Constructor,
  vscode.SymbolKind.Variable,
  vscode.SymbolKind.Constant,
  vscode.SymbolKind.Property,
]);
const NOT_A_FUNCTION = new Set([vscode.SymbolKind.File, vscode.SymbolKind.Module, vscode.SymbolKind.Namespace, vscode.SymbolKind.Package, vscode.SymbolKind.Class]);

function innermostFunctionAt(symbols: vscode.DocumentSymbol[], position: vscode.Position): vscode.DocumentSymbol | undefined {
  const containing = symbols.find((symbol) => symbol.range.contains(position));
  if (!containing) return undefined;
  return innermostFunctionAt(containing.children, position) ?? (FUNCTION_SYMBOLS.has(containing.kind) ? containing : undefined);
}

function callHierarchyOf(index: WorkspaceIndex): CallHierarchy<vscode.CallHierarchyItem> {
  return {
    placeOf(item) {
      const file = index.relativePath(item.uri);
      if (!file) return undefined;
      const line = item.selectionRange.start.line + 1;
      return { file, name: item.name, line, isInterfaceMethod: isInsideInterface(index.graph.files.get(file)?.members ?? [], line) };
    },
    async callsOf(item, direction) {
      if (direction === "callers") return ((await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[] | undefined>("vscode.provideIncomingCalls", item)) ?? []).map((call) => call.from);
      return ((await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[] | undefined>("vscode.provideOutgoingCalls", item)) ?? []).map((call) => call.to);
    },
  };
}

/** undefined when the position is not inside a function or method of a workspace file */
export async function buildCallChainAt(index: WorkspaceIndex, uri: vscode.Uri, position: vscode.Position): Promise<CallChainBuilder<vscode.CallHierarchyItem> | undefined> {
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>("vscode.executeDocumentSymbolProvider", uri);
  const functionSymbol = innermostFunctionAt(symbols ?? [], position);
  if (!functionSymbol) return undefined;
  const prepared = await vscode.commands.executeCommand<vscode.CallHierarchyItem[] | undefined>("vscode.prepareCallHierarchy", uri, functionSymbol.selectionRange.start);
  const root = prepared?.find((item) => !NOT_A_FUNCTION.has(item.kind));
  if (!root) return undefined;
  const hierarchy = callHierarchyOf(index);
  const rootPlace = hierarchy.placeOf(root);
  return rootPlace && CallChainBuilder.build(hierarchy, root, rootPlace);
}
