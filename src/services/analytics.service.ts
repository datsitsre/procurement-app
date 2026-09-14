import { apiRequest } from './base';
import type { ServiceResult, UUID } from '@/types/common';
import type { BuyerAnalytics, OrderStatusBreakdown, PlatformAnalytics, SupplierAnalytics } from '@/types/analytics';

export type { BuyerAnalytics, OrderStatusBreakdown, PlatformAnalytics, SupplierAnalytics };

export interface AnalyticsService {
  getBuyerAnalytics(companyId: UUID): Promise<ServiceResult<BuyerAnalytics>>;
  getSupplierAnalytics(supplierId: UUID): Promise<ServiceResult<SupplierAnalytics>>;
  getPlatformAnalytics(): Promise<ServiceResult<PlatformAnalytics>>;
}

/**
 * Calls the real `/api/{companies/[companyId],suppliers/[supplierId]}/analytics` and
 * `/api/analytics` backend (Phase 14, Stage 10). The mock computed these same reports by
 * fetching whole entity lists through other services and reducing them in the browser - a real
 * N+1 pattern once those services were network-backed; every report is now one server-side
 * aggregation instead (server/services/analytics.service.ts).
 */
class ApiAnalyticsService implements AnalyticsService {
  async getBuyerAnalytics(companyId: UUID): Promise<ServiceResult<BuyerAnalytics>> {
    return apiRequest<BuyerAnalytics>(`/api/companies/${companyId}/analytics`);
  }

  async getSupplierAnalytics(supplierId: UUID): Promise<ServiceResult<SupplierAnalytics>> {
    return apiRequest<SupplierAnalytics>(`/api/suppliers/${supplierId}/analytics`);
  }

  async getPlatformAnalytics(): Promise<ServiceResult<PlatformAnalytics>> {
    return apiRequest<PlatformAnalytics>('/api/analytics');
  }
}

export const analyticsService: AnalyticsService = new ApiAnalyticsService();
