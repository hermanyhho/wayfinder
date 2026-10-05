import { roles } from "./roles";

export class PermissionPolicy {
  async assertCanRead(actorId: string, employeeId: string) {
    if (!roles.length) throw new Error(`${actorId} cannot read ${employeeId}`);
  }
  async assertCanWrite(actorId: string, employeeId: string) {
    if (!roles.length) throw new Error(`${actorId} cannot write ${employeeId}`);
  }
}
