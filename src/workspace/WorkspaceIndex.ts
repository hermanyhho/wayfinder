import * as path from "node:path";
import ts from "typescript";
import * as vscode from "vscode";
import { analyzeSource, type SourceAnalysis } from "../graph/analyzeSource";
import { createGraph, dependentsOf, removeFile, setFile, type RelResolver } from "../graph/buildGraph";
import { createResolver } from "../graph/resolveImport";
import { loadCompilerOptions } from "./loadCompilerOptions";

const SOURCE_GLOB = "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}";
const SKIPPED = /(^|\/)(node_modules|dist|out|build|coverage|\.next|\.git)\//;
const MAX_BYTES = 1_000_000;
const BATCH_SIZE = 50;
const CREATE_GROUP_DELAY_MS = 50;
const GLOB_SPECIAL_CHARACTERS = /[[\]{}*?]/g;

export class WorkspaceIndex implements vscode.Disposable {
  readonly graph = createGraph();
  progress: { done: number; total: number } | null = null;
  packageJsonText = "";
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly resolveAbsolute: ReturnType<typeof createResolver>;
  private readonly resolve: RelResolver;
  private readonly filesWithUnresolvedImports = new Set<string>();
  private readonly sourceWatcher: vscode.FileSystemWatcher;
  private readonly anyPathWatcher: vscode.FileSystemWatcher;
  private unresolvedRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private scanning: Promise<void> | undefined;

  constructor(readonly root: vscode.Uri) {
    const { options, problems } = loadCompilerOptions(root.fsPath);
    if (problems.length > 0) void vscode.window.showWarningMessage(`Wayfinder: ${problems.join(" ")}`);
    this.resolveAbsolute = createResolver(root.fsPath, options, ts.sys);
    this.resolve = (specifier, fromPath) => {
      const result = this.resolveAbsolute(specifier, path.join(root.fsPath, fromPath));
      if (result.kind === "unresolved") this.filesWithUnresolvedImports.add(fromPath);
      if (result.kind !== "file") return result;
      const relative = this.toRelative(result.path);
      return relative ? { kind: "file", path: relative } : { kind: "unresolved" };
    };
    this.sourceWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, SOURCE_GLOB), false, false, true);
    this.sourceWatcher.onDidChange((uri) => void this.updateWatchedFile(uri));
    this.sourceWatcher.onDidCreate((uri) => void this.addWatchedFile(uri));
    // deleting, moving or renaming a folder can fire one event for the folder path, which the source glob does not match
    this.anyPathWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, "**"), false, true, false);
    this.anyPathWatcher.onDidCreate((uri) => void this.addCreatedFolder(uri));
    this.anyPathWatcher.onDidDelete((uri) => this.removeDeletedPath(uri));
  }

  scan(): Promise<void> {
    this.scanning ??= this.scanAll().catch((error: unknown) => {
      this.scanning = undefined;
      throw error;
    });
    return this.scanning;
  }

  relativePath(uri: vscode.Uri): string | undefined {
    return uri.scheme === "file" ? this.toRelative(uri.fsPath) : undefined;
  }

  uriOf(relativePath: string): vscode.Uri {
    return vscode.Uri.joinPath(this.root, relativePath);
  }

  async updateFile(uri: vscode.Uri, notify = true): Promise<void> {
    const relative = this.indexablePath(uri);
    if (!relative) return;
    const text = await this.readText(uri);
    if (text === undefined) return;
    this.index(analyzeSource(relative, text));
    if (notify) this.changed.fire();
  }

  dispose(): void {
    this.sourceWatcher.dispose();
    this.anyPathWatcher.dispose();
    clearTimeout(this.unresolvedRefreshTimer);
    this.changed.dispose();
  }

  private async scanAll(): Promise<void> {
    this.packageJsonText = (await this.readText(vscode.Uri.joinPath(this.root, "package.json"))) ?? "";
    const foundUris = await vscode.workspace.findFiles(new vscode.RelativePattern(this.root, SOURCE_GLOB));
    const uris = foundUris.filter((uri) => this.indexablePath(uri) !== undefined);
    this.progress = { done: 0, total: uris.length };
    this.changed.fire();
    try {
      for (let start = 0; start < uris.length; start += BATCH_SIZE) {
        await Promise.all(uris.slice(start, start + BATCH_SIZE).map((uri) => this.updateFile(uri, false)));
        this.progress = { done: Math.min(start + BATCH_SIZE, uris.length), total: uris.length };
        this.changed.fire();
      }
    } finally {
      this.progress = null;
      this.changed.fire();
    }
  }

  private async updateWatchedFile(uri: vscode.Uri): Promise<void> {
    if (await this.isExcludedByFilesExclude(uri)) return;
    await this.updateFile(uri);
  }

  private async addWatchedFile(uri: vscode.Uri): Promise<void> {
    if (await this.isExcludedByFilesExclude(uri)) return;
    await this.updateFile(uri, false);
    this.scheduleUnresolvedRefresh();
  }

  private async addCreatedFolder(uri: vscode.Uri): Promise<void> {
    const relative = this.relativePath(uri);
    if (!relative || SKIPPED.test(`${relative}/`)) return;
    try {
      if ((await vscode.workspace.fs.stat(uri)).type !== vscode.FileType.Directory) return;
    } catch {
      return;
    }
    const foundUris = await vscode.workspace.findFiles(new vscode.RelativePattern(uri, SOURCE_GLOB));
    await Promise.all(foundUris.map((foundUri) => this.updateFile(foundUri, false)));
    this.scheduleUnresolvedRefresh();
  }

  private scheduleUnresolvedRefresh(): void {
    this.unresolvedRefreshTimer ??= setTimeout(() => {
      this.unresolvedRefreshTimer = undefined;
      this.resolveAbsolute.clearCache();
      this.reindex([...this.filesWithUnresolvedImports]);
      this.changed.fire();
    }, CREATE_GROUP_DELAY_MS);
  }

  private removeDeletedPath(uri: vscode.Uri): void {
    const relative = this.indexablePath(uri);
    if (!relative) return;
    const removedFiles = [...this.graph.files.keys()].filter((file) => file === relative || file.startsWith(`${relative}/`));
    if (removedFiles.length === 0) return;
    const importers = new Set(removedFiles.flatMap((file) => dependentsOf(this.graph, file).map((dependency) => dependency.from)));
    for (const file of removedFiles) {
      removeFile(this.graph, file);
      this.filesWithUnresolvedImports.delete(file);
      importers.delete(file);
    }
    this.resolveAbsolute.clearCache();
    this.reindex([...importers]);
    this.changed.fire();
  }

  private reindex(files: string[]): void {
    for (const file of files) {
      const analysis = this.graph.files.get(file);
      if (analysis) this.index(analysis);
    }
  }

  private index(analysis: SourceAnalysis): void {
    this.filesWithUnresolvedImports.delete(analysis.path);
    setFile(this.graph, analysis, this.resolve);
  }

  private async isExcludedByFilesExclude(uri: vscode.Uri): Promise<boolean> {
    const relative = this.relativePath(uri);
    if (!relative) return true;
    // findFiles reads its pattern as a glob, so "?" stands in for characters like the brackets in "[id].tsx"
    const pattern = relative.replace(GLOB_SPECIAL_CHARACTERS, "?");
    const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(this.root, pattern));
    return !matches.some((match) => match.fsPath === uri.fsPath);
  }

  private indexablePath(uri: vscode.Uri): string | undefined {
    const relative = this.relativePath(uri);
    return relative && !SKIPPED.test(relative) ? relative : undefined;
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
