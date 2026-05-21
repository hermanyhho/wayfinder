import * as vscode from "vscode";
import { MapMyCodePanel } from "./panel/MapMyCodePanel";

export function activate(context: vscode.ExtensionContext) {
  // Register webview view provider
  const provider = new MapMyCodePanel(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("mapmycode.mainView", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Command to open panel
  context.subscriptions.push(
    vscode.commands.registerCommand("mapmycode.open", () => {
      vscode.commands.executeCommand("workbench.view.extension.mapmycode");
    })
  );
}

export function deactivate() {}