import { createHash, randomBytes } from "node:crypto";
import { basename } from "node:path";
import * as vscode from "vscode";
import { CLOUD_CLIS, type CloudCli, cloudCliFor, cloudCliStatus, cloudConsentQuestion } from "../ai/cloudCli";
import { type InstalledModel, type ModelPickerItem, modelPickerItems } from "../ai/modelPicker";
import { RULES_FILE, SCAN_SYSTEM_PROMPT, STARTER_RULES_FILE, type ScanPromptExtras, aiStatusFor, buildScanPrompt, neighbourFiles, parseScanReply } from "../ai/scanFile";
import type { CallChainBuilder } from "../graph/callChain";
import { buildViewData } from "../graph/neighbourhood";
import { cliLoginState, runCliScan } from "../providers/cliRunner";
import { OllamaProvider } from "../providers/index";
import type { AiScanState, AiStatus, ColumnFocusChange, HostMessage, WebviewMessage } from "../shared/messages";
import type { CallDirection, ViewData } from "../shared/viewData";
import { gitHistory } from "../workspace/gitFacts";
import type { WorkspaceIndex } from "../workspace/WorkspaceIndex";
import { buildCallChainAt } from "./callChain";
import { EditorMarks } from "./EditorMarks";

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const NUM_CTX = 8192;
const SCAN_TIMEOUT_MS = 120_000;
const STATUS_TIMEOUT_MS = 3_000;
const CURSOR_THROTTLE_MS = 100;
const CALL_DIRECTIONS: readonly unknown[] = ["callers", "callees"] satisfies CallDirection[];

const hashOf = (text: string) => createHash("sha1").update(text).digest("hex");

function aiSettings(): { baseUrl: string; model: string } {
  const settings = vscode.workspace.getConfiguration("wayfinder.ai");
  return { baseUrl: settings.get<string>("baseUrl") || "http://localhost:11434", model: settings.get<string>("model")?.trim() ?? "" };
}

function listInstalledModels(baseUrl: string): Promise<InstalledModel[] | null> {
  return new OllamaProvider({ name: "ollama", baseUrl }).listModels(AbortSignal.timeout(STATUS_TIMEOUT_MS)).catch(() => null);
}

async function installedCloudClis(): Promise<CloudCli[]> {
  const logins = await Promise.all(CLOUD_CLIS.map((cli) => cliLoginState(cli, STATUS_TIMEOUT_MS)));
  return CLOUD_CLIS.filter((_cli, index) => logins[index] !== "missing");
}

const openWayfinderSettings = () => vscode.commands.executeCommand("workbench.action.openSettings", "wayfinder");

export async function chooseAiModel(): Promise<void> {
  const { baseUrl, model } = aiSettings();
  const picked = await vscode.window.showQuickPick<ModelPickerItem & vscode.QuickPickItem>(
    Promise.all([listInstalledModels(baseUrl), installedCloudClis()]).then(([installedModels, installedClis]) =>
      modelPickerItems(installedModels, baseUrl, installedClis, model).map((item) => (item.separator ? { ...item, kind: vscode.QuickPickItemKind.Separator } : item)),
    ),
    { title: "Wayfinder: Choose AI model" },
  );
  if (picked?.model !== undefined) await vscode.workspace.getConfiguration("wayfinder.ai").update("model", picked.model, vscode.ConfigurationTarget.Global);
  else if (picked?.opensSettings) await openWayfinderSettings();
}

export async function createAiRulesFile(): Promise<void> {
  const root = WayfinderPanel.rulesRoot();
  if (!root) {
    void vscode.window.showInformationMessage("Wayfinder needs an open folder.");
    return;
  }
  const rulesFile = vscode.Uri.joinPath(root, RULES_FILE);
  const exists = await vscode.workspace.fs.stat(rulesFile).then(
    () => true,
    () => false,
  );
  if (!exists) await vscode.workspace.fs.writeFile(rulesFile, new TextEncoder().encode(STARTER_RULES_FILE));
  await vscode.window.showTextDocument(rulesFile, { preview: false });
}

// vs code keeps a locked group open when its last tab closes, so files opened later skip that empty space.
// the map's own tab can still be listed while it closes.
function closeGroupIfOnlyMapLeft(mapColumn: vscode.ViewColumn | undefined): void {
  const mapGroup = vscode.window.tabGroups.all.find((group) => group.viewColumn === mapColumn);
  if (!mapGroup || !mapGroup.tabs.every(isMapTab)) return;
  void vscode.window.tabGroups.close(mapGroup);
}

function isMapTab(tab: vscode.Tab): boolean {
  return tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith("wayfinder.map");
}

export class WayfinderPanel implements vscode.Disposable {
  private static current: WayfinderPanel | undefined;
  private readonly marks = new EditorMarks();
  private readonly disposables: vscode.Disposable[] = [];
  private openFile: string | undefined;
  private focusOpenFileWhenReady = false;
  private mapColumn: vscode.ViewColumn | undefined;
  private selected: string | undefined;
  private lastView: ViewData | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private cursorTimer: NodeJS.Timeout | undefined;
  private disposed = false;
  private aiStatus: AiStatus = { ready: false, reason: "checking Ollama" };
  private readonly scans = new Map<string, { textHash: string; scan: AiScanState }>();
  private latestStatusCheck = 0;
  private readonly stopScansOnClose = new AbortController();
  private callChain: CallChainBuilder<vscode.CallHierarchyItem> | undefined;

  // the index keeps the folder it was first opened with, and the scan reads the rules file from there
  static rulesRoot(): vscode.Uri | undefined {
    return WayfinderPanel.current?.index.root ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  static show(context: vscode.ExtensionContext, index: WorkspaceIndex): void {
    const focusMap = vscode.workspace.getConfiguration("wayfinder.shortcut").get<boolean>("focusMap", true);
    const existing = WayfinderPanel.current;
    if (existing) {
      existing.panel.reveal(undefined, !focusMap);
      existing.followEditor(vscode.window.activeTextEditor);
      if (focusMap) existing.send({ type: "focusOpenFile" });
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "wayfinder.map",
      "Wayfinder",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { ...WayfinderPanel.webviewOptions(context), retainContextWhenHidden: true },
    );
    WayfinderPanel.current = new WayfinderPanel(panel, context, index);
    WayfinderPanel.current.focusOpenFileWhenReady = focusMap;
    WayfinderPanel.lockGroup(panel, !focusMap).catch((error: unknown) => {
      void vscode.window.showErrorMessage(`Wayfinder could not finish opening the map: ${String(error)}`);
    });
  }

  static restore(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, index: WorkspaceIndex, savedState: unknown): void {
    // the extension folder changes after an update, so the saved resource roots would point at the old one
    panel.webview.options = WayfinderPanel.webviewOptions(context);
    const savedFile = (savedState as { openFile?: unknown } | undefined)?.openFile;
    const restoredFile = typeof savedFile === "string" && SOURCE_FILE.test(savedFile) ? savedFile : undefined;
    WayfinderPanel.current = new WayfinderPanel(panel, context, index, restoredFile);
  }

  private static webviewOptions(context: vscode.ExtensionContext): vscode.WebviewOptions {
    return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out")] };
  }

  // locked here, not via a workbench.editor.autoLockGroups default: an extension default replaces vs code's list,
  // so terminal editors and the simple browser would stop locking their groups.
  private static async lockGroup(panel: vscode.WebviewPanel, keepFocusInEditor: boolean): Promise<void> {
    const previousEditor = vscode.window.activeTextEditor;
    panel.reveal(panel.viewColumn, false);
    await vscode.commands.executeCommand("workbench.action.lockEditorGroup");
    if (!keepFocusInEditor || !previousEditor) return;
    await vscode.window.showTextDocument(previousEditor.document, {
      viewColumn: previousEditor.viewColumn ?? vscode.ViewColumn.One,
      selection: previousEditor.selection,
      preview: false,
    });
  }

  static async returnToEditor(): Promise<void> {
    const current = WayfinderPanel.current;
    if (!current?.openFile) return;
    const editor = current.editorFor(current.openFile);
    await vscode.window.showTextDocument(editor?.document.uri ?? current.index.uriOf(current.openFile), {
      viewColumn: current.editorColumn(),
      selection: editor?.selection,
      preview: false,
    });
  }

  static async showCallChain(context: vscode.ExtensionContext, index: WorkspaceIndex): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const callChain = editor && (await buildCallChainAt(index, editor.document.uri, editor.selection.active));
    if (!callChain) {
      void vscode.window.showInformationMessage("No function at the cursor.");
      return;
    }
    WayfinderPanel.show(context, index);
    WayfinderPanel.current?.showChain(callChain);
  }

  static changeColumnFocus(change: ColumnFocusChange): void {
    WayfinderPanel.current?.send({ type: "columnFocus", change });
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly index: WorkspaceIndex,
    restoredFile?: string,
  ) {
    this.openFile = restoredFile;
    this.selected = restoredFile;
    this.mapColumn = panel.viewColumn;
    panel.webview.html = this.html(context);
    const rulesWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(index.root, RULES_FILE));
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.onDidChangeViewState((event) => (this.mapColumn = event.webviewPanel.viewColumn)),
      panel.webview.onDidReceiveMessage((message: WebviewMessage) =>
        this.onMessage(message).catch((error: unknown) => {
          void vscode.window.showErrorMessage(`Wayfinder could not handle that action: ${String(error)}`);
        }),
      ),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.followEditor(editor)),
      vscode.window.onDidChangeTextEditorSelection((event) => this.scheduleCursor(event.textEditor)),
      index.onDidChange(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("wayfinder.ai.instructions") || event.affectsConfiguration("wayfinder.ai.scope")) this.dropStoredScans();
        if (event.affectsConfiguration("wayfinder.ai")) void this.refreshAiStatus();
      }),
      rulesWatcher,
      rulesWatcher.onDidChange(() => this.dropStoredScans()),
      rulesWatcher.onDidCreate(() => this.dropStoredScans()),
      rulesWatcher.onDidDelete(() => this.dropStoredScans()),
    );
    this.followEditor(vscode.window.activeTextEditor);
    void this.refreshAiStatus();
  }

  dispose(): void {
    this.disposed = true;
    this.stopScansOnClose.abort();
    WayfinderPanel.current = undefined;
    clearTimeout(this.refreshTimer);
    clearTimeout(this.cursorTimer);
    this.marks.dispose();
    for (const disposable of this.disposables) disposable.dispose();
    closeGroupIfOnlyMapLeft(this.mapColumn);
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

  private scheduleCursor(editor: vscode.TextEditor): void {
    if (this.cursorTimer || !this.isOpenFileEditor(editor)) return;
    this.cursorTimer = setTimeout(() => {
      this.cursorTimer = undefined;
      this.sendCursor(editor);
    }, CURSOR_THROTTLE_MS);
  }

  // the open file can change while a throttled cursor update waits, and the line would then mark a member of the new file
  private sendCursor(editor: vscode.TextEditor | undefined): void {
    if (editor && this.isOpenFileEditor(editor)) this.send({ type: "cursor", line: editor.selection.active.line + 1 });
  }

  private isOpenFileEditor(editor: vscode.TextEditor): boolean {
    return !!this.openFile && this.index.relativePath(editor.document.uri) === this.openFile;
  }

  private post(): void {
    if (!this.openFile) return;
    this.lastView = buildViewData(this.index.graph, this.openFile, { scan: this.index.progress, packageJsonText: this.index.packageJsonText });
    this.send({ type: "view", data: this.lastView });
    this.send({ type: "aiStatus", status: this.aiStatus });
    this.sendCursor(this.editorFor(this.openFile));
    this.marks.apply(this.editorFor(this.openFile), this.lastView, this.selected ?? this.openFile);
    this.sendScanState(this.openFile).catch(() => undefined);
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.post();
        if (this.focusOpenFileWhenReady) this.send({ type: "focusOpenFile" });
        this.focusOpenFileWhenReady = false;
        if (this.callChain) this.send({ type: "callChain", chain: this.callChain.chain });
        return;
      case "select": {
        this.selected = message.id;
        if (this.openFile && this.lastView) this.marks.apply(this.editorFor(this.openFile), this.lastView, message.id);
        if (!this.index.graph.files.has(message.id)) return;
        const facts = await gitHistory(this.index.root.fsPath, message.id);
        this.send({ type: "git", id: message.id, facts });
        return;
      }
      case "open":
        if (this.index.graph.files.has(message.id)) await this.showFile(message.id, message.line);
        return;
      case "reveal":
        if (this.openFile) await this.showFile(this.openFile, message.line);
        return;
      case "scan":
        await this.scanOpenFile();
        return;
      case "openSettings":
        await openWayfinderSettings();
        return;
      case "showCallChain":
        await this.showCallChainAtLine(message.file, message.line);
        return;
      case "extendCallChain": {
        const callChain = this.callChain;
        if (!callChain || !CALL_DIRECTIONS.includes(message.direction)) return;
        await callChain.deeper(message.direction);
        if (callChain === this.callChain) this.send({ type: "callChain", chain: callChain.chain });
        return;
      }
    }
  }

  private showChain(callChain: CallChainBuilder<vscode.CallHierarchyItem>): void {
    this.callChain = callChain;
    this.send({ type: "callChain", chain: callChain.chain });
  }

  private async showCallChainAtLine(file: string, line: number): Promise<void> {
    if (!this.index.graph.files.has(file) || !Number.isInteger(line)) return;
    const document = await vscode.workspace.openTextDocument(this.index.uriOf(file));
    const textLine = document.lineAt(Math.min(Math.max(line, 1), document.lineCount) - 1);
    const callChain = await buildCallChainAt(this.index, document.uri, new vscode.Position(textLine.lineNumber, textLine.firstNonWhitespaceCharacterIndex));
    if (callChain) this.showChain(callChain);
    else void vscode.window.showInformationMessage(`No function at line ${line} of ${basename(file)}.`);
  }

  private async showFile(path: string, line?: number): Promise<void> {
    if (line !== undefined && !Number.isInteger(line)) return;
    const document = await vscode.workspace.openTextDocument(this.index.uriOf(path));
    // the file can be shorter than when it was scanned, so a line past the end goes to the last line
    const start = line === undefined ? undefined : document.lineAt(Math.min(Math.max(line, 1), document.lineCount) - 1).range.start;
    await vscode.window.showTextDocument(document, { viewColumn: this.editorColumn(), preview: false, ...(start ? { selection: new vscode.Range(start, start) } : {}) });
  }

  private async refreshAiStatus(): Promise<void> {
    const statusCheck = ++this.latestStatusCheck;
    const { baseUrl, model } = aiSettings();
    const cloudCli = cloudCliFor(model);
    const status = cloudCli
      ? cloudCliStatus(cloudCli, await cliLoginState(cloudCli, STATUS_TIMEOUT_MS))
      : aiStatusFor(model, baseUrl, model ? ((await listInstalledModels(baseUrl))?.map((installed) => installed.name) ?? null) : null);
    if (statusCheck !== this.latestStatusCheck) return;
    this.aiStatus = status;
    this.send({ type: "aiStatus", status: this.aiStatus });
  }

  private async scanOpenFile(): Promise<void> {
    const file = this.openFile;
    const view = this.lastView;
    if (!file || !view || !this.aiStatus.ready || this.scans.get(file)?.scan.state === "loading") return;
    const { baseUrl, model } = aiSettings();
    const cloudCli = cloudCliFor(model);
    if (cloudCli && !(await this.cloudScanAllowed(file, cloudCli))) return;
    const text = await this.textOf(file);
    const textHash = hashOf(text);
    this.storeScan(file, textHash, { state: "loading" });
    const scan = await this.runScan(text, view, baseUrl, model, cloudCli);
    const textAfterScan = await this.textOf(file).catch(() => "");
    this.storeScan(file, textHash, hashOf(textAfterScan) === textHash ? scan : { state: "idle" });
  }

  private async runScan(text: string, view: ViewData, baseUrl: string, model: string, cloudCli: CloudCli | undefined): Promise<AiScanState> {
    try {
      const { prompt, rulesCut } = buildScanPrompt(text, view, await this.scanExtras(view));
      const reply = cloudCli
        ? await runCliScan(cloudCli, prompt, AbortSignal.any([AbortSignal.timeout(SCAN_TIMEOUT_MS), this.stopScansOnClose.signal]))
        : await new OllamaProvider({ name: "ollama", baseUrl, model }).chat([{ role: "user", content: prompt }], SCAN_SYSTEM_PROMPT, {
            format: "json",
            numCtx: NUM_CTX,
            signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
          });
      const result = parseScanReply(reply, this.lineCountByFile(view, text));
      return result ? { state: "done", result, rulesCut } : { state: "error", message: "The model's reply could not be read. Try again." };
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") return { state: "error", message: "The model took too long. Try again." };
      void this.refreshAiStatus();
      return { state: "error", message: `The scan failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async cloudScanAllowed(file: string, cloudCli: CloudCli): Promise<boolean> {
    const consentKey = `wayfinder.ai.cloudAllowed.${cloudCli.model}`;
    if (this.context.workspaceState.get<boolean>(consentKey)) return true;
    const allow = "Allow for this workspace";
    if ((await vscode.window.showWarningMessage(cloudConsentQuestion(basename(file), cloudCli), { modal: true }, allow)) !== allow) return false;
    await this.context.workspaceState.update(consentKey, true);
    return true;
  }

  private async scanExtras(view: ViewData): Promise<ScanPromptExtras> {
    const settings = vscode.workspace.getConfiguration("wayfinder.ai");
    const repoRules = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.index.root, RULES_FILE)).then(
      (bytes) => new TextDecoder().decode(bytes),
      (error: unknown) => {
        if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return "";
        throw error;
      },
    );
    const userRules = settings.get<string>("instructions") ?? "";
    if (settings.get<string>("scope") !== "neighbours") return { repoRules, userRules };
    const neighbours = neighbourFiles(view).filter((file) => this.index.graph.files.has(file));
    const readResults = await Promise.allSettled(neighbours.map(async (file) => ({ file, source: await this.textOf(file) })));
    const neighbourSources = readResults.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    return { repoRules, userRules, neighbourSources };
  }

  private dropStoredScans(): void {
    for (const [file, stored] of this.scans) if (stored.scan.state !== "loading") this.scans.delete(file);
    if (this.openFile) this.sendScanState(this.openFile).catch(() => undefined);
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
