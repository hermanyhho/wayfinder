export interface Invoice {
  id: string;
  sentAt?: string;
}

export class InvoiceRepository {
  findById(invoiceId: string): Invoice {
    return { id: invoiceId };
  }

  save(invoice: Invoice): Invoice {
    return invoice;
  }
}
