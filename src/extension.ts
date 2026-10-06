import * as vscode from "vscode";
import { WayfinderPanel, chooseAiModel, createAiRulesFile } from "./view/WayfinderPanel";
import { WorkspaceIndex } from "./workspace/WorkspaceIndex";

let index: WorkspaceIndex | undefined;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("wayfinder.showMap", () => {
      const scanningIndex = startIndex(context);
      if (!scanningIndex) {
        void vscode.window.showInformationMessage("Wayfinder needs an open folder.");
        return;
      }
      WayfinderPanel.show(context, scanningIndex);
    }),
    vscode.window.registerWebviewPanelSerializer("wayfinder.map", {
      async deserializeWebviewPanel(panel, savedState: unknown) {
        const scanningIndex = startIndex(context);
        if (!scanningIndex) {
          panel.dispose();
          return;
        }
        WayfinderPanel.restore(panel, context, scanningIndex, savedState);
      },
    }),
    vscode.commands.registerCommand("wayfinder.chooseAiModel", chooseAiModel),
    vscode.commands.registerCommand("wayfinder.createAiRules", createAiRulesFile),
  );
}

function startIndex(context: vscode.ExtensionContext): WorkspaceIndex | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  if (!index) {
    index = new WorkspaceIndex(folder.uri);
    context.subscriptions.push(index);
  }
  // scan() reuses a running or finished scan and starts over only after a failure
  index.scan().catch((error: unknown) => {
    void vscode.window.showErrorMessage(`Wayfinder could not scan the workspace: ${String(error)}`);
  });
  return index;
}

export function deactivate() {}
