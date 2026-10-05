import { createHash, randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { SCAN_SYSTEM_PROMPT, aiStatusFor, buildScanPrompt, parseScanReply } from "../ai/scanFile";
import { buildViewData } from "../graph/neighbourhood";
import { OllamaProvider } from "../providers/index";
import type { AiScanState, AiStatus, HostMessage, WebviewMessage } from "../shared/messages";
import type { ViewData } from "../shared/viewData";
import { gitHistory } from "../workspace/gitFacts";
import type { WorkspaceIndex } from "../workspace/WorkspaceIndex";
import { EditorMarks } from "./EditorMarks";

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const NUM_CTX = 8192;
const SCAN_TIMEOUT_MS = 120_000;
const STATUS_TIMEOUT_MS = 3_000;

const hashOf = (text: string) => createHash("sha1").update(text).digest("hex");

function aiSettings(): { baseUrl: string; model: string } {
  const settings = vscode.workspace.getConfiguration("wayfinder.ai");
  return { baseUrl: settings.get<string>("baseUrl") || "http://localhost:11434", model: settings.get<string>("model")?.trim() ?? "" };
}

export class WayfinderPanel implements vscode.Disposable {
  private static current: WayfinderPanel | undefined;
  private readonly marks = new EditorMarks();
  private readonly disposables: vscode.Disposable[] = [];
  private openFile: string | undefined;
  private selected: string | undefined;
  private lastView: ViewData | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private disposed = false;
  private aiStatus: AiStatus = { ready: false, reason: "checking Ollama" };
  private readonly scans = new Map<string, { textHash: string; scan: AiScanState }>();
  private latestStatusCheck = 0;

  static show(context: vscode.ExtensionContext, index: WorkspaceIndex): void {
    if (WayfinderPanel.current) {
      WayfinderPanel.current.panel.reveal(undefined, true);
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
    WayfinderPanel.lockGroupKeepingFocus(panel).catch((error: unknown) => {
      void vscode.window.showErrorMessage(`Wayfinder could not finish opening the map: ${String(error)}`);
    });
  }

  // locked here, not via a workbench.editor.autoLockGroups default: an extension default replaces vs code's list,
  // so terminal editors and the simple browser would stop locking their groups.
  private static async lockGroupKeepingFocus(panel: vscode.WebviewPanel): Promise<void> {
    const previousEditor = vscode.window.activeTextEditor;
    panel.reveal(panel.viewColumn, false);
    await vscode.commands.executeCommand("workbench.action.lockEditorGroup");
    if (!previousEditor) return;
    await vscode.window.showTextDocument(previousEditor.document, {
      viewColumn: previousEditor.viewColumn ?? vscode.ViewColumn.One,
      selection: previousEditor.selection,
      preview: false,
    });
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
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("wayfinder.ai")) void this.refreshAiStatus();
      }),
    );
    this.followEditor(vscode.window.activeTextEditor);
    void this.refreshAiStatus();
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
    this.send({ type: "aiStatus", status: this.aiStatus });
    this.marks.apply(this.editorFor(this.openFile), this.lastView, this.selected ?? this.openFile);
    this.sendScanState(this.openFile).catch(() => undefined);
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
      case "scan":
        await this.scanOpenFile();
        return;
      case "openAiSettings":
        await vscode.commands.executeCommand("workbench.action.openSettings", "wayfinder.ai");
        return;
    }
  }

  private async refreshAiStatus(): Promise<void> {
    const statusCheck = ++this.latestStatusCheck;
    const { baseUrl, model } = aiSettings();
    const installedModels = model
      ? await new OllamaProvider({ name: "ollama", baseUrl }).listModels(AbortSignal.timeout(STATUS_TIMEOUT_MS)).catch(() => null)
      : null;
    if (statusCheck !== this.latestStatusCheck) return;
    this.aiStatus = aiStatusFor(model, baseUrl, installedModels);
    this.send({ type: "aiStatus", status: this.aiStatus });
  }

  private async scanOpenFile(): Promise<void> {
    const file = this.openFile;
    const view = this.lastView;
    if (!file || !view || !this.aiStatus.ready || this.scans.get(file)?.scan.state === "loading") return;
    const text = await this.textOf(file);
    const textHash = hashOf(text);
    this.storeScan(file, textHash, { state: "loading" });
    const scan = await this.runScan(text, view);
    const textAfterScan = await this.textOf(file).catch(() => "");
    this.storeScan(file, textHash, hashOf(textAfterScan) === textHash ? scan : { state: "idle" });
  }

  private async runScan(text: string, view: ViewData): Promise<AiScanState> {
    const { baseUrl, model } = aiSettings();
    try {
      const reply = await new OllamaProvider({ name: "ollama", baseUrl, model }).chat([{ role: "user", content: buildScanPrompt(text, view) }], SCAN_SYSTEM_PROMPT, {
        format: "json",
        numCtx: NUM_CTX,
        signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
      });
      const result = parseScanReply(reply, this.lineCountByFile(view, text));
      return result ? { state: "done", result } : { state: "error", message: "The model's reply could not be read. Try again." };
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") return { state: "error", message: "The model took too long. Try again." };
      void this.refreshAiStatus();
      return { state: "error", message: `The scan failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private storeScan(file: string, textHash: string, scan: AiScanState): void {
    this.scans.set(file, { textHash, scan });
    if (file === this.openFile) this.send({ type: "ai", openFile: file, scan });
  }

  private async sendScanState(file: string): Promise<void> {
    const stored = this.scans.get(file);
    if (stored && stored.scan.state !== "loading" && stored.textHash !== hashOf(await this.textOf(file)) && this.scans.get(file) === stored) this.scans.delete(file);
    if (file === this.openFile) this.send({ type: "ai", openFile: file, scan: this.scans.get(file)?.scan ?? { state: "idle" } });
  }

  private async textOf(relativePath: string): Promise<string> {
    return (await vscode.workspace.openTextDocument(this.index.uriOf(relativePath))).getText();
  }

  private lineCountByFile(view: ViewData, openFileText: string): Map<string, number> {
    const lineCounts = new Map<string, number>();
    for (const node of view.nodes) {
      const analysis = this.index.graph.files.get(node.id);
      if (analysis) lineCounts.set(node.id, analysis.lineCount);
    }
    lineCounts.set(view.openFile, openFileText.split(/\r?\n/).length);
    return lineCounts;
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
