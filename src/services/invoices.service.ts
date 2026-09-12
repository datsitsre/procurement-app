import { delay, ok } from './base';
import { demoInvoices } from '@/lib/demo-data/invoices';
import type { ServiceResult, UUID } from '@/types/common';
import type { Invoice } from '@/types/orders';

export interface InvoicesService {
  listInvoices(companyId: UUID): Promise<ServiceResult<Invoice[]>>;
}

class MockInvoicesService implements InvoicesService {
  async listInvoices(companyId: UUID): Promise<ServiceResult<Invoice[]>> {
    await delay(250);
    return ok(
      demoInvoices
        .filter((i) => i.companyId === companyId)
        .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1)),
    );
  }
}

export const invoicesService: InvoicesService = new MockInvoicesService();
