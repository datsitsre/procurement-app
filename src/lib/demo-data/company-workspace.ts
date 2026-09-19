import type { Branch, Budget, CostCenter, Department } from '@/types/company';

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

/** 2026 procurement budgets (section 11.3) - deliberately mixed: IT is comfortably under
 *  budget, Administration is close to its limit (crosses the 85% alert threshold with the
 *  seeded orders alone, so the alert UI has something real to show), and Operations has an
 *  approved budget with nothing spent against it yet (its only seeded order was cancelled and
 *  refunded, correctly excluded from spend). */
export const demoBudgets: Budget[] = [
  { id: 'budget-company-2026', companyId: 'company-acme-gh', scope: 'COMPANY', period: 'ANNUAL', year: 2026, amount: 500000 },
  { id: 'budget-it-2026', companyId: 'company-acme-gh', scope: 'DEPARTMENT', department: 'IT', period: 'ANNUAL', year: 2026, amount: 300000 },
  {
    id: 'budget-admin-2026',
    companyId: 'company-acme-gh',
    scope: 'DEPARTMENT',
    department: 'Administration',
    period: 'ANNUAL',
    year: 2026,
    amount: 12000,
  },
  {
    id: 'budget-ops-2026',
    companyId: 'company-acme-gh',
    scope: 'DEPARTMENT',
    department: 'Operations',
    period: 'ANNUAL',
    year: 2026,
    amount: 50000,
  },
];
