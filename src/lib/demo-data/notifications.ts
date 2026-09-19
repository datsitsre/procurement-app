import type { Notification } from '@/types/notification';

export const demoNotifications: Notification[] = [
  {
    id: 'notif-1',
    userId: 'user-john-doe',
    type: 'QUOTE_RECEIVED',
    title: 'Supplier responded to RFQ-10082',
    body: 'ABC Technology Solutions submitted a quote.',
    entityHref: '/rfqs/rfq-10082',
    read: false,
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
  {
    id: 'notif-2',
    userId: 'user-john-doe',
    type: 'APPROVAL_REQUESTED',
    title: 'Purchase request requires approval',
    body: 'PR-10082 (₵477,750) is waiting on Finance.',
    entityHref: '/approvals',
    read: false,
    createdAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  },
  {
    id: 'notif-3',
    userId: 'user-john-doe',
    type: 'ORDER_SHIPPED',
    title: 'Order #10072 shipped',
    body: 'Expected delivery in 2-3 business days.',
    entityHref: '/orders/order-10072',
    read: true,
    createdAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
  },
];
