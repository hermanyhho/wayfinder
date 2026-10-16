import type { AffectedFile, BranchView, ChangedFile } from "../shared/viewData";
import { FLOOR_LEFT, MAX_PER_GROUP, NODE_H, ROW_H, type BannerView, type FloorView, type GroupToggleView, type PortView, type WireView } from "./layout";

const COLUMN_GAP = 40;
const COLUMN_PADDING = 14;
// leaves room for the title and a two-line description, see .fdesc in styles.css
const COLUMN_HEADING_H = 64;
const TOGGLE_H = 28;
const EMPTY_COLUMN_H = 70;
const BANNER_GAP = 24;
// matches the padding, heading and list rows of .banner in styles.css, so the canvas leaves room for it
const BANNER_FRAME_H = 52;
const BANNER_ROW_H = 23;

export type BranchChanges = Extract<BranchView, { state: "changes" }>;
export type BranchColumnKey = "changed" | "importsChanged" | "oneStepFurther";

export interface BranchCardView {
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cls: string;
  column: BranchColumnKey;
  change?: ChangedFile["change"];
  detail: string;
}

export interface BranchLayout { floors: FloorView[]; cards: BranchCardView[]; toggles: GroupToggleView[]; wires: WireView[]; ports: PortView[]; banner: BannerView | null; height: number; }

const fileNameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const withFolder = (text: string, path: string) => [text, folderOf(path)].filter(Boolean).join(" · ");
const viaText = (file: AffectedFile) => withFolder(`via ${file.via.map(fileNameOf).join(", ")}`, file.path);

const moreKeyOf = (column: BranchColumnKey) => `branch:${column}:more`;

interface ColumnDef { key: BranchColumnKey; title: string; description: string; path: string; cls: string; emptyText: string; cards: { path: string; detail: string; change?: ChangedFile["change"] }[]; }

function columnDefs(changes: BranchChanges): ColumnDef[] {
  const others = changes.otherFileCount;
  return [
    {
      key: "changed",
      title: "Changed",
      description: `Edited on this branch since it left ${changes.base}.`,
      path: others ? `and ${others} other file${others === 1 ? "" : "s"}` : "",
      cls: "green",
      emptyText: "",
      cards: changes.changed.map((file) => ({ path: file.path, change: file.change, detail: withFolder(file.change === "deleted" ? "deleted" : `+${file.linesAdded} −${file.linesRemoved}`, file.path) })),
    },
    { key: "importsChanged", title: "Imports a changed file", description: "Uses a changed file directly. Most likely to break.", path: "", cls: "blue", emptyText: "No file imports a changed file.", cards: changes.importsChanged.map((file) => ({ path: file.path, detail: viaText(file) })) },
    { key: "oneStepFurther", title: "One step further", description: "Uses a file from the middle column. Less likely to break.", path: "", cls: "blue two", emptyText: "Nothing is one step further.", cards: changes.oneStepFurther.map((file) => ({ path: file.path, detail: viaText(file) })) },
  ];
}

function horizontalWire(from: BranchCardView, to: BranchCardView) {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const bend = (x2 - x1) / 2;
  return { d: `M${x1} ${y1} C${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, x1, y1, x2, y2 };
}

/** open holds the columns whose "Show N more" toggle is on, by moreKeyOf */
export function layoutBranch(changes: BranchChanges, open: Record<string, boolean>, width: number): BranchLayout {
  const top = 16;
  const columnW = Math.floor((width - 2 * FLOOR_LEFT - 2 * COLUMN_GAP) / 3);
  const cards: BranchCardView[] = [];
  const toggles: GroupToggleView[] = [];
  const placedColumns = columnDefs(changes).map((def, index) => {
    const x = FLOOR_LEFT + index * (columnW + COLUMN_GAP);
    const cardX = x + COLUMN_PADDING;
    const cardW = columnW - 2 * COLUMN_PADDING;
    const showAll = !!open[moreKeyOf(def.key)];
    const shown = showAll ? def.cards : def.cards.slice(0, MAX_PER_GROUP);
    let cursor = top + COLUMN_HEADING_H;
    for (const card of shown) {
      const cls = [def.cls, card.change === "deleted" ? "gone" : ""].filter(Boolean).join(" ");
      cards.push({ path: card.path, x: cardX, y: cursor, w: cardW, h: NODE_H, cls, column: def.key, change: card.change, detail: card.detail });
      cursor += ROW_H;
    }
    if (def.cards.length > MAX_PER_GROUP) {
      toggles.push({ key: moreKeyOf(def.key), x: cardX, y: cursor - 6, text: showAll ? "Show fewer" : `Show ${def.cards.length - shown.length} more`, icon: showAll ? "minus" : "plus" });
      cursor += TOGGLE_H;
    }
    return { def, x, bottom: shown.length ? cursor : top + EMPTY_COLUMN_H };
  });
  const columnsH = Math.max(...placedColumns.map((column) => column.bottom)) - top + 4;
  const floors: FloorView[] = placedColumns.map(({ def, x }) => ({
    key: def.key, title: def.title, description: def.description, path: def.path, cls: def.cards.length ? "" : "empty", x, y: top, w: columnW, h: columnsH, emptyText: def.cards.length ? "" : def.emptyText, toggle: null,
  }));

  const wires: WireView[] = [];
  const ports: PortView[] = [];
  const shownCard = (column: BranchColumnKey, path: string) => cards.find((card) => card.column === column && card.path === path);
  const wireColumn = (files: AffectedFile[], fromColumn: BranchColumnKey, toColumn: BranchColumnKey) => {
    for (const file of files) {
      const to = shownCard(toColumn, file.path);
      for (const via of file.via) {
        const from = shownCard(fromColumn, via);
        if (!to || !from) continue;
        const route = horizontalWire(from, to);
        wires.push({ cls: "blue", d: route.d });
        ports.push({ cls: "blue", x: route.x1, y: route.y1, incoming: false }, { cls: "blue", x: route.x2, y: route.y2, incoming: true });
      }
    }
  };
  wireColumn(changes.importsChanged, "changed", "importsChanged");
  wireColumn(changes.oneStepFurther, "importsChanged", "oneStepFurther");

  let height = top + columnsH;
  let banner: BannerView | null = null;
  if (changes.untested.length) {
    const y = height + BANNER_GAP;
    banner = { y, title: "Changed files without tests", items: changes.untested.map((path) => ({ label: fileNameOf(path), value: folderOf(path) })), progress: null };
    height = y + BANNER_FRAME_H + changes.untested.length * BANNER_ROW_H;
  }
  return { floors, cards, toggles, wires, ports, banner, height: height + 16 };
}
