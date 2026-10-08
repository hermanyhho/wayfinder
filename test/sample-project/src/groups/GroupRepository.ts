import type { IGroup } from "./IGroup";

export class GroupRepository implements IGroup {
  id = "repository";
  name = "Groups";

  findAll(): IGroup[] {
    return [];
  }
}
