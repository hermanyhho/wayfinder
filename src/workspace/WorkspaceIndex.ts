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
    const relative = this.indexablePath(uri);
    if (!relative) return;
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
    const foundUris = await vscode.workspace.findFiles(new vscode.RelativePattern(this.root, SOURCE_GLOB));
    const uris = foundUris.filter((uri) => this.indexablePath(uri) !== undefined);
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
