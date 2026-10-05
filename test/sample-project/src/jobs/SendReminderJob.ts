import { DocumentService } from "../services/DocumentService";
import { formatDate } from "../utils/formatDate";

export class SendReminderJob {
  constructor(private readonly service: DocumentService) {}
  run() {
    return `${formatDate(new Date())} ${typeof this.service}`;
  }
}
