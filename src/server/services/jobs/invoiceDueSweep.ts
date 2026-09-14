import 'server-only';
import { db } from '@/server/db';
import { notifyCompanyRoles } from '@/server/services/notification.service';

/**
 * Background job (Phase 14 deployment-readiness follow-up to Stage 9, which defined the
 * INVOICE_DUE notification type but left it unwired pending a job that hadn't been built yet).
 * Meant to run on a schedule (an external cron hitting POST /api/cron/invoice-due-sweep) rather
 * than in-process - nothing in this app's own request/response cycle should block on a sweep
 * over every open invoice.
 *
 * Finds every PENDING invoice whose due date has passed, flips it to OVERDUE (a real state
 * transition this app never computed anywhere before - the one seeded OVERDUE invoice was set
 * by hand in prisma/seed.ts, not derived), and notifies the billed company's finance/ownership
 * roles once per invoice per run.
 *
 * Each flip is a conditional `updateMany` (still PENDING, not a plain update-by-id) so two
 * overlapping runs - or this same invoice disappearing between the scan and the write - can
 * never throw; a row that's no longer PENDING by the time we get to it is just skipped rather
 * than counted or notified on twice.
 */
export async function runInvoiceDueSweep(): Promise<{ markedOverdue: number }> {
  const overdueInvoices = await db.invoice.findMany({
    where: { status: 'PENDING', dueDate: { lt: new Date() } },
    include: { supplier: { select: { name: true } } },
  });

  let markedOverdue = 0;
  for (const invoice of overdueInvoices) {
    const { count } = await db.invoice.updateMany({ where: { id: invoice.id, status: 'PENDING' }, data: { status: 'OVERDUE' } });
    if (count === 0) continue;

    markedOverdue += 1;
    await notifyCompanyRoles(invoice.companyId, ['OWNER', 'ADMIN', 'FINANCE_MANAGER'], {
      type: 'INVOICE_DUE',
      title: `Invoice ${invoice.reference} is overdue`,
      body: `${invoice.supplier.name} - GH₵${Number(invoice.total).toLocaleString()} was due ${invoice.dueDate.toDateString()}.`,
      entityId: invoice.id,
      entityHref: `/invoices/${invoice.id}`,
    });
  }

  return { markedOverdue };
}
