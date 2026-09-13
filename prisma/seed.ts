/**
 * Development/demo seed data (section 27). Ports the identity slice of the existing frontend
 * mock data (src/lib/demo-data/companies.ts) into the real database - same ids, same emails, so
 * every existing demo login continues to work exactly as documented in this app's memory/notes,
 * only now server-verified instead of a `localStorage` blob.
 *
 * Deliberately identity-only for now (Users, Companies, CompanyMemberships, SupplierProfile
 * stubs): Phase 14's first vertical slice is authentication (section 26's migration priority
 * list, item 1) - catalog/RFQ/order/invoice data stays on the existing mock services until a
 * later migration stage moves it too (section 34's staged plan). This script is safe to re-run -
 * every upsert is keyed by the same id the frontend demo data already uses.
 *
 * Never run this against a real production database - it exists purely to make local
 * development/demo environments usable, and every account it creates shares one obviously-fake
 * password (see DEMO_PASSWORD below), exactly like the mock authService it replaces.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

const DEMO_PASSWORD = 'password123';

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const users = [
    { id: 'user-john-doe', name: 'John Doe', email: 'john.doe@acmetech.example' },
    { id: 'user-sarah-smith', name: 'Sarah Smith', email: 'sarah.smith@acmetech.example' },
    { id: 'user-michael-doe', name: 'Michael Doe', email: 'michael.doe@acmetech.example' },
    { id: 'user-adwoa-mensah', name: 'Adwoa Mensah', email: 'adwoa.mensah@abctech.example' },
    { id: 'user-kofi-boateng', name: 'Kofi Boateng', email: 'kofi.boateng@primeoffice.example' },
    { id: 'user-yaw-darko', name: 'Yaw Darko', email: 'yaw.darko@accraindustrial.example' },
    { id: 'user-chidi-okafor', name: 'Chidi Okafor', email: 'chidi.okafor@waelectronics.example' },
    { id: 'user-efua-asante', name: 'Efua Asante', email: 'efua.asante@kumasiprint.example' },
    { id: 'user-grace-owusu', name: 'Grace Owusu', email: 'grace.owusu@platform.example' },
  ];

  for (const u of users) {
    await db.user.upsert({
      where: { id: u.id },
      update: { name: u.name, email: u.email },
      create: { ...u, passwordHash },
    });
  }

  const companyGroup = await db.companyGroup.upsert({
    where: { id: 'group-acme' },
    update: { name: 'Acme Technologies' },
    create: { id: 'group-acme', name: 'Acme Technologies' },
  });

  const companies = [
    {
      id: 'company-acme-gh', name: 'Acme Technologies Ghana', legalName: 'Acme Technologies Ghana Ltd.',
      registrationNumber: 'GH-CR-102934', taxId: 'GH-TIN-004821', industry: 'Information Technology',
      website: 'https://acmetech.example', phone: '+233 30 123 4567', email: 'procurement@acmetech.example',
      description: 'IT hardware and networking reseller serving businesses across Ghana.',
      country: 'GH', currency: 'GHS', creditTerms: 'NET_30' as const, creditLimit: 100000, creditAvailable: 72500,
      isBuyer: true, isSupplier: false, parentGroupId: companyGroup.id,
    },
    {
      id: 'company-acme-ng', name: 'Acme Technologies Nigeria', legalName: 'Acme Technologies Nigeria Ltd.',
      country: 'NG', currency: 'NGN', creditTerms: 'NET_15' as const, creditLimit: 4500000, creditAvailable: 2100000,
      isBuyer: true, isSupplier: false, parentGroupId: companyGroup.id,
    },
    {
      id: 'company-acme-ke', name: 'Acme Technologies Kenya', legalName: 'Acme Technologies Kenya Ltd.',
      country: 'KE', currency: 'KES', creditTerms: 'PREPAID' as const,
      isBuyer: true, isSupplier: false, parentGroupId: companyGroup.id,
    },
    {
      id: 'supplier-company-abc', name: 'ABC Technology Solutions', legalName: 'ABC Technology Solutions Ltd.',
      country: 'GH', currency: 'GHS', taxId: 'GH-TIN-011932', creditTerms: 'PREPAID' as const,
      isBuyer: false, isSupplier: true,
    },
    {
      id: 'supplier-company-prime', name: 'Prime Office Supplies', legalName: 'Prime Office Supplies Ltd.',
      country: 'GH', currency: 'GHS', taxId: 'GH-TIN-018204', creditTerms: 'PREPAID' as const,
      isBuyer: false, isSupplier: true,
    },
    {
      id: 'supplier-company-aie', name: 'Accra Industrial Equipment', legalName: 'Accra Industrial Equipment Ltd.',
      country: 'GH', currency: 'GHS', taxId: 'GH-TIN-009871', creditTerms: 'PREPAID' as const,
      isBuyer: false, isSupplier: true,
    },
    {
      id: 'supplier-company-wae', name: 'West Africa Electronics', legalName: 'West Africa Electronics Ltd.',
      country: 'NG', currency: 'NGN', taxId: 'NG-TIN-773410', creditTerms: 'PREPAID' as const,
      isBuyer: false, isSupplier: true,
    },
    {
      id: 'supplier-company-kpp', name: 'Kumasi Print & Pack', legalName: 'Kumasi Print & Pack Ltd.',
      country: 'GH', currency: 'GHS', taxId: 'GH-TIN-024417', creditTerms: 'PREPAID' as const,
      isBuyer: false, isSupplier: true,
    },
    {
      id: 'platform-hq', name: 'Marketplace Platform', country: 'GH', currency: 'GHS', creditTerms: 'PREPAID' as const,
      isBuyer: false, isSupplier: false,
    },
  ];

  for (const c of companies) {
    const { id, parentGroupId, ...rest } = c;
    await db.company.upsert({
      where: { id },
      update: { ...rest, parentGroupId },
      create: { id, ...rest, parentGroupId },
    });
  }

  const memberships = [
    { id: 'cu-1', companyId: 'company-acme-gh', userId: 'user-john-doe', role: 'PROCUREMENT_MANAGER' as const, department: 'IT' },
    { id: 'cu-2', companyId: 'company-acme-gh', userId: 'user-sarah-smith', role: 'FINANCE_MANAGER' as const, department: 'Finance' },
    { id: 'cu-3', companyId: 'company-acme-gh', userId: 'user-michael-doe', role: 'EMPLOYEE' as const, department: 'Operations' },
    { id: 'cu-4', companyId: 'company-acme-ng', userId: 'user-john-doe', role: 'OWNER' as const },
    { id: 'cu-5', companyId: 'company-acme-ke', userId: 'user-john-doe', role: 'OWNER' as const },
    { id: 'cu-6', companyId: 'supplier-company-abc', userId: 'user-adwoa-mensah', role: 'SUPPLIER_ADMIN' as const, department: 'Sales' },
    { id: 'cu-7', companyId: 'supplier-company-prime', userId: 'user-kofi-boateng', role: 'SUPPLIER_ADMIN' as const, department: 'Sales' },
    { id: 'cu-8', companyId: 'supplier-company-aie', userId: 'user-yaw-darko', role: 'SUPPLIER_ADMIN' as const, department: 'Sales' },
    { id: 'cu-9', companyId: 'supplier-company-wae', userId: 'user-chidi-okafor', role: 'SUPPLIER_ADMIN' as const, department: 'Sales' },
    { id: 'cu-10', companyId: 'supplier-company-kpp', userId: 'user-efua-asante', role: 'SUPPLIER_ADMIN' as const, department: 'Sales' },
    { id: 'cu-11', companyId: 'platform-hq', userId: 'user-grace-owusu', role: 'PLATFORM_ADMIN' as const },
  ];

  for (const m of memberships) {
    await db.companyMembership.upsert({
      where: { id: m.id },
      update: { role: m.role, department: m.department, status: 'ACTIVE' },
      create: { ...m, status: 'ACTIVE', joinedAt: new Date() },
    });
  }

  // Minimal SupplierProfile stub per supplier company - just enough for tenant resolution
  // (resolveTenant in server/auth/context.ts) to recognize these companies as suppliers.
  // Full supplier-intelligence fields (rating, categories, ...) stay on the existing frontend
  // mock catalog.service.ts until Stage 4 migrates the catalog domain.
  const supplierProfiles = [
    { companyId: 'supplier-company-abc', slug: 'abc-technology-solutions', city: 'Accra', country: 'Ghana' },
    { companyId: 'supplier-company-prime', slug: 'prime-office-supplies', city: 'Accra', country: 'Ghana' },
    { companyId: 'supplier-company-aie', slug: 'accra-industrial-equipment', city: 'Accra', country: 'Ghana' },
    { companyId: 'supplier-company-wae', slug: 'west-africa-electronics', city: 'Lagos', country: 'Nigeria' },
    { companyId: 'supplier-company-kpp', slug: 'kumasi-print-and-pack', city: 'Kumasi', country: 'Ghana' },
  ];

  for (const s of supplierProfiles) {
    await db.supplierProfile.upsert({
      where: { companyId: s.companyId },
      update: {},
      create: { ...s, description: '', verification: 'VERIFIED' },
    });
  }

  console.log(`Seeded ${users.length} users, ${companies.length} companies, ${memberships.length} memberships.`);
  console.log(`Every seeded account's password is "${DEMO_PASSWORD}" - demo data only, never use in production.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
