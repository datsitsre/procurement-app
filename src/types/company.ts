import type { Address, CountryCode, CurrencyCode, ISODateTime, UUID } from './common';
import type { SupplierProfile } from './catalog';
import type { Role } from '@/config/rbac';

export type CreditTerm = 'PREPAID' | 'NET_7' | 'NET_15' | 'NET_30' | 'NET_60';

/** A buyer or supplier organization. Every company is a tenant - see section 47: no
 *  frontend request or mock-service call is allowed to leak data across `Company.id`. */
export interface Company {
  id: UUID;
  name: string;
  legalName?: string;
  /** Official company registration number (section 10) - distinct from `taxId`, since a
   *  company registers with a corporate registry and separately registers for tax. */
  registrationNumber?: string;
  taxId?: string;
  industry?: string;
  website?: string;
  phone?: string;
  email?: string;
  description?: string;
  country: CountryCode;
  currency: CurrencyCode;
  logoUrl?: string;
  addresses: Address[];
  creditTerms: CreditTerm;
  creditLimit?: number;
  creditAvailable?: number;
  isSupplier: boolean;
  isBuyer: boolean;
  /** This company's own SupplierProfile.id when isSupplier is true - a different id from
   *  Company.id, and the one every supplier-scoped API path actually keys on
   *  (/api/suppliers/[supplierId]/*). Present directly on the session so
   *  useTenantContext (useAuth.tsx) can resolve it synchronously, the same join
   *  server/auth/context.ts's resolveTenant already does server-side - no async catalog
   *  lookup needed for something this load-bearing. */
  supplierProfileId?: UUID;
  /** The full profile, alongside `supplierProfileId` - every page that resolves "my own
   *  supplier profile" (the supplier dashboard, Products & Inventory, ~6 others) needs more
   *  than just the id, and reads it via catalogService.getSupplierByCompanyId, which useAuth.tsx's
   *  AuthProvider primes with this on every session load (primeSupplierCache) - see that
   *  function's own comment for why a lazily-populated cache alone isn't safe for this case. */
  supplierProfile?: SupplierProfile;
  /** Companies operating under the same parent group, for the company switcher (section 10). */
  parentGroupId?: UUID;
  createdAt: ISODateTime;
}

/**
 * A physical location a company operates from (section 10.1) - richer than a plain `Address`:
 * it names who's based there, whether it doubles as a warehouse, and which cost center absorbs
 * its running costs. Deliberately layered on top of `Address` (via `addressId`) rather than
 * replacing it - checkout, purchase orders, and every other existing address picker keep
 * reading `Company.addresses` exactly as before; a Branch is what Company Settings shows on top
 * of that same list, not a second, competing source of truth for "where is this company".
 */
export interface Branch {
  id: UUID;
  companyId: UUID;
  name: string;
  addressId: UUID;
  contactName?: string;
  contactPhone?: string;
  costCenterId?: UUID;
  isWarehouse: boolean;
  isHeadOffice?: boolean;
  createdAt: ISODateTime;
}

/** A named department a company organizes its people into (section 10.2) - the source of truth
 *  the free-text `CompanyUser.department` label is drawn from, so Company Settings can show a
 *  managed department list instead of departments existing only as whatever string someone
 *  typed on the last invite form. */
export interface Department {
  id: UUID;
  companyId: UUID;
  name: string;
}

/** A budget/reporting bucket purchase requests can be tagged with (section 10.3) - e.g.
 *  "IT-001". Deliberately holds no budget figures itself; Phase 11's procurement budgets are
 *  the thing that tracks spend against a cost center, this is just the label. */
export interface CostCenter {
  id: UUID;
  companyId: UUID;
  code: string;
  name: string;
  departmentId?: UUID;
}

export type BudgetPeriod = 'ANNUAL' | 'MONTHLY';
export type BudgetScope = 'COMPANY' | 'DEPARTMENT' | 'COST_CENTER';

/**
 * A spending ceiling for one period (section 11.3) - scoped to the whole company, one
 * department, or one cost center. Utilization is always computed on demand from real paid
 * orders (budgets.service.ts), never stored as a running total here, so it can never drift out
 * of sync with what was actually spent.
 */
export interface Budget {
  id: UUID;
  companyId: UUID;
  scope: BudgetScope;
  /** Set when scope is DEPARTMENT - the department name (matching Order.department/
   *  PurchaseRequest.department, which are plain strings, not department ids). */
  department?: string;
  /** Set when scope is COST_CENTER. */
  costCenterId?: UUID;
  period: BudgetPeriod;
  year: number;
  /** 1-12, set only when period is MONTHLY. */
  month?: number;
  amount: number;
}

/** A named group of related companies (e.g. "Acme Technologies") shown in the switcher. */
export interface CompanyGroup {
  id: UUID;
  name: string;
  companyIds: UUID[];
}

/** Membership of a User in a Company, with the role that applies within that company only -
 *  the same person can be an OWNER of one company and an EMPLOYEE of another. */
export interface CompanyUser {
  id: UUID;
  companyId: UUID;
  userId: UUID;
  role: Role;
  department?: string;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  invitedAt?: ISODateTime;
  joinedAt?: ISODateTime;
}

export interface User {
  id: UUID;
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  createdAt: ISODateTime;
}
