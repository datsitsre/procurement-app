import { delay, ok } from './base';
import { demoOrders } from '@/lib/demo-data/orders';
import type { ServiceResult, UUID } from '@/types/common';
import type { Order } from '@/types/orders';

export interface OrdersService {
  listOrders(companyId: UUID): Promise<ServiceResult<Order[]>>;
}

class MockOrdersService implements OrdersService {
  async listOrders(companyId: UUID): Promise<ServiceResult<Order[]>> {
    await delay(250);
    return ok(
      demoOrders
        .filter((o) => o.companyId === companyId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    );
  }
}

export const ordersService: OrdersService = new MockOrdersService();
