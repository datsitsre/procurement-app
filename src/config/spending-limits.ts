import { Role } from './rbac';

/**
 * Default per-role maximum single-purchase-request amount (section 11.5) - e.g. an Employee
 * can submit a request up to ₵8,000 before someone with a higher limit needs to submit it
 * instead. A role with no entry here (OWNER, ADMIN, ...) has no limit at all.
 *
 * Every request total already includes the flat delivery fee (see pricing.ts's
 * FLAT_DELIVERY_FEE, currently ₵2,000) plus tax on top of the subtotal - a limit at or below
 * that fee would block every request regardless of subtotal, so the lowest limit here must
 * clear it by a comfortable margin.
 *
 * This is a business rule layered on top of RBAC, never a substitute for it: a role still needs
 * PURCHASE_REQUEST_CREATE to submit anything in the first place (see rbac.ts) - this only caps
 * *how much* a request from that role may total, checked in
 * procurement.service.ts#createPurchaseRequest after that permission check has already passed.
 * A company can override any of these via company.service.ts's spending-limit methods; this map
 * is only the fallback when no override exists.
 */
export const DefaultSpendingLimits: Partial<Record<Role, number>> = {
  [Role.EMPLOYEE]: 8000,
  [Role.BUYER]: 20000,
  [Role.PROCUREMENT_MANAGER]: 75000,
  [Role.FINANCE_MANAGER]: 150000,
  [Role.APPROVER]: 75000,
};
