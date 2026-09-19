import 'server-only';
import { db } from '@/server/db';
import { notifyCompanyRoles } from '@/server/services/notification.service';

const DEDUPE_WINDOW_HOURS = 24;

/**
 * Background job (Phase 14 deployment-readiness follow-up to Stage 9, which defined the
 * LOW_STOCK notification type but left it unwired pending a job that hadn't been built yet).
 * Meant to run on a schedule (an external cron hitting POST /api/cron/low-stock-sweep).
 *
 * Finds every inventory record at or below its own configured low-stock threshold (0 is treated
 * as "no threshold configured", never alerted on) and notifies the supplier's admins - skipping
 * a product/warehouse pair that already got a LOW_STOCK notification in the last 24 hours, so
 * running this job hourly doesn't spam the same still-low shelf every single run.
 */
export async function runLowStockSweep(): Promise<{ alertsSent: number }> {
  const lowStock = await db.inventoryRecord.findMany({
    where: { lowStockThreshold: { gt: 0 } },
    include: { product: { select: { id: true, name: true, supplierId: true } }, warehouse: { select: { name: true } } },
  });

  const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000);
  let alertsSent = 0;

  for (const record of lowStock) {
    const available = record.stock - record.reserved;
    if (available > record.lowStockThreshold) continue;

    const recentAlert = await db.notification.findFirst({
      where: { type: 'LOW_STOCK', entityId: record.product.id, createdAt: { gte: dedupeSince } },
    });
    if (recentAlert) continue;

    const supplier = await db.supplierProfile.findUnique({ where: { id: record.product.supplierId }, select: { companyId: true } });
    if (!supplier) continue;

    await notifyCompanyRoles(supplier.companyId, ['SUPPLIER_ADMIN'], {
      type: 'LOW_STOCK',
      title: `${record.product.name} is running low`,
      body: `Only ${available} available at ${record.warehouse.name} (threshold: ${record.lowStockThreshold}).`,
      entityId: record.product.id,
      entityHref: '/products',
    });
    alertsSent += 1;
  }

  return { alertsSent };
}
