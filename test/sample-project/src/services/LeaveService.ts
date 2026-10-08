import type { ILeaveService } from "./ILeaveService";
import { formatDate } from "../utils/formatDate";

export class LeaveService implements ILeaveService {
  #requestCount = 0;

  describe(start: Date) {
    return formatDate(start);
  }

  remove(requestId: string, companyId: string) {
    this.assertSameCompany(companyId);
    this.#requestCount -= 1;
    return requestId;
  }

  protected rename(label: string) {
    return label.trim();
  }

  private assertSameCompany(companyId: string) {
    if (!companyId) throw new Error("The company is missing.");
  }
}
