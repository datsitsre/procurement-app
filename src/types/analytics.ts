import type { OrderStatus } from './status';
import type { ChartPoint } from '@/components/ui/BarChart';

export interface OrderStatusBreakdown {
  status: OrderStatus;
  count: number;
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
