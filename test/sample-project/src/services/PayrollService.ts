import type { IPayrollService } from "./IPayrollService";
import { formatDate } from "../utils/formatDate";

export class PayrollService implements IPayrollService {
  describe(start: Date) {
    return formatDate(start);
  }
}
