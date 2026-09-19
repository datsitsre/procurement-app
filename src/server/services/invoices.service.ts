import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { toInvoiceDto } from '@/server/dto/invoices';
import { toPage, type PaginationParams } from '@/server/pagination';
import type { Page, ServiceResult, UUID } from '@/types/common';
import type { Invoice, Order, PaymentMethod } from '@/types/orders';
import type { CreditTerm } from '@/types/company';
import type { Prisma, PrismaClient } from '@prisma/client';

/** Every status that still represents money owed - never PAID, VOID (written off), or DRAFT
 *  (not yet issued). Used by both the aging summary and the "needs attention" list, so the two
 *  can never define "outstanding" differently from each other. */
const OUTSTANDING_STATUSES = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] as const;

export interface InvoiceAgingSummary {
  current: number;
  overdue1to30: number;
  overdue31to60: number;
  overdue61to90: number;
  overdue90plus: number;
  total: number;
  count: number;
  overdueCount: number;
  overdueAmount: number;
}

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

/** Paginated (Phase 19, section 1) - a buyer's invoice history grows with every checkout/credit-
 *  term order and has no natural upper bound over a multi-year account, the same shape as
 *  `listOrders`. Tenant filtering happens inside the same query as pagination, never after. */
export async function listInvoices(companyId: UUID, pagination: PaginationParams): Promise<ServiceResult<Page<Invoice>>> {
  const [invoices, total] = await Promise.all([
    db.invoice.findMany({ where: { companyId }, orderBy: { issuedAt: 'desc' }, include: INVOICE_INCLUDE, skip: pagination.skip, take: pagination.take }),
    db.invoice.count({ where: { companyId } }),
  ]);
  return ok(toPage(invoices.map(toInvoiceDto), total, pagination));
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

export async function listInvoicesForSupplier(supplierId: UUID, pagination: PaginationParams): Promise<ServiceResult<Page<Invoice>>> {
  const [invoices, total] = await Promise.all([
    db.invoice.findMany({ where: { supplierId }, orderBy: { issuedAt: 'desc' }, include: INVOICE_INCLUDE, skip: pagination.skip, take: pagination.take }),
    db.invoice.count({ where: { supplierId } }),
  ]);
  return ok(toPage(invoices.map(toInvoiceDto), total, pagination));
}

/** Ages the still-owed portion of every outstanding invoice by days past `dueDate` (Phase 19,
 *  section 1) - the server-side counterpart to the client's own `ageInvoices` (balance-sheet
 *  page), now computed from a real, bounded query instead of the *entire* unpaginated invoice
 *  history. Bounded by nature, not by luck: "still outstanding" invoices are a small working set
 *  for any real business (thousands of simultaneously-unpaid invoices would mean the business
 *  itself is failing), unlike the full historical invoice list this replaces reading from. */
function ageInvoiceRows(rows: { total: Prisma.Decimal; amountPaid: Prisma.Decimal; dueDate: Date }[]): InvoiceAgingSummary {
  const now = Date.now();
  const summary: InvoiceAgingSummary = {
    current: 0,
    overdue1to30: 0,
    overdue31to60: 0,
    overdue61to90: 0,
    overdue90plus: 0,
    total: 0,
    count: 0,
    overdueCount: 0,
    overdueAmount: 0,
  };

  for (const row of rows) {
    const owed = Number(row.total) - Number(row.amountPaid);
    if (owed <= 0) continue;
    summary.count += 1;
    summary.total += owed;

    const daysOverdue = Math.floor((now - row.dueDate.getTime()) / (24 * 60 * 60 * 1000));
    if (daysOverdue <= 0) {
      summary.current += owed;
      continue;
    }
    summary.overdueCount += 1;
    summary.overdueAmount += owed;
    if (daysOverdue <= 30) summary.overdue1to30 += owed;
    else if (daysOverdue <= 60) summary.overdue31to60 += owed;
    else if (daysOverdue <= 90) summary.overdue61to90 += owed;
    else summary.overdue90plus += owed;
  }
  return summary;
}

export async function getInvoiceAgingSummary(companyId: UUID): Promise<ServiceResult<InvoiceAgingSummary>> {
  const rows = await db.invoice.findMany({
    where: { companyId, status: { in: [...OUTSTANDING_STATUSES] } },
    select: { total: true, amountPaid: true, dueDate: true },
  });
  return ok(ageInvoiceRows(rows));
}

export async function getInvoiceAgingSummaryForSupplier(supplierId: UUID): Promise<ServiceResult<InvoiceAgingSummary>> {
  const rows = await db.invoice.findMany({
    where: { supplierId, status: { in: [...OUTSTANDING_STATUSES] } },
    select: { total: true, amountPaid: true, dueDate: true },
  });
  return ok(ageInvoiceRows(rows));
}

/** The finance dashboard's own "needs attention" list (Phase 19) - the soonest-due outstanding
 *  invoices, real `orderBy`+`take` at the database layer, never a slice of the full history. */
export async function getInvoicesNeedingAttention(companyId: UUID, limit = 6): Promise<ServiceResult<Invoice[]>> {
  const invoices = await db.invoice.findMany({
    where: { companyId, status: { in: [...OUTSTANDING_STATUSES] } },
    orderBy: { dueDate: 'asc' },
    take: limit,
    include: INVOICE_INCLUDE,
  });
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
 *  `amountPaid`/`status` from the resulting charge.
 *
 *  A charge is not always settled by the time this returns - a real mobile money gateway
 *  accepts a "request to pay" and only confirms it later, via webhook or the reconciliation job
 *  (see PaymentProvider.ts's own comment on this). While one is still outstanding for this
 *  invoice, a second call here is refused rather than starting a second charge attempt for the
 *  same amount due - this is what keeps a buyer re-opening the pay form (which today has no
 *  idempotency key of its own to dedupe on; see the frontend follow-up in the final report)
 *  from double-charging themselves while their first mobile money prompt is still pending. */
export async function payInvoice(invoiceId: UUID, method: PaymentMethod, details: Record<string, string>, idempotencyKey?: string): Promise<ServiceResult<Invoice>> {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: INVOICE_INCLUDE });
  if (!invoice) return fail('NOT_FOUND', 'That invoice could not be found.');
  if (invoice.status === 'PAID') return fail('ALREADY_PAID', 'This invoice is already paid in full.');

  const pendingPayment = await db.payment.findFirst({ where: { invoiceId, status: 'PENDING' } });
  if (pendingPayment) {
    return fail('PAYMENT_PENDING', 'A payment for this invoice is already awaiting confirmation. Please wait for it to complete before trying again.');
  }

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

  // Accepted but not yet settled (real mobile money) - leave the invoice as-is. Its status/
  // amountPaid only move once processPaymentWebhook or the reconciliation job confirms this
  // specific Payment as PAID.
  if (result.data.status === 'PENDING') return ok(toInvoiceDto(invoice));

  const updated = await db.invoice.update({
    where: { id: invoiceId },
    data: { amountPaid: invoice.total, status: 'PAID' },
    include: INVOICE_INCLUDE,
  });

  const updatedDto = toInvoiceDto(updated);
  const supplier = await db.supplierProfile.findUnique({ where: { id: invoice.supplierId } });
  if (supplier) {
    const { notifyCompanyRoles } = await import('./notification.service');
    await notifyCompanyRoles(supplier.companyId, ['SUPPLIER_ADMIN'], {
      type: 'PAYMENT_RECEIVED',
      title: `Payment received for ${updatedDto.reference}`,
      body: `GH₵${updatedDto.total.toLocaleString()} paid in full.`,
      entityId: updated.id,
      entityHref: `/invoices/${updated.id}`,
    });
  }

  return ok(updatedDto);
}
