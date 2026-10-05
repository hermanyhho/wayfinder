import * as vscode from "vscode";
import { WayfinderPanel, chooseAiModel } from "./view/WayfinderPanel";
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
      }
      // scan() reuses a running or finished scan and starts over only after a failure
      index.scan().catch((error: unknown) => {
        void vscode.window.showErrorMessage(`Wayfinder could not scan the workspace: ${String(error)}`);
      });
      WayfinderPanel.show(context, index);
    }),
    vscode.commands.registerCommand("wayfinder.chooseAiModel", chooseAiModel),
  );
}

export function deactivate() {}
