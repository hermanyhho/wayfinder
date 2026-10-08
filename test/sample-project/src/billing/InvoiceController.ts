import { InvoiceService } from "./InvoiceService";

export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  send(invoiceId: string) {
    return this.invoices.sendInvoice(invoiceId);
  }
}
