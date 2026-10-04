import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("wayfinder.showMap", () => {
      void vscode.window.showInformationMessage("Wayfinder: map not built yet.");
    }),
  );
}

export function deactivate() {}
