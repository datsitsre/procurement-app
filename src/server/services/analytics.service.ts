import 'server-only';
import { db } from '@/server/db';
import { ok } from '@/services/base';
import type { ServiceResult, UUID } from '@/types/common';
import type { BuyerAnalytics, OrderStatusBreakdown, PlatformAnalytics, SupplierAnalytics } from '@/types/analytics';
import type { ChartPoint } from '@/components/ui/BarChart';
import type { OrderStatus, Prisma } from '@prisma/client';

/**
 * The real, database-backed counterpart to src/services/analytics.service.ts's mock (Phase 14,
 * Stage 10). The mock computed these same aggregates by fetching whole entity lists through
 * *other* already-migrated services (an HTTP round trip each) and reducing them in the browser -
 * a real N+1 pattern once those services were backed by the network instead of an in-memory
 * array (section 26). Every report here is one (or a small, fixed number of) database query
 * instead, aggregated server-side.
 */

const MONTHS_TRACKED = 6;

/** The last N calendar months as {key, label} pairs, oldest first - every trend chart in this
 *  service buckets into these same months so a buyer's spend chart and a supplier's revenue
 *  chart read the same way. Ported unchanged from the client mock. */
function recentMonths(count: number): { key: string; label: string }[] {
  const months: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-GB', { month: 'short' }) });
  }
  return months;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function bucketByMonth<T extends { createdAt: Date }>(orders: T[], amountOf: (o: T) => number): ChartPoint[] {
  const months = recentMonths(MONTHS_TRACKED);
  const totals = new Map(months.map((m) => [m.key, 0]));
  for (const order of orders) {
    const key = monthKey(order.createdAt);
    if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + amountOf(order));
  }
  return months.map((m) => ({ label: m.label, value: Math.round(totals.get(m.key) ?? 0) }));
}

function topN(entries: Map<string, number>, n: number): ChartPoint[] {
  return Array.from(entries.entries())
    .map(([label, value]) => ({ label, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

function statusBreakdown(orders: { status: OrderStatus }[]): OrderStatusBreakdown[] {
  const counts = new Map<OrderStatus, number>();
  for (const order of orders) counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
  return Array.from(counts.entries()).map(([status, count]) => ({ status, count }));
}

const ORDER_ANALYTICS_INCLUDE = { items: { include: { product: { select: { basePrice: true } } } } } satisfies Prisma.OrderInclude;

export async function getBuyerAnalytics(companyId: UUID): Promise<ServiceResult<BuyerAnalytics>> {
  const [orders, costCenters] = await Promise.all([
    db.order.findMany({ where: { companyId }, include: { ...ORDER_ANALYTICS_INCLUDE, supplier: { select: { name: true } } } }),
    db.costCenter.findMany({ where: { companyId }, select: { id: true, code: true } }),
  ]);
  const costCenterLabel = new Map(costCenters.map((c) => [c.id, c.code]));
  const paidOrders = orders.filter((o) => o.paymentStatus === 'PAID');

  const spendBySupplierMap = new Map<string, number>();
  const spendByDepartmentMap = new Map<string, number>();
  const spendByCostCenterMap = new Map<string, number>();
  for (const order of paidOrders) {
    const total = Number(order.total);
    spendBySupplierMap.set(order.supplier.name, (spendBySupplierMap.get(order.supplier.name) ?? 0) + total);
    if (order.department) {
      spendByDepartmentMap.set(order.department, (spendByDepartmentMap.get(order.department) ?? 0) + total);
    }
    if (order.costCenterId) {
      const label = costCenterLabel.get(order.costCenterId) ?? order.costCenterId;
      spendByCostCenterMap.set(label, (spendByCostCenterMap.get(label) ?? 0) + total);
    }
  }

  let estimatedSavings = 0;
  for (const order of orders) {
    for (const item of order.items) {
      estimatedSavings += Math.max(0, (Number(item.product.basePrice) - Number(item.unitPrice)) * item.quantity);
    }
  }

  return ok({
    monthlySpend: bucketByMonth(paidOrders, (o) => Number(o.total)),
    spendBySupplier: topN(spendBySupplierMap, 5),
    spendByDepartment: topN(spendByDepartmentMap, 10),
    spendByCostCenter: topN(spendByCostCenterMap, 10),
    ordersByStatus: statusBreakdown(orders),
    estimatedSavings: Math.round(estimatedSavings),
    totalOrders: orders.length,
    totalSpend: paidOrders.reduce((sum, o) => sum + Number(o.total), 0),
  });
}

export async function getSupplierAnalytics(supplierId: UUID): Promise<ServiceResult<SupplierAnalytics>> {
  const [orders, quotes] = await Promise.all([
    db.order.findMany({ where: { supplierId }, include: { company: { select: { name: true } } } }),
    db.quote.findMany({ where: { supplierId }, select: { id: true, rfq: { select: { acceptedQuoteId: true } } } }),
  ]);
  const paidOrders = orders.filter((o) => o.paymentStatus === 'PAID');

  const revenueByBuyerMap = new Map<string, number>();
  for (const order of paidOrders) {
    revenueByBuyerMap.set(order.company.name, (revenueByBuyerMap.get(order.company.name) ?? 0) + Number(order.total));
  }

  const quotesWon = quotes.filter((q) => q.rfq.acceptedQuoteId === q.id).length;

  return ok({
    monthlyRevenue: bucketByMonth(paidOrders, (o) => Number(o.total)),
    revenueByBuyer: topN(revenueByBuyerMap, 5),
    ordersByStatus: statusBreakdown(orders),
    quotesSubmitted: quotes.length,
    quotesWon,
    totalOrders: orders.length,
    totalRevenue: paidOrders.reduce((sum, o) => sum + Number(o.total), 0),
  });
}

/** Every order across every company - the platform admin overview (section 46). */
export async function getPlatformAnalytics(): Promise<ServiceResult<PlatformAnalytics>> {
  const [orders, disputeCount] = await Promise.all([
    db.order.findMany({ include: { supplier: { select: { name: true } }, company: { select: { name: true } } } }),
    db.dispute.count(),
  ]);
  const paidOrders = orders.filter((o) => o.paymentStatus === 'PAID');

  const gmvBySupplierMap = new Map<string, number>();
  const gmvByBuyerMap = new Map<string, number>();
  for (const order of paidOrders) {
    gmvBySupplierMap.set(order.supplier.name, (gmvBySupplierMap.get(order.supplier.name) ?? 0) + Number(order.total));
    gmvByBuyerMap.set(order.company.name, (gmvByBuyerMap.get(order.company.name) ?? 0) + Number(order.total));
  }

  const deliveredCount = orders.filter((o) => o.status === 'DELIVERED' || o.status === 'PARTIALLY_DELIVERED').length;
  const disputeRate = deliveredCount === 0 ? 0 : disputeCount / deliveredCount;

  return ok({
    monthlyGmv: bucketByMonth(paidOrders, (o) => Number(o.total)),
    gmvBySupplier: topN(gmvBySupplierMap, 5),
    gmvByBuyerCompany: topN(gmvByBuyerMap, 5),
    disputeRate,
    totalOrders: orders.length,
    totalGmv: paidOrders.reduce((sum, o) => sum + Number(o.total), 0),
  });
}
