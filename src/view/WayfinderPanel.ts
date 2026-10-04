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
  private disposed = false;

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
      panel.webview.onDidReceiveMessage((message: WebviewMessage) =>
        this.onMessage(message).catch((error: unknown) => {
          void vscode.window.showErrorMessage(`Wayfinder could not handle that action: ${String(error)}`);
        }),
      ),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.followEditor(editor)),
      index.onDidChange(() => this.scheduleRefresh()),
    );
    this.followEditor(vscode.window.activeTextEditor);
  }

  dispose(): void {
    this.disposed = true;
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
    switch (message.type) {
      case "ready":
        this.post();
        return;
      case "select": {
        this.selected = message.id;
        if (this.openFile && this.lastView) this.marks.apply(this.editorFor(this.openFile), this.lastView, message.id);
        if (!this.index.graph.files.has(message.id)) return;
        const facts = await gitHistory(this.index.root.fsPath, message.id);
        this.send({ type: "git", id: message.id, facts });
        return;
      }
      case "open": {
        if (!this.index.graph.files.has(message.id)) return;
        const document = await vscode.workspace.openTextDocument(this.index.uriOf(message.id));
        await vscode.window.showTextDocument(document, { viewColumn: this.editorColumn(), preview: false });
        return;
      }
    }
  }

  private send(message: HostMessage): void {
    if (this.disposed) return;
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
