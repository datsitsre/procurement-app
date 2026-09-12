import { delay, ok } from './base';
import { ordersService } from './orders.service';
import { catalogService } from './catalog.service';
import { procurementService } from './procurement.service';
import { disputesService } from './disputes.service';
import { companyService } from './company.service';
import { allCompanies } from './auth.service';
import type { ServiceResult, UUID } from '@/types/common';
import type { Order } from '@/types/orders';
import type { ChartPoint } from '@/components/ui/BarChart';

const MONTHS_TRACKED = 6;

/** The last N calendar months as {key, label} pairs, oldest first - every trend chart in this
 *  service buckets into these same months so a buyer's spend chart and a supplier's revenue
 *  chart read the same way. */
function recentMonths(count: number): { key: string; label: string }[] {
  const months: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleDateString('en-GB', { month: 'short' }),
    });
  }
  return months;
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function bucketByMonth(orders: Order[], amountOf: (o: Order) => number): ChartPoint[] {
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

export interface OrderStatusBreakdown {
  status: Order['status'];
  count: number;
}

function statusBreakdown(orders: Order[]): OrderStatusBreakdown[] {
  const counts = new Map<Order['status'], number>();
  for (const order of orders) counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
  return Array.from(counts.entries()).map(([status, count]) => ({ status, count }));
}

export interface BuyerAnalytics {
  monthlySpend: ChartPoint[];
  spendBySupplier: ChartPoint[];
  /** Spend bucketed by the requester's department at the time of the purchase request
   *  (section 10.2/23) - only orders that trace back to a purchase request carry a
   *  department, so an order placed by direct RFQ-acceptance has no department to bucket into. */
  spendByDepartment: ChartPoint[];
  /** Spend bucketed by cost center (section 10.3/23) - same caveat as spendByDepartment. */
  spendByCostCenter: ChartPoint[];
  ordersByStatus: OrderStatusBreakdown[];
  estimatedSavings: number;
  totalOrders: number;
  totalSpend: number;
}

export interface SupplierAnalytics {
  monthlyRevenue: ChartPoint[];
  revenueByBuyer: ChartPoint[];
  ordersByStatus: OrderStatusBreakdown[];
  quotesSubmitted: number;
  quotesWon: number;
  totalOrders: number;
  totalRevenue: number;
}

export interface PlatformAnalytics {
  monthlyGmv: ChartPoint[];
  gmvBySupplier: ChartPoint[];
  gmvByBuyerCompany: ChartPoint[];
  disputeRate: number;
  totalOrders: number;
  totalGmv: number;
}

export interface AnalyticsService {
  getBuyerAnalytics(companyId: UUID): Promise<ServiceResult<BuyerAnalytics>>;
  getSupplierAnalytics(supplierId: UUID): Promise<ServiceResult<SupplierAnalytics>>;
  getPlatformAnalytics(): Promise<ServiceResult<PlatformAnalytics>>;
}

class MockAnalyticsService implements AnalyticsService {
  async getBuyerAnalytics(companyId: UUID): Promise<ServiceResult<BuyerAnalytics>> {
    await delay(300);
    const ordersResult = await ordersService.listOrders(companyId);
    const orders = ordersResult.ok ? ordersResult.data : [];
    const paidOrders = orders.filter((o) => o.paymentStatus === 'PAID');

    const spendBySupplierMap = new Map<string, number>();
    const spendByDepartmentMap = new Map<string, number>();
    const spendByCostCenterMap = new Map<string, number>();
    const costCentersResult = await companyService.listCostCenters(companyId);
    const costCenters = costCentersResult.ok ? costCentersResult.data : [];
    for (const order of paidOrders) {
      spendBySupplierMap.set(order.supplierName, (spendBySupplierMap.get(order.supplierName) ?? 0) + order.total);
      if (order.department) {
        spendByDepartmentMap.set(order.department, (spendByDepartmentMap.get(order.department) ?? 0) + order.total);
      }
      if (order.costCenterId) {
        const label = costCenters.find((c) => c.id === order.costCenterId)?.code ?? order.costCenterId;
        spendByCostCenterMap.set(label, (spendByCostCenterMap.get(label) ?? 0) + order.total);
      }
    }

    // Fetched in parallel rather than one `await` per line item in sequence - with the mock
    // services' simulated network delay, awaiting each lookup one at a time would make this
    // scale linearly with order-item count instead of resolving in one round trip's worth of
    // latency.
    const items = orders.flatMap((order) => order.items);
    const productResults = await Promise.all(items.map((item) => catalogService.getProductById(item.productId)));
    let estimatedSavings = 0;
    items.forEach((item, i) => {
      const productResult = productResults[i];
      if (!productResult.ok) return;
      estimatedSavings += Math.max(0, (productResult.data.basePrice - item.unitPrice) * item.quantity);
    });

    return ok({
      monthlySpend: bucketByMonth(paidOrders, (o) => o.total),
      spendBySupplier: topN(spendBySupplierMap, 5),
      spendByDepartment: topN(spendByDepartmentMap, 10),
      spendByCostCenter: topN(spendByCostCenterMap, 10),
      ordersByStatus: statusBreakdown(orders),
      estimatedSavings: Math.round(estimatedSavings),
      totalOrders: orders.length,
      totalSpend: paidOrders.reduce((sum, o) => sum + o.total, 0),
    });
  }

  async getSupplierAnalytics(supplierId: UUID): Promise<ServiceResult<SupplierAnalytics>> {
    await delay(300);
    const ordersResult = await ordersService.listOrdersForSupplier(supplierId);
    const orders = ordersResult.ok ? ordersResult.data : [];
    const paidOrders = orders.filter((o) => o.paymentStatus === 'PAID');

    const revenueByBuyerMap = new Map<string, number>();
    for (const order of paidOrders) {
      const buyerName = allCompanies().find((c) => c.id === order.companyId)?.name ?? 'Buyer';
      revenueByBuyerMap.set(buyerName, (revenueByBuyerMap.get(buyerName) ?? 0) + order.total);
    }

    const quotesResult = await procurementService.listQuotesForSupplier(supplierId);
    const quotes = quotesResult.ok ? quotesResult.data : [];
    // Parallel, for the same reason as getBuyerAnalytics's product lookups above.
    // Trusted internal aggregation, already scoped to this supplier's own quotes above - not a
    // URL-driven fetch, so it bypasses getRfq's tenant-ownership check the same deliberate way
    // audit-log.service's `record` bypasses its own permission check (see that file's comment).
    const rfqResults = await Promise.all(quotes.map((q) => procurementService.getRfq(q.rfqId, { isPlatformAdmin: true })));
    const quotesWon = quotes.filter((q, i) => rfqResults[i].ok && rfqResults[i].data.acceptedQuoteId === q.id).length;

    return ok({
      monthlyRevenue: bucketByMonth(paidOrders, (o) => o.total),
      revenueByBuyer: topN(revenueByBuyerMap, 5),
      ordersByStatus: statusBreakdown(orders),
      quotesSubmitted: quotes.length,
      quotesWon,
      totalOrders: orders.length,
      totalRevenue: paidOrders.reduce((sum, o) => sum + o.total, 0),
    });
  }

  async getPlatformAnalytics(): Promise<ServiceResult<PlatformAnalytics>> {
    await delay(300);
    const ordersResult = await ordersService.listAllOrders();
    const orders = ordersResult.ok ? ordersResult.data : [];
    const paidOrders = orders.filter((o) => o.paymentStatus === 'PAID');

    const gmvBySupplierMap = new Map<string, number>();
    const gmvByBuyerMap = new Map<string, number>();
    for (const order of paidOrders) {
      gmvBySupplierMap.set(order.supplierName, (gmvBySupplierMap.get(order.supplierName) ?? 0) + order.total);
      const buyerName = allCompanies().find((c) => c.id === order.companyId)?.name ?? 'Buyer';
      gmvByBuyerMap.set(buyerName, (gmvByBuyerMap.get(buyerName) ?? 0) + order.total);
    }

    const disputesResult = await disputesService.listAllDisputes();
    const disputes = disputesResult.ok ? disputesResult.data : [];
    const deliveredOrders = orders.filter((o) => o.status === 'DELIVERED' || o.status === 'PARTIALLY_DELIVERED');
    const disputeRate = deliveredOrders.length === 0 ? 0 : disputes.length / deliveredOrders.length;

    return ok({
      monthlyGmv: bucketByMonth(paidOrders, (o) => o.total),
      gmvBySupplier: topN(gmvBySupplierMap, 5),
      gmvByBuyerCompany: topN(gmvByBuyerMap, 5),
      disputeRate,
      totalOrders: orders.length,
      totalGmv: paidOrders.reduce((sum, o) => sum + o.total, 0),
    });
  }
}

export const analyticsService: AnalyticsService = new MockAnalyticsService();
