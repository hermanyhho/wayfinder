import type { ILeaveService } from "./ILeaveService";
import { formatDate } from "../utils/formatDate";

export class LeaveService implements ILeaveService {
  describe(start: Date) {
    return formatDate(start);
  }
}
