import { InvoiceManager } from "./InvoiceManager";
import { InvoiceRepository } from "./InvoiceRepository";

export class InvoiceService {
  constructor(
    private readonly repository: InvoiceRepository,
    private readonly manager: InvoiceManager,
  ) {}

  sendInvoice(invoiceId: string) {
    const invoice = this.repository.findById(invoiceId);
    return this.manager.markSent(invoice);
  }
}
