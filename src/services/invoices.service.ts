import { delay, fail, ok } from './base';
import { demoInvoices } from '@/lib/demo-data/invoices';
import { demoCompanies } from '@/lib/demo-data/companies';
import { paymentService, dueDaysFor } from './payment.service';
import type { Role } from '@/config/rbac';
import type { ServiceResult, UUID } from '@/types/common';
import type { Invoice, Order, PaymentMethod } from '@/types/orders';

const INVOICES_STORE_KEY = 'procurement.invoices.v1';

function newId(prefix: string): UUID {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

/** Overrides keyed by invoice id - lets a payment update a *seeded* demo invoice (e.g. marking
 *  it PAID) without needing to duplicate it into a separate "created" list. */
function readOverrides(): Record<UUID, Invoice> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(INVOICES_STORE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<UUID, Invoice>;
  } catch {
    return {};
  }
}

function writeOverride(invoice: Invoice) {
  if (typeof window === 'undefined') return;
  const store = readOverrides();
  store[invoice.id] = invoice;
  window.localStorage.setItem(INVOICES_STORE_KEY, JSON.stringify(store));
}

function readCreated(): Invoice[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(`${INVOICES_STORE_KEY}.list`);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Invoice[];
  } catch {
    return [];
  }
}

function appendCreated(invoice: Invoice) {
  if (typeof window === 'undefined') return;
  const list = readCreated();
  list.push(invoice);
  window.localStorage.setItem(`${INVOICES_STORE_KEY}.list`, JSON.stringify(list));
}

function allInvoices(): Invoice[] {
  const overrides = readOverrides();
  const seeded = demoInvoices.map((i) => overrides[i.id] ?? i);
  const created = readCreated().map((i) => overrides[i.id] ?? i);
  return [...seeded, ...created];
}

export interface InvoicesService {
  listInvoices(companyId: UUID): Promise<ServiceResult<Invoice[]>>;
  getInvoice(id: UUID): Promise<ServiceResult<Invoice>>;
  getInvoiceForOrder(orderId: UUID): Promise<ServiceResult<Invoice | null>>;
  /** Invoices a supplier has issued (section 44) - the supplier-workspace counterpart to
   *  `listInvoices`, which is keyed by the *buyer's* company id instead. */
  listInvoicesForSupplier(supplierId: UUID): Promise<ServiceResult<Invoice[]>>;
  /** Raises an invoice for a newly-checked-out order (section 30) - due immediately for a
   *  prepaid checkout, or dated out per the company's credit term when paid on terms. */
  createForOrder(order: Order): Promise<Invoice>;
  /** Pays down (or fully settles) an invoice through the payment abstraction, updating
   *  `amountPaid`/`status` from the resulting charge. */
  payInvoice(invoiceId: UUID, method: PaymentMethod, details: Record<string, string>, callerRole: Role): Promise<ServiceResult<Invoice>>;
}

class MockInvoicesService implements InvoicesService {
  async listInvoices(companyId: UUID): Promise<ServiceResult<Invoice[]>> {
    await delay(250);
    return ok(allInvoices().filter((i) => i.companyId === companyId).sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1)));
  }

  async getInvoice(id: UUID): Promise<ServiceResult<Invoice>> {
    await delay(200);
    const invoice = allInvoices().find((i) => i.id === id);
    if (!invoice) return fail('NOT_FOUND', 'That invoice could not be found.');
    return ok(invoice);
  }

  async getInvoiceForOrder(orderId: UUID): Promise<ServiceResult<Invoice | null>> {
    await delay(150);
    return ok(allInvoices().find((i) => i.orderId === orderId) ?? null);
  }

  async listInvoicesForSupplier(supplierId: UUID): Promise<ServiceResult<Invoice[]>> {
    await delay(250);
    return ok(allInvoices().filter((i) => i.supplierId === supplierId).sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1)));
  }

  async createForOrder(order: Order): Promise<Invoice> {
    await delay(250);
    const company = demoCompanies.find((c) => c.id === order.companyId);
    const dueDays = company ? dueDaysFor(company.creditTerms) : 0;
    const now = new Date();
    const paidUpFront = order.paymentStatus === 'PAID';

    const invoice: Invoice = {
      id: newId('invoice'),
      reference: `INV-${Math.floor(10000 + Math.random() * 89999)}`,
      companyId: order.companyId,
      supplierId: order.supplierId,
      supplierName: order.supplierName,
      orderId: order.id,
      items: order.items.map((i) => ({ id: newId('ii'), description: `${i.productName} x${i.quantity}`, quantity: i.quantity, unitPrice: i.unitPrice })),
      subtotal: order.subtotal,
      tax: order.tax,
      total: order.total,
      amountPaid: paidUpFront ? order.total : 0,
      status: paidUpFront ? 'PAID' : 'PENDING',
      dueDate: new Date(now.getTime() + dueDays * 24 * 60 * 60 * 1000).toISOString(),
      issuedAt: now.toISOString(),
    };
    appendCreated(invoice);
    return invoice;
  }

  async payInvoice(
    invoiceId: UUID,
    method: PaymentMethod,
    details: Record<string, string>,
    callerRole: Role,
  ): Promise<ServiceResult<Invoice>> {
    const invoice = allInvoices().find((i) => i.id === invoiceId);
    if (!invoice) return fail('NOT_FOUND', 'That invoice could not be found.');
    if (invoice.status === 'PAID') return fail('ALREADY_PAID', 'This invoice is already paid in full.');

    const amountDue = invoice.total - invoice.amountPaid;
    const result = await paymentService.charge(
      {
        companyId: invoice.companyId,
        supplierId: invoice.supplierId,
        amount: amountDue,
        currency: 'GHS',
        method,
        details,
        invoiceId: invoice.id,
      },
      callerRole,
    );
    if (!result.ok) return fail(result.error.code, result.error.message);

    const updated: Invoice = { ...invoice, amountPaid: invoice.total, status: 'PAID' };
    writeOverride(updated);
    return ok(updated);
  }
}

export const invoicesService: InvoicesService = new MockInvoicesService();
