import type { IContractService } from "./IContractService";
import { EmployeeService } from "./EmployeeService";
import { formatDate } from "../utils/formatDate";

export class ContractService implements IContractService {
  employees?: EmployeeService;
  endAll(id: string, endDate: string) {
    return `${id} ends ${endDate} ${formatDate(new Date())}`;
  }
}
