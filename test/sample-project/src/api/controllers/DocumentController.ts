import { DocumentService } from "../../services/DocumentService";
import { formatDate } from "../../utils/formatDate";

export class DocumentController {
  constructor(private readonly service: DocumentService) {}
  list(actorId: string, employeeId: string) {
    return this.service.listForEmployee(actorId, employeeId).then((documents) => ({ documents, at: formatDate(new Date()) }));
  }
}
