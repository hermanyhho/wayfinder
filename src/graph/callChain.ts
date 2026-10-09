import type { CallChain, CallDirection, ChainCall, Member } from "../shared/viewData";
import { baseNameOf, folderOf } from "./patterns";

export const CALL_CHAIN_DEPTH = 3;
export const CALLS_PER_LEVEL = 20;

const LAYER_AT_END_OF_FILE_NAME = /(controller|handler|resolver|service|manager|repository|repo|model)$/i;
const LAYER_FOLDER = /^((controller|handler|resolver|service|manager|repo|model)s?|repositor(y|ies))$/i;
const PACKAGE_FILE = /(^|\/)node_modules\//;

export interface CallPlace {
  /** workspace-relative path */
  file: string;
  name: string;
  line: number;
  isInterfaceMethod: boolean;
}

export interface CallHierarchy<Item> {
  /** undefined for a function outside the workspace, such as a built-in */
  placeOf(item: Item): CallPlace | undefined;
  callsOf(item: Item, direction: CallDirection): Promise<Item[]>;
}

function layerWord(word: string): string {
  const lower = word.toLowerCase();
  return lower.startsWith("repo") ? "repo" : lower.replace(/s$/, "");
}

export function layerOf(file: string, depth: number): string {
  const fromFileName = baseNameOf(file).match(LAYER_AT_END_OF_FILE_NAME)?.[1];
  const fromFolder = folderOf(file).split("/").reverse().find((folder) => LAYER_FOLDER.test(folder));
  const word = fromFileName ?? fromFolder;
  return word ? layerWord(word) : `Depth ${depth}`;
}

export function isInsideInterface(members: Member[], line: number): boolean {
  return members.some((member) => member.kind === "interface" && member.line <= line && line <= member.endLine);
}

const keyOf = (place: CallPlace) => `${place.file}:${place.line}:${place.name}`;

export class CallChainBuilder<Item> {
  readonly chain: CallChain;
  private readonly lastLevelItems: Record<CallDirection, Item[]>;
  private readonly inChain: Record<CallDirection, Set<string>>;
  private readonly loading: Partial<Record<CallDirection, Promise<void>>> = {};

  private constructor(
    private readonly hierarchy: CallHierarchy<Item>,
    root: Item,
    rootPlace: CallPlace,
  ) {
    this.chain = { root: { ...rootPlace, layer: layerOf(rootPlace.file, 0) }, callers: [], callees: [], canGoDeeper: { callers: true, callees: true } };
    this.lastLevelItems = { callers: [root], callees: [root] };
    this.inChain = { callers: new Set([keyOf(rootPlace)]), callees: new Set([keyOf(rootPlace)]) };
  }

  static async build<Item>(hierarchy: CallHierarchy<Item>, root: Item, rootPlace: CallPlace): Promise<CallChainBuilder<Item>> {
    const builder = new CallChainBuilder(hierarchy, root, rootPlace);
    for (let depth = 1; depth <= CALL_CHAIN_DEPTH; depth++) await Promise.all([builder.deeper("callers"), builder.deeper("callees")]);
    return builder;
  }

  /** a second request while one level is still loading waits for that level instead of adding another */
  deeper(direction: CallDirection): Promise<void> {
    this.loading[direction] ??= this.loadNextLevel(direction).finally(() => delete this.loading[direction]);
    return this.loading[direction];
  }

  private async loadNextLevel(direction: CallDirection): Promise<void> {
    if (!this.chain.canGoDeeper[direction]) return;
    const found = await Promise.all(this.lastLevelItems[direction].map((item) => this.hierarchy.callsOf(item, direction)));
    const depth = this.chain[direction].length + 1;
    const shownItems: Item[] = [];
    const calls: ChainCall[] = [];
    let moreCount = 0;
    for (const item of found.flat()) {
      const place = this.hierarchy.placeOf(item);
      if (!place || PACKAGE_FILE.test(place.file)) continue;
      const key = keyOf(place);
      if (this.inChain[direction].has(key)) continue;
      this.inChain[direction].add(key);
      if (calls.length === CALLS_PER_LEVEL) {
        moreCount++;
        continue;
      }
      calls.push({ ...place, layer: layerOf(place.file, depth) });
      shownItems.push(item);
    }
    if (!calls.length) {
      this.chain.canGoDeeper[direction] = false;
      return;
    }
    this.chain[direction].push({ calls, moreCount });
    this.lastLevelItems[direction] = shownItems;
  }
}
