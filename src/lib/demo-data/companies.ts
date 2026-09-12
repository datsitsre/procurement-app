import type { Company, CompanyGroup, CompanyUser, User } from '@/types/company';
import { Role } from '@/config/rbac';

/**
 * Fictional demo data only (section 65) - no real company, person, or supplier names.
 * This is the seed data the mock services in src/services read from; swapping to a real
 * backend later means replacing the service implementations, not this shape.
 */

export const demoUsers: User[] = [
  {
    id: 'user-john-doe',
    name: 'John Doe',
    email: 'john.doe@acmetech.example',
    createdAt: '2025-01-14T09:00:00Z',
  },
  {
    id: 'user-sarah-smith',
    name: 'Sarah Smith',
    email: 'sarah.smith@acmetech.example',
    createdAt: '2025-01-14T09:00:00Z',
  },
  {
    id: 'user-michael-doe',
    name: 'Michael Doe',
    email: 'michael.doe@acmetech.example',
    createdAt: '2025-02-01T09:00:00Z',
  },
];

export const demoCompanyGroups: CompanyGroup[] = [
  {
    id: 'group-acme',
    name: 'Acme Technologies',
    companyIds: ['company-acme-gh', 'company-acme-ng', 'company-acme-ke'],
  },
];

export const demoCompanies: Company[] = [
  {
    id: 'company-acme-gh',
    name: 'Acme Technologies Ghana',
    legalName: 'Acme Technologies Ghana Ltd.',
    country: 'GH',
    currency: 'GHS',
    taxId: 'GH-TIN-004821',
    addresses: [
      {
        id: 'addr-acme-gh-accra',
        label: 'Accra Warehouse',
        line1: '14 Independence Avenue',
        city: 'Accra',
        country: 'GH',
        isDefault: true,
      },
      {
        id: 'addr-acme-gh-tema',
        label: 'Tema Branch',
        line1: '7 Harbour Road',
        city: 'Tema',
        country: 'GH',
      },
    ],
    creditTerms: 'NET_30',
    creditLimit: 100000,
    creditAvailable: 72500,
    isBuyer: true,
    isSupplier: false,
    parentGroupId: 'group-acme',
    createdAt: '2024-11-02T09:00:00Z',
  },
  {
    id: 'company-acme-ng',
    name: 'Acme Technologies Nigeria',
    legalName: 'Acme Technologies Nigeria Ltd.',
    country: 'NG',
    currency: 'NGN',
    addresses: [
      {
        id: 'addr-acme-ng-lagos',
        label: 'Lagos Warehouse',
        line1: '22 Marina Street',
        city: 'Lagos',
        country: 'NG',
        isDefault: true,
      },
    ],
    creditTerms: 'NET_15',
    creditLimit: 4500000,
    creditAvailable: 2100000,
    isBuyer: true,
    isSupplier: false,
    parentGroupId: 'group-acme',
    createdAt: '2025-01-10T09:00:00Z',
  },
  {
    id: 'company-acme-ke',
    name: 'Acme Technologies Kenya',
    legalName: 'Acme Technologies Kenya Ltd.',
    country: 'KE',
    currency: 'KES',
    addresses: [
      {
        id: 'addr-acme-ke-nairobi',
        label: 'Nairobi Warehouse',
        line1: '9 Uhuru Highway',
        city: 'Nairobi',
        country: 'KE',
        isDefault: true,
      },
    ],
    creditTerms: 'PREPAID',
    isBuyer: true,
    isSupplier: false,
    parentGroupId: 'group-acme',
    createdAt: '2025-03-18T09:00:00Z',
  },
];

export const demoCompanyUsers: CompanyUser[] = [
  { id: 'cu-1', companyId: 'company-acme-gh', userId: 'user-john-doe', role: Role.PROCUREMENT_MANAGER, department: 'IT', status: 'ACTIVE', joinedAt: '2024-11-05T09:00:00Z' },
  { id: 'cu-2', companyId: 'company-acme-gh', userId: 'user-sarah-smith', role: Role.FINANCE_MANAGER, department: 'Finance', status: 'ACTIVE', joinedAt: '2024-11-05T09:00:00Z' },
  { id: 'cu-3', companyId: 'company-acme-gh', userId: 'user-michael-doe', role: Role.EMPLOYEE, department: 'Operations', status: 'ACTIVE', joinedAt: '2025-02-02T09:00:00Z' },
  { id: 'cu-4', companyId: 'company-acme-ng', userId: 'user-john-doe', role: Role.OWNER, status: 'ACTIVE', joinedAt: '2025-01-10T09:00:00Z' },
  { id: 'cu-5', companyId: 'company-acme-ke', userId: 'user-john-doe', role: Role.OWNER, status: 'ACTIVE', joinedAt: '2025-03-18T09:00:00Z' },
];
