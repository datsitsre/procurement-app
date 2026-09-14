import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { toInvoiceDto } from '@/server/dto/invoices';
import type { ServiceResult, UUID } from '@/types/common';
import type { Invoice, Order, PaymentMethod } from '@/types/orders';
import type { CreditTerm } from '@/types/company';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * The real, database-backed counterpart to src/services/invoices.service.ts's mock (Phase 14,
 * Stage 8). `createForOrder` is called by orders.service.ts's own createFromPurchaseOrder, in
 * the same checkout transaction - closing the last client-side hand-off boundary Stage 7 left
 * open (the mock had the checkout page call this itself, right after creating the order).
 */

const INVOICE_INCLUDE = { items: true, supplier: true } satisfies Prisma.InvoiceInclude;

/** How many days out an invoice is due for a given credit term - Net 30 -> 30 days, etc.
 *  Ported unchanged from the client mock's payment.service.ts. */
export function dueDaysFor(term: CreditTerm): number {
  switch (term) {
    case 'NET_7':
      return 7;
    case 'NET_15':
      return 15;
    case 'NET_30':
      return 30;
    case 'NET_60':
      return 60;
    case 'PREPAID':
    default:
      return 0;
  }
}

export async function listInvoices(companyId: UUID): Promise<ServiceResult<Invoice[]>> {
  const invoices = await db.invoice.findMany({ where: { companyId }, orderBy: { issuedAt: 'desc' }, include: INVOICE_INCLUDE });
  return ok(invoices.map(toInvoiceDto));
}

export async function getInvoice(id: UUID): Promise<ServiceResult<Invoice>> {
  const invoice = await db.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
  if (!invoice) return fail('NOT_FOUND', 'That invoice could not be found.');
  return ok(toInvoiceDto(invoice));
}

export async function getInvoiceForOrder(orderId: UUID): Promise<ServiceResult<Invoice | null>> {
  const invoice = await db.invoice.findFirst({ where: { orderId }, include: INVOICE_INCLUDE });
  return ok(invoice ? toInvoiceDto(invoice) : null);
}

export async function listInvoicesForSupplier(supplierId: UUID): Promise<ServiceResult<Invoice[]>> {
  const invoices = await db.invoice.findMany({ where: { supplierId }, orderBy: { issuedAt: 'desc' }, include: INVOICE_INCLUDE });
  return ok(invoices.map(toInvoiceDto));
}

/** Raises an invoice for a newly-checked-out order (section 30) - due immediately for a prepaid
 *  checkout, or dated out per the company's credit term when paid on terms. `client` lets the
 *  caller pass a transaction handle (orders.service.ts's own checkout transaction) so the order
 *  and its invoice are created atomically; defaults to the plain db client for standalone use. */
export async function createForOrder(order: Order, client: Prisma.TransactionClient | PrismaClient = db): Promise<Invoice> {
  const company = await client.company.findUnique({ where: { id: order.companyId } });
  const dueDays = company ? dueDaysFor(company.creditTerms) : 0;
  const now = new Date();
  const paidUpFront = order.paymentStatus === 'PAID';

  const invoice = await client.invoice.create({
    data: {
      reference: `INV-${Math.floor(10000 + Math.random() * 89999)}`,
      companyId: order.companyId,
      supplierId: order.supplierId,
      orderId: order.id,
      subtotal: order.subtotal,
      tax: order.tax,
      total: order.total,
      amountPaid: paidUpFront ? order.total : 0,
      status: paidUpFront ? 'PAID' : 'PENDING',
      dueDate: new Date(now.getTime() + dueDays * 24 * 60 * 60 * 1000),
      issuedAt: now,
      items: {
        create: order.items.map((i) => ({ description: `${i.productName} x${i.quantity}`, quantity: i.quantity, unitPrice: i.unitPrice })),
      },
    },
    include: INVOICE_INCLUDE,
  });
  return toInvoiceDto(invoice);
}

/** Pays down (or fully settles) an invoice through the payment abstraction, updating
 *  `amountPaid`/`status` from the resulting charge. */
export async function payInvoice(invoiceId: UUID, method: PaymentMethod, details: Record<string, string>, idempotencyKey?: string): Promise<ServiceResult<Invoice>> {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: INVOICE_INCLUDE });
  if (!invoice) return fail('NOT_FOUND', 'That invoice could not be found.');
  if (invoice.status === 'PAID') return fail('ALREADY_PAID', 'This invoice is already paid in full.');

  const amountDue = Number(invoice.total) - Number(invoice.amountPaid);
  const { charge } = await import('./payment.service');
  const result = await charge({
    companyId: invoice.companyId,
    supplierId: invoice.supplierId,
    amount: amountDue,
    currency: 'GHS',
    method,
    details,
    invoiceId: invoice.id,
    idempotencyKey,
  });
  if (!result.ok) return fail(result.error.code, result.error.message);

  const updated = await db.invoice.update({
    where: { id: invoiceId },
    data: { amountPaid: invoice.total, status: 'PAID' },
    include: INVOICE_INCLUDE,
  });
  return ok(toInvoiceDto(updated));
}
