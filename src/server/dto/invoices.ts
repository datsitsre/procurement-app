import 'server-only';
import type { Invoice, InvoiceItem, Payment } from '@/types/orders';
import type {
  Invoice as PrismaInvoice,
  InvoiceItem as PrismaInvoiceItem,
  Payment as PrismaPayment,
  SupplierProfile,
} from '@prisma/client';

/** Maps Prisma's generated Invoice/Payment models to the exact frontend types
 *  (src/types/orders.ts) - Decimal -> number, Date -> ISO string, null -> undefined, and a
 *  joined SupplierProfile for `supplierName` (not a stored column), never a raw ORM entity
 *  crossing the API boundary. */

export function toInvoiceItemDto(i: PrismaInvoiceItem): InvoiceItem {
  return { id: i.id, description: i.description, quantity: i.quantity, unitPrice: Number(i.unitPrice) };
}

type InvoiceWithRelations = PrismaInvoice & { items: PrismaInvoiceItem[]; supplier: SupplierProfile };

export function toInvoiceDto(inv: InvoiceWithRelations): Invoice {
  return {
    id: inv.id,
    reference: inv.reference,
    companyId: inv.companyId,
    supplierId: inv.supplierId,
    supplierName: inv.supplier.name,
    orderId: inv.orderId ?? undefined,
    purchaseOrderReference: inv.purchaseOrderReference ?? undefined,
    items: inv.items.map(toInvoiceItemDto),
    subtotal: Number(inv.subtotal),
    tax: Number(inv.tax),
    total: Number(inv.total),
    amountPaid: Number(inv.amountPaid),
    status: inv.status,
    dueDate: inv.dueDate.toISOString(),
    issuedAt: inv.issuedAt.toISOString(),
  };
}

export function toPaymentDto(p: PrismaPayment): Payment {
  return {
    id: p.id,
    companyId: p.companyId,
    supplierId: p.supplierId ?? undefined,
    invoiceId: p.invoiceId ?? undefined,
    orderId: p.orderId ?? undefined,
    amount: Number(p.amount),
    method: p.method,
    status: p.status,
    reference: p.reference,
    createdAt: p.createdAt.toISOString(),
  };
}
