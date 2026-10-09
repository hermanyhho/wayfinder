import { COLUMN_ORDER, type ColumnKey, type LayerView } from "./layout";

export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** x is the horizontal centre so cards of different widths line up, y is the top edge */
export interface NavigationCard { key: string; floor: string; x: number; y: number; }

const OPEN_FILE_FLOOR = "mine";
const CALLERS_FLOOR = "callers";

const byPosition = (first: NavigationCard, second: NavigationCard) => first.y - second.y || first.x - second.x;

export function navigationCards(layer: LayerView): NavigationCard[] {
  const placed = [
    ...layer.nodes.map((node) => ({ key: node.id, x: node.x, y: node.y, w: node.w, column: node.column })),
    ...layer.members.map((member) => ({ key: member.id, x: member.x, y: member.y, w: member.w, column: member.column })),
    ...layer.groupHeadings.map((heading) => ({ key: heading.key, x: heading.x, y: heading.y, w: heading.w, column: heading.column })),
  ];
  return placed.flatMap((card) => {
    // in focus mode all three columns are laid out at the same place, so a column card cannot be found by position
    const floor = card.column ?? layer.floors.find((candidate) => card.x >= candidate.x && card.x < candidate.x + candidate.w && card.y >= candidate.y && card.y < candidate.y + candidate.h)?.key;
    return floor ? [{ key: card.key, floor, x: card.x + card.w / 2, y: card.y }] : [];
  }).sort(byPosition);
}

const nearestByX = (cards: NavigationCard[], x: number) =>
  cards.reduce((best, card) => (Math.abs(card.x - x) < Math.abs(best.x - x) ? card : best));

function nearestInNextRow(candidates: NavigationCard[], current: NavigationCard, downwards: boolean): NavigationCard | undefined {
  const ahead = candidates.filter((card) => (downwards ? card.y > current.y : card.y < current.y));
  if (!ahead.length) return undefined;
  const rowY = downwards ? Math.min(...ahead.map((card) => card.y)) : Math.max(...ahead.map((card) => card.y));
  return nearestByX(ahead.filter((card) => card.y === rowY), current.x);
}

function nearestInSameRow(candidates: NavigationCard[], current: NavigationCard, rightwards: boolean): NavigationCard | undefined {
  const ahead = candidates.filter((card) => card.y === current.y && (rightwards ? card.x > current.x : card.x < current.x));
  return ahead.length ? nearestByX(ahead, current.x) : undefined;
}

/** in the call chain every row of cards is one lane, so the arrows move between rows and along a row */
export function nextChainCardKey(cards: NavigationCard[], currentKey: string, arrow: ArrowKey): string | undefined {
  const current = cards.find((card) => card.key === currentKey);
  if (!current) return undefined;
  if (arrow === "ArrowUp" || arrow === "ArrowDown") return nearestInNextRow(cards, current, arrow === "ArrowDown")?.key;
  return nearestInSameRow(cards, current, arrow === "ArrowRight")?.key;
}

export function nextCardKey(cards: NavigationCard[], currentKey: string, arrow: ArrowKey, options: { loopColumns?: boolean } = {}): string | undefined {
  const current = cards.find((card) => card.key === currentKey);
  if (!current) return undefined;
  const onFloor = (floor: string) => cards.filter((card) => card.floor === floor).sort(byPosition);
  const firstCardOf = (columns: ColumnKey[]) => columns.map(onFloor).find((columnCards) => columnCards.length)?.[0];
  const openFile = onFloor(OPEN_FILE_FLOOR)[0];
  const downwards = arrow === "ArrowDown";
  const rightwards = arrow === "ArrowRight";
  const vertical = arrow === "ArrowUp" || downwards;
  const columnIndex = COLUMN_ORDER.indexOf(current.floor as ColumnKey);

  let next: NavigationCard | undefined;
  if (current.floor === CALLERS_FLOOR) {
    next = vertical ? nearestInNextRow([...onFloor(CALLERS_FLOOR), openFile], current, downwards) : nearestInSameRow(onFloor(CALLERS_FLOOR), current, rightwards);
  } else if (current.floor === OPEN_FILE_FLOOR) {
    if (arrow === "ArrowUp") next = nearestInNextRow(onFloor(CALLERS_FLOOR), current, false);
    else if (downwards) next = firstCardOf(["members", "deps", "tests"]);
  } else if (columnIndex !== -1) {
    if (vertical) next = nearestInNextRow(onFloor(current.floor), current, downwards) ?? (downwards ? undefined : openFile);
    else {
      const columnsAfter = COLUMN_ORDER.slice(columnIndex + 1);
      const columnsBefore = COLUMN_ORDER.slice(0, columnIndex);
      const wrappedColumns = options.loopColumns ? (rightwards ? columnsBefore : columnsAfter) : [];
      next = firstCardOf(rightwards ? [...columnsAfter, ...wrappedColumns] : [...wrappedColumns, ...columnsBefore].reverse());
    }
  }
  return next?.key;
}
