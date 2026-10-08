import { type Invoice, InvoiceRepository } from "./InvoiceRepository";

export interface InvoiceAuditLog {
  record(invoiceId: string): void;
}

export class InvoiceManager {
  constructor(
    private readonly repository: InvoiceRepository,
    private readonly auditLog: InvoiceAuditLog,
  ) {}

  markSent(invoice: Invoice) {
    this.auditLog.record(invoice.id);
    return this.repository.save({ ...invoice, sentAt: new Date().toISOString() });
  }
}
