import type { IGroup } from "./IGroup";

export class GroupService implements IGroup {
  constructor(
    public id: string,
    public name: string,
  ) {}

  rename(name: string) {
    this.name = name.trim();
  }
}
