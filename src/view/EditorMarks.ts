import * as vscode from "vscode";
import type { NodeKind, ViewData } from "../shared/viewData";

const DOT_COLORS: Record<NodeKind, string> = {
  here: "#5DD68A", caller: "#4C93EA", dependency: "#A68BF5", types: "#A68BF5", test: "#EE7FB0", subject: "#EE7FB0", expected: "#A68BF5", cycle: "#F26D6D", package: "#98A2AE",
};

const dotIcon = (color: string) =>
  vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="4" fill="${color}"/></svg>`)}`);

export class EditorMarks implements vscode.Disposable {
  private readonly dots = new Map<NodeKind, vscode.TextEditorDecorationType>(
    (Object.entries(DOT_COLORS) as [NodeKind, string][]).map(([kind, color]) => [
      kind,
      vscode.window.createTextEditorDecorationType({ gutterIconPath: dotIcon(color), gutterIconSize: "60%" }),
    ]),
  );
  private readonly highlight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
  });

  apply(editor: vscode.TextEditor | undefined, view: ViewData, selected: string): void {
    if (!editor) return;
    const kindOf = new Map(view.nodes.map((node) => [node.id, node.kind]));
    const linesByKind = new Map<NodeKind, number[]>();
    for (const mark of view.lineMarks) {
      const kind = kindOf.get(mark.nodeId);
      if (kind) linesByKind.set(kind, [...(linesByKind.get(kind) ?? []), mark.line]);
    }
    for (const [kind, type] of this.dots) editor.setDecorations(type, this.ranges(editor, linesByKind.get(kind) ?? []));
    const node = view.nodes.find((candidate) => candidate.id === selected);
    const lines = node && selected !== view.openFile ? node.usageInOpenFile.map((site) => site.line) : [];
    editor.setDecorations(this.highlight, this.ranges(editor, lines));
  }

  dispose(): void {
    this.highlight.dispose();
    for (const type of this.dots.values()) type.dispose();
  }

  private ranges(editor: vscode.TextEditor, lines: number[]): vscode.Range[] {
    return lines.filter((line) => line >= 1 && line <= editor.document.lineCount).map((line) => new vscode.Range(line - 1, 0, line - 1, 0));
  }
}
