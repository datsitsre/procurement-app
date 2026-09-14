import { apiRequest } from './base';
import type { ServiceResult, UUID } from '@/types/common';
import type { Cart } from '@/types/cart';

export interface CartService {
  getCart(companyId: UUID): Promise<ServiceResult<Cart>>;
  setQuantity(companyId: UUID, productId: UUID, quantity: number): Promise<ServiceResult<Cart>>;
  removeItem(companyId: UUID, productId: UUID): Promise<ServiceResult<Cart>>;
  clear(companyId: UUID): Promise<ServiceResult<Cart>>;
}

/**
 * Calls the real `/api/companies/[companyId]/cart` backend (Phase 14, Stage 7) - one Cart row
 * per company, same shape and MOQ/tier-pricing rules as the mock it replaces.
 */
class ApiCartService implements CartService {
  async getCart(companyId: UUID): Promise<ServiceResult<Cart>> {
    return apiRequest<Cart>(`/api/companies/${companyId}/cart`);
  }

  async setQuantity(companyId: UUID, productId: UUID, quantity: number): Promise<ServiceResult<Cart>> {
    return apiRequest<Cart>(`/api/companies/${companyId}/cart/items/${productId}`, { method: 'PUT', body: JSON.stringify({ quantity }) });
  }

  async removeItem(companyId: UUID, productId: UUID): Promise<ServiceResult<Cart>> {
    return apiRequest<Cart>(`/api/companies/${companyId}/cart/items/${productId}`, { method: 'DELETE' });
  }

  async clear(companyId: UUID): Promise<ServiceResult<Cart>> {
    return apiRequest<Cart>(`/api/companies/${companyId}/cart`, { method: 'DELETE' });
  }
}

export const cartService: CartService = new ApiCartService();
