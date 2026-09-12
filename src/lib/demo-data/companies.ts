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
  // Supplier-side users (Phase 5) - one admin per demoSuppliers entry in lib/demo-data/catalog.ts,
  // so every supplier a buyer can see already has a real company + login behind it.
  {
    id: 'user-adwoa-mensah',
    name: 'Adwoa Mensah',
    email: 'adwoa.mensah@abctech.example',
    createdAt: '2024-06-01T09:00:00Z',
  },
  {
    id: 'user-kofi-boateng',
    name: 'Kofi Boateng',
    email: 'kofi.boateng@primeoffice.example',
    createdAt: '2024-07-15T09:00:00Z',
  },
  {
    id: 'user-yaw-darko',
    name: 'Yaw Darko',
    email: 'yaw.darko@accraindustrial.example',
    createdAt: '2024-05-20T09:00:00Z',
  },
  {
    id: 'user-chidi-okafor',
    name: 'Chidi Okafor',
    email: 'chidi.okafor@waelectronics.example',
    createdAt: '2024-08-10T09:00:00Z',
  },
  {
    id: 'user-efua-asante',
    name: 'Efua Asante',
    email: 'efua.asante@kumasiprint.example',
    createdAt: '2026-09-01T09:00:00Z',
  },
  // Platform-side user (Phase 6) - runs the marketplace itself, not a buyer or supplier company.
  {
    id: 'user-grace-owusu',
    name: 'Grace Owusu',
    email: 'grace.owusu@platform.example',
    createdAt: '2024-01-01T09:00:00Z',
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
  // Supplier-side companies (Phase 5) - id matches the `companyId` each SupplierProfile in
  // lib/demo-data/catalog.ts already points to, so switching into the supplier workspace
  // resolves the right SupplierProfile without any new lookup table.
  {
    id: 'supplier-company-abc',
    name: 'ABC Technology Solutions',
    legalName: 'ABC Technology Solutions Ltd.',
    country: 'GH',
    currency: 'GHS',
    taxId: 'GH-TIN-011932',
    addresses: [
      { id: 'addr-abc-accra', label: 'Accra Warehouse', line1: '3 Spintex Road', city: 'Accra', country: 'GH', isDefault: true },
    ],
    creditTerms: 'PREPAID',
    isBuyer: false,
    isSupplier: true,
    createdAt: '2024-06-01T09:00:00Z',
  },
  {
    id: 'supplier-company-prime',
    name: 'Prime Office Supplies',
    legalName: 'Prime Office Supplies Ltd.',
    country: 'GH',
    currency: 'GHS',
    taxId: 'GH-TIN-018204',
    addresses: [
      { id: 'addr-prime-accra', label: 'Accra Warehouse', line1: '18 Ring Road East', city: 'Accra', country: 'GH', isDefault: true },
    ],
    creditTerms: 'PREPAID',
    isBuyer: false,
    isSupplier: true,
    createdAt: '2024-07-15T09:00:00Z',
  },
  {
    id: 'supplier-company-aie',
    name: 'Accra Industrial Equipment',
    legalName: 'Accra Industrial Equipment Ltd.',
    country: 'GH',
    currency: 'GHS',
    taxId: 'GH-TIN-009871',
    addresses: [
      { id: 'addr-aie-accra', label: 'Accra Yard', line1: '55 Tema Motorway', city: 'Accra', country: 'GH', isDefault: true },
      { id: 'addr-aie-kumasi', label: 'Kumasi Yard', line1: '12 Kejetia Road', city: 'Kumasi', country: 'GH' },
    ],
    creditTerms: 'PREPAID',
    isBuyer: false,
    isSupplier: true,
    createdAt: '2024-05-20T09:00:00Z',
  },
  {
    id: 'supplier-company-wae',
    name: 'West Africa Electronics',
    legalName: 'West Africa Electronics Ltd.',
    country: 'NG',
    currency: 'NGN',
    taxId: 'NG-TIN-773410',
    addresses: [
      { id: 'addr-wae-lagos', label: 'Lagos Warehouse', line1: '9 Apapa Wharf Road', city: 'Lagos', country: 'NG', isDefault: true },
    ],
    creditTerms: 'PREPAID',
    isBuyer: false,
    isSupplier: true,
    createdAt: '2024-08-10T09:00:00Z',
  },
  {
    id: 'supplier-company-kpp',
    name: 'Kumasi Print & Pack',
    legalName: 'Kumasi Print & Pack Ltd.',
    country: 'GH',
    currency: 'GHS',
    taxId: 'GH-TIN-024417',
    addresses: [
      { id: 'addr-kpp-kumasi', label: 'Kumasi Warehouse', line1: '31 Prempeh II Street', city: 'Kumasi', country: 'GH', isDefault: true },
    ],
    creditTerms: 'PREPAID',
    isBuyer: false,
    isSupplier: true,
    createdAt: '2026-09-01T09:00:00Z',
  },
  // Platform operator (Phase 6) - neither a buyer nor a supplier tenant; exists only so a
  // PLATFORM_ADMIN session has a CompanyUser membership to resolve, the same as every other
  // role. Never shown in the company switcher or any buyer/supplier-facing list.
  {
    id: 'platform-hq',
    name: 'Marketplace Platform',
    country: 'GH',
    currency: 'GHS',
    addresses: [],
    creditTerms: 'PREPAID',
    isBuyer: false,
    isSupplier: false,
    createdAt: '2024-01-01T09:00:00Z',
  },
];

export const demoCompanyUsers: CompanyUser[] = [
  { id: 'cu-1', companyId: 'company-acme-gh', userId: 'user-john-doe', role: Role.PROCUREMENT_MANAGER, department: 'IT', status: 'ACTIVE', joinedAt: '2024-11-05T09:00:00Z' },
  { id: 'cu-2', companyId: 'company-acme-gh', userId: 'user-sarah-smith', role: Role.FINANCE_MANAGER, department: 'Finance', status: 'ACTIVE', joinedAt: '2024-11-05T09:00:00Z' },
  { id: 'cu-3', companyId: 'company-acme-gh', userId: 'user-michael-doe', role: Role.EMPLOYEE, department: 'Operations', status: 'ACTIVE', joinedAt: '2025-02-02T09:00:00Z' },
  { id: 'cu-4', companyId: 'company-acme-ng', userId: 'user-john-doe', role: Role.OWNER, status: 'ACTIVE', joinedAt: '2025-01-10T09:00:00Z' },
  { id: 'cu-5', companyId: 'company-acme-ke', userId: 'user-john-doe', role: Role.OWNER, status: 'ACTIVE', joinedAt: '2025-03-18T09:00:00Z' },
  // Supplier-side memberships (Phase 5).
  { id: 'cu-6', companyId: 'supplier-company-abc', userId: 'user-adwoa-mensah', role: Role.SUPPLIER_ADMIN, department: 'Sales', status: 'ACTIVE', joinedAt: '2024-06-01T09:00:00Z' },
  { id: 'cu-7', companyId: 'supplier-company-prime', userId: 'user-kofi-boateng', role: Role.SUPPLIER_ADMIN, department: 'Sales', status: 'ACTIVE', joinedAt: '2024-07-15T09:00:00Z' },
  { id: 'cu-8', companyId: 'supplier-company-aie', userId: 'user-yaw-darko', role: Role.SUPPLIER_ADMIN, department: 'Sales', status: 'ACTIVE', joinedAt: '2024-05-20T09:00:00Z' },
  { id: 'cu-9', companyId: 'supplier-company-wae', userId: 'user-chidi-okafor', role: Role.SUPPLIER_ADMIN, department: 'Sales', status: 'ACTIVE', joinedAt: '2024-08-10T09:00:00Z' },
  { id: 'cu-10', companyId: 'supplier-company-kpp', userId: 'user-efua-asante', role: Role.SUPPLIER_ADMIN, department: 'Sales', status: 'ACTIVE', joinedAt: '2026-09-01T09:00:00Z' },
  // Platform-side membership (Phase 6).
  { id: 'cu-11', companyId: 'platform-hq', userId: 'user-grace-owusu', role: Role.PLATFORM_ADMIN, status: 'ACTIVE', joinedAt: '2024-01-01T09:00:00Z' },
];
