import type { Branch, CostCenter, Department } from '@/types/company';

/**
 * Fictional company-workspace structure (section 10) for the demo companies - departments and
 * cost centers exist only for Acme Technologies Ghana, the company every demo account actually
 * transacts as; the other Acme entities (Nigeria, Kenya) and every supplier/platform company
 * stay unstructured, the same way they don't have seeded RFQs or purchase requests of their own.
 */
export const demoDepartments: Department[] = [
  { id: 'dept-it', companyId: 'company-acme-gh', name: 'IT' },
  { id: 'dept-finance', companyId: 'company-acme-gh', name: 'Finance' },
  { id: 'dept-procurement', companyId: 'company-acme-gh', name: 'Procurement' },
  { id: 'dept-operations', companyId: 'company-acme-gh', name: 'Operations' },
  { id: 'dept-hr', companyId: 'company-acme-gh', name: 'HR' },
  { id: 'dept-marketing', companyId: 'company-acme-gh', name: 'Marketing' },
  { id: 'dept-admin', companyId: 'company-acme-gh', name: 'Administration' },
];

export const demoCostCenters: CostCenter[] = [
  { id: 'cc-it-001', companyId: 'company-acme-gh', code: 'IT-001', name: 'IT Infrastructure', departmentId: 'dept-it' },
  { id: 'cc-ops-002', companyId: 'company-acme-gh', code: 'Operations-002', name: 'Facilities & Operations', departmentId: 'dept-operations' },
  { id: 'cc-mkt-003', companyId: 'company-acme-gh', code: 'Marketing-003', name: 'Marketing & Events', departmentId: 'dept-marketing' },
  { id: 'cc-admin-004', companyId: 'company-acme-gh', code: 'Administration-004', name: 'General Administration', departmentId: 'dept-admin' },
];

export const demoBranches: Branch[] = [
  {
    id: 'branch-acme-gh-hq',
    companyId: 'company-acme-gh',
    name: 'Head Office',
    addressId: 'addr-acme-gh-accra',
    contactName: 'John Doe',
    contactPhone: '+233 30 123 4567',
    isWarehouse: true,
    isHeadOffice: true,
    createdAt: '2024-11-02T09:00:00Z',
  },
  {
    id: 'branch-acme-gh-tema',
    companyId: 'company-acme-gh',
    name: 'Tema Branch',
    addressId: 'addr-acme-gh-tema',
    contactName: 'Michael Doe',
    costCenterId: 'cc-ops-002',
    isWarehouse: false,
    createdAt: '2025-02-02T09:00:00Z',
  },
];
