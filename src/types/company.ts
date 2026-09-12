import type { Address, CountryCode, CurrencyCode, ISODateTime, UUID } from './common';
import type { Role } from '@/config/rbac';

export type CreditTerm = 'PREPAID' | 'NET_7' | 'NET_15' | 'NET_30' | 'NET_60';

/** A buyer or supplier organization. Every company is a tenant - see section 47: no
 *  frontend request or mock-service call is allowed to leak data across `Company.id`. */
export interface Company {
  id: UUID;
  name: string;
  legalName?: string;
  country: CountryCode;
  currency: CurrencyCode;
  taxId?: string;
  logoUrl?: string;
  addresses: Address[];
  creditTerms: CreditTerm;
  creditLimit?: number;
  creditAvailable?: number;
  isSupplier: boolean;
  isBuyer: boolean;
  /** Companies operating under the same parent group, for the company switcher (section 10). */
  parentGroupId?: UUID;
  createdAt: ISODateTime;
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
