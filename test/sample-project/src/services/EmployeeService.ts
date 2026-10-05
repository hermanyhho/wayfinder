import type { IEmployeeService } from "./IEmployeeService";
import { ContractService } from "./ContractService";
import { formatDate } from "../utils/formatDate";

export class EmployeeService implements IEmployeeService {
  constructor(private readonly contracts: ContractService) {}
  offboard(id: string, endDate: Date) {
    return this.contracts.endAll(id, formatDate(endDate));
  }
}
