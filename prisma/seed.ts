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

  // SupplierProfile ids are fixed strings ('supplier-abc', ...) matching src/lib/demo-data/
  // catalog.ts's demoSuppliers exactly, not auto-generated cuids - Product.supplierId (and
  // every other domain's supplierId, once migrated) references these by that same id
  // throughout the app, so the seed has to use it too, not whatever Prisma's default() would
  // pick. Deleted and recreated (rather than upserted) because an early build of this script
  // upserted these keyed by companyId with an auto-generated id - upsert can't change an
  // existing row's id, so fixing it requires starting clean. Safe: nothing references
  // SupplierProfile.id yet except this same seed run's own Product rows, created after this.
  await db.supplierProfile.deleteMany({});

  const supplierProfiles = [
    {
      id: 'supplier-abc', companyId: 'supplier-company-abc', name: 'ABC Technology Solutions',
      slug: 'abc-technology-solutions', categories: ['Networking', 'Computing'], city: 'Accra', country: 'Ghana',
      verification: 'VERIFIED' as const, rating: 4.7, reviewCount: 132, responseTimeHours: 2, completedOrders: 861,
      certifications: ['ISO 9001'], description: 'Networking and IT hardware distributor serving businesses across Ghana since 2011.',
    },
    {
      id: 'supplier-prime', companyId: 'supplier-company-prime', name: 'Prime Office Supplies',
      slug: 'prime-office-supplies', categories: ['Office Furniture', 'Office Equipment'], city: 'Accra', country: 'Ghana',
      verification: 'VERIFIED' as const, rating: 4.4, reviewCount: 98, responseTimeHours: 4, completedOrders: 512,
      certifications: [] as string[], description: 'Office furniture, printers, and workplace supplies for growing companies.',
    },
    {
      id: 'supplier-aie', companyId: 'supplier-company-aie', name: 'Accra Industrial Equipment',
      slug: 'accra-industrial-equipment', categories: ['Industrial Equipment'], city: 'Accra', country: 'Ghana',
      verification: 'PREMIUM_VERIFIED' as const, rating: 4.9, reviewCount: 76, responseTimeHours: 3, completedOrders: 304,
      certifications: ['ISO 9001', 'ISO 45001'], description: 'Generators, safety equipment, and industrial machinery for construction and manufacturing.',
    },
    {
      id: 'supplier-wae', companyId: 'supplier-company-wae', name: 'West Africa Electronics',
      slug: 'west-africa-electronics', categories: ['Computing', 'Networking'], city: 'Lagos', country: 'Nigeria',
      verification: 'VERIFIED' as const, rating: 4.3, reviewCount: 64, responseTimeHours: 6, completedOrders: 219,
      certifications: [] as string[], description: 'Regional distributor of servers, power systems, and enterprise electronics.',
    },
    {
      id: 'supplier-kpp', companyId: 'supplier-company-kpp', name: 'Kumasi Print & Pack',
      slug: 'kumasi-print-and-pack', categories: ['Office Equipment'], city: 'Kumasi', country: 'Ghana',
      verification: 'PENDING_VERIFICATION' as const, rating: 0, reviewCount: 0, responseTimeHours: 12, completedOrders: 0,
      certifications: [] as string[], description: 'Commercial printing, packaging materials, and branded stationery for Ashanti-region businesses.',
    },
  ];

  for (const s of supplierProfiles) {
    await db.supplierProfile.create({ data: s });
  }

  // ---------------------------------------------------------------------------------------
  // Catalog (Phase 14, Stage 4) - categories, warehouses, products with specs/price tiers/
  // inventory. Ported from src/lib/demo-data/catalog.ts, same ids.
  // ---------------------------------------------------------------------------------------

  const categories = [
    { id: 'cat-networking', name: 'Networking', slug: 'networking' },
    { id: 'cat-computing', name: 'Computing', slug: 'computing' },
    { id: 'cat-office-furniture', name: 'Office Furniture', slug: 'office-furniture' },
    { id: 'cat-industrial', name: 'Industrial Equipment', slug: 'industrial-equipment' },
    { id: 'cat-office-equipment', name: 'Office Equipment', slug: 'office-equipment' },
  ];
  for (const c of categories) {
    await db.category.upsert({ where: { id: c.id }, update: c, create: c });
  }

  const warehouses = [
    { id: 'wh-abc-accra', supplierId: 'supplier-abc', name: 'Accra Warehouse', city: 'Accra', isDefault: true },
    { id: 'wh-prime-accra', supplierId: 'supplier-prime', name: 'Accra Warehouse', city: 'Accra', isDefault: true },
    { id: 'wh-aie-accra', supplierId: 'supplier-aie', name: 'Accra Warehouse', city: 'Accra', isDefault: true },
    { id: 'wh-aie-kumasi', supplierId: 'supplier-aie', name: 'Kumasi Warehouse', city: 'Kumasi', isDefault: false },
    { id: 'wh-wae-lagos', supplierId: 'supplier-wae', name: 'Lagos Warehouse', city: 'Lagos', isDefault: true },
    { id: 'wh-kpp-kumasi', supplierId: 'supplier-kpp', name: 'Kumasi Warehouse', city: 'Kumasi', isDefault: true },
  ];
  for (const w of warehouses) {
    await db.warehouse.upsert({ where: { id: w.id }, update: w, create: w });
  }

  interface SeedProduct {
    id: string; slug: string; name: string; brand: string; sku: string; supplierId: string; categoryId: string;
    moderationStatus: 'PUBLISHED' | 'PENDING_REVIEW'; images: string[]; description: string;
    specifications: { label: string; value: string }[];
    basePrice: number; priceTiers: { minQty: number; maxQty?: number; unitPrice: number }[]; moq: number;
    inventory: { warehouseId: string; stock: number; reserved: number; lowStockThreshold: number }[];
    rating: number; reviewCount: number; createdAt: string;
  }

  const products: SeedProduct[] = [
    {
      id: 'prod-cisco-switch', slug: 'cisco-catalyst-switch', name: 'Cisco Catalyst Switch', brand: 'Cisco', sku: 'C9200L-24P',
      supplierId: 'supplier-abc', categoryId: 'cat-networking', moderationStatus: 'PUBLISHED',
      images: ['https://images.pexels.com/photos/2881227/pexels-photo-2881227.jpeg'],
      description: '24-port managed Ethernet switch with PoE+, built for reliable enterprise and campus networks.',
      specifications: [
        { label: 'Ports', value: '24x 1GbE PoE+' },
        { label: 'Power', value: 'PoE+ 370W budget' },
        { label: 'Dimensions', value: '44.5 x 28 x 4.4 cm' },
        { label: 'Warranty', value: '3 years' },
        { label: 'Country of origin', value: 'Vietnam' },
      ],
      basePrice: 8450,
      priceTiers: [
        { minQty: 1, maxQty: 4, unitPrice: 8450 },
        { minQty: 5, maxQty: 19, unitPrice: 8100 },
        { minQty: 20, maxQty: 49, unitPrice: 7850 },
        { minQty: 50, unitPrice: 7650 },
      ],
      moq: 5,
      inventory: [{ warehouseId: 'wh-abc-accra', stock: 42, reserved: 6, lowStockThreshold: 10 }],
      rating: 4.8, reviewCount: 54, createdAt: '2025-11-01T09:00:00Z',
    },
    {
      id: 'prod-hp-probook', slug: 'hp-probook-laptop', name: 'HP ProBook Laptop', brand: 'HP', sku: 'HP-PB450-G10',
      supplierId: 'supplier-abc', categoryId: 'cat-computing', moderationStatus: 'PUBLISHED',
      images: ['https://images.pexels.com/photos/10655906/pexels-photo-10655906.jpeg'],
      description: '14" business laptop with Intel Core i5, 16GB RAM, and a 3-year onsite warranty.',
      specifications: [
        { label: 'Processor', value: 'Intel Core i5-1335U' },
        { label: 'Memory', value: '16GB RAM / 512GB SSD' },
        { label: 'Display', value: '14" FHD' },
        { label: 'Warranty', value: '3 years onsite' },
        { label: 'Country of origin', value: 'China' },
      ],
      basePrice: 6200,
      priceTiers: [
        { minQty: 1, maxQty: 9, unitPrice: 6200 },
        { minQty: 10, maxQty: 24, unitPrice: 5950 },
        { minQty: 25, unitPrice: 5700 },
      ],
      moq: 3,
      inventory: [{ warehouseId: 'wh-abc-accra', stock: 68, reserved: 12, lowStockThreshold: 15 }],
      rating: 4.5, reviewCount: 89, createdAt: '2025-10-20T09:00:00Z',
    },
    {
      id: 'prod-dell-poweredge', slug: 'dell-poweredge-server', name: 'Dell PowerEdge Server', brand: 'Dell', sku: 'PE-R650-BASE',
      supplierId: 'supplier-wae', categoryId: 'cat-computing', moderationStatus: 'PUBLISHED',
      images: ['https://images.pexels.com/photos/4508751/pexels-photo-4508751.jpeg'],
      description: '1U rack server for demanding virtualization and database workloads.',
      specifications: [
        { label: 'Processor', value: '2x Intel Xeon Silver' },
        { label: 'Memory', value: '64GB RAM (expandable)' },
        { label: 'Storage', value: '4x 2.5" hot-swap bays' },
        { label: 'Warranty', value: '3 years next-business-day' },
        { label: 'Country of origin', value: 'Ireland' },
      ],
      basePrice: 42000,
      priceTiers: [
        { minQty: 1, maxQty: 2, unitPrice: 42000 },
        { minQty: 3, maxQty: 5, unitPrice: 40200 },
        { minQty: 6, unitPrice: 38500 },
      ],
      moq: 1,
      inventory: [{ warehouseId: 'wh-wae-lagos', stock: 11, reserved: 2, lowStockThreshold: 3 }],
      rating: 4.9, reviewCount: 22, createdAt: '2025-09-15T09:00:00Z',
    },
    {
      id: 'prod-cat6-cable', slug: 'cat6-network-cable', name: 'CAT6 Network Cable', brand: 'Generic', sku: 'CAT6-305M-BLU',
      supplierId: 'supplier-abc', categoryId: 'cat-networking', moderationStatus: 'PUBLISHED',
      images: ['https://images.pexels.com/photos/415043/pexels-photo-415043.jpeg'],
      description: '305m box of solid-core CAT6 UTP cable for structured cabling installations.',
      specifications: [
        { label: 'Length', value: '305m box' },
        { label: 'Category', value: 'CAT6 UTP' },
        { label: 'Conductor', value: '23AWG solid copper' },
        { label: 'Warranty', value: '1 year' },
        { label: 'Country of origin', value: 'China' },
      ],
      basePrice: 950,
      priceTiers: [
        { minQty: 1, maxQty: 9, unitPrice: 950 },
        { minQty: 10, maxQty: 29, unitPrice: 880 },
        { minQty: 30, unitPrice: 820 },
      ],
      moq: 2,
      inventory: [{ warehouseId: 'wh-abc-accra', stock: 156, reserved: 20, lowStockThreshold: 30 }],
      rating: 4.4, reviewCount: 41, createdAt: '2025-11-10T09:00:00Z',
    },
    {
      id: 'prod-apc-ups', slug: 'apc-ups', name: 'APC UPS', brand: 'APC', sku: 'APC-SMT1500',
      supplierId: 'supplier-wae', categoryId: 'cat-networking', moderationStatus: 'PUBLISHED',
      images: ['https://images.pexels.com/photos/37929911/pexels-photo-37929911.jpeg'],
      description: '1500VA line-interactive UPS for servers and network equipment, built for frequent outages.',
      specifications: [
        { label: 'Capacity', value: '1500VA / 1000W' },
        { label: 'Runtime (half load)', value: '~11 minutes' },
        { label: 'Outlets', value: '8x IEC' },
        { label: 'Warranty', value: '2 years' },
        { label: 'Country of origin', value: 'Philippines' },
      ],
      basePrice: 3200,
      priceTiers: [
        { minQty: 1, maxQty: 4, unitPrice: 3200 },
        { minQty: 5, maxQty: 14, unitPrice: 3050 },
        { minQty: 15, unitPrice: 2900 },
      ],
      moq: 1,
      inventory: [{ warehouseId: 'wh-wae-lagos', stock: 34, reserved: 4, lowStockThreshold: 8 }],
      rating: 4.6, reviewCount: 37, createdAt: '2025-10-05T09:00:00Z',
    },
    {
      id: 'prod-office-desk', slug: 'office-desk', name: 'Office Desk', brand: 'Prime Furnish', sku: 'PF-DESK-140',
      supplierId: 'supplier-prime', categoryId: 'cat-office-furniture', moderationStatus: 'PUBLISHED',
      images: ['https://images.pexels.com/photos/1957477/pexels-photo-1957477.jpeg'],
      description: '140cm office desk with cable management, in a durable laminate finish.',
      specifications: [
        { label: 'Dimensions', value: '140 x 70 x 75 cm' },
        { label: 'Material', value: 'Laminate over particleboard' },
        { label: 'Assembly', value: 'Required, tools included' },
        { label: 'Warranty', value: '2 years' },
        { label: 'Country of origin', value: 'Ghana' },
      ],
      basePrice: 1450,
      priceTiers: [
        { minQty: 1, maxQty: 9, unitPrice: 1450 },
        { minQty: 10, maxQty: 24, unitPrice: 1350 },
        { minQty: 25, unitPrice: 1250 },
      ],
      moq: 1,
      inventory: [{ warehouseId: 'wh-prime-accra', stock: 76, reserved: 8, lowStockThreshold: 15 }],
      rating: 4.2, reviewCount: 63, createdAt: '2025-08-22T09:00:00Z',
    },
    {
      id: 'prod-office-chair', slug: 'office-chair', name: 'Office Chair', brand: 'Prime Furnish', sku: 'PF-CHAIR-ERG2',
      supplierId: 'supplier-prime', categoryId: 'cat-office-furniture', moderationStatus: 'PUBLISHED',
      images: ['https://images.pexels.com/photos/31236091/pexels-photo-31236091.jpeg'],
      description: 'Ergonomic mesh-back office chair with adjustable lumbar support and armrests.',
      specifications: [
        { label: 'Material', value: 'Mesh back, foam seat' },
        { label: 'Adjustability', value: 'Height, tilt, lumbar, armrests' },
        { label: 'Max load', value: '120kg' },
        { label: 'Warranty', value: '3 years' },
        { label: 'Country of origin', value: 'Ghana' },
      ],
      basePrice: 980,
      priceTiers: [
        { minQty: 1, maxQty: 9, unitPrice: 980 },
        { minQty: 10, maxQty: 24, unitPrice: 910 },
        { minQty: 25, unitPrice: 850 },
      ],
      moq: 1,
      inventory: [{ warehouseId: 'wh-prime-accra', stock: 112, reserved: 10, lowStockThreshold: 20 }],
      rating: 4.3, reviewCount: 71, createdAt: '2025-08-22T09:00:00Z',
    },
    {
      id: 'prod-industrial-generator', slug: 'industrial-generator', name: 'Industrial Generator', brand: 'Cummins', sku: 'CUM-GEN-60KVA',
      supplierId: 'supplier-aie', categoryId: 'cat-industrial', moderationStatus: 'PUBLISHED',
      images: ['https://images.pexels.com/photos/32713414/pexels-photo-32713414.jpeg'],
      description: '60kVA diesel generator with automatic transfer switch, for continuous site power.',
      specifications: [
        { label: 'Output', value: '60kVA / 48kW' },
        { label: 'Fuel', value: 'Diesel' },
        { label: 'Enclosure', value: 'Weatherproof, sound-attenuated' },
        { label: 'Warranty', value: '2 years / 2000 hours' },
        { label: 'Country of origin', value: 'United States' },
      ],
      basePrice: 185000,
      priceTiers: [
        { minQty: 1, maxQty: 1, unitPrice: 185000 },
        { minQty: 2, unitPrice: 176000 },
      ],
      moq: 1,
      inventory: [
        { warehouseId: 'wh-aie-accra', stock: 6, reserved: 1, lowStockThreshold: 2 },
        { warehouseId: 'wh-aie-kumasi', stock: 3, reserved: 0, lowStockThreshold: 1 },
      ],
      rating: 4.9, reviewCount: 18, createdAt: '2025-07-30T09:00:00Z',
    },
    {
      id: 'prod-safety-equipment', slug: 'safety-equipment-kit', name: 'Safety Equipment Kit', brand: 'SafeGuard', sku: 'SG-KIT-STD',
      supplierId: 'supplier-aie', categoryId: 'cat-industrial', moderationStatus: 'PUBLISHED',
      images: ['https://images.pexels.com/photos/38070/pexels-photo-38070.jpeg'],
      description: 'Standard site safety kit: hard hat, gloves, safety glasses, and hi-vis vest, per worker.',
      specifications: [
        { label: 'Contents', value: 'Helmet, gloves, glasses, hi-vis vest' },
        { label: 'Standard', value: 'EN 397 (helmet)' },
        { label: 'Sizes', value: 'S-XXL' },
        { label: 'Warranty', value: '1 year' },
        { label: 'Country of origin', value: 'Ghana' },
      ],
      basePrice: 280,
      priceTiers: [
        { minQty: 1, maxQty: 19, unitPrice: 280 },
        { minQty: 20, maxQty: 99, unitPrice: 250 },
        { minQty: 100, unitPrice: 220 },
      ],
      moq: 10,
      inventory: [{ warehouseId: 'wh-aie-accra', stock: 340, reserved: 40, lowStockThreshold: 50 }],
      rating: 4.5, reviewCount: 29, createdAt: '2025-09-02T09:00:00Z',
    },
    {
      id: 'prod-printer', slug: 'office-printer', name: 'Office Printer', brand: 'Canon', sku: 'CAN-MF275DW',
      supplierId: 'supplier-prime', categoryId: 'cat-office-equipment', moderationStatus: 'PUBLISHED',
      images: ['https://images.pexels.com/photos/4792283/pexels-photo-4792283.jpeg'],
      description: 'Wireless all-in-one laser printer with duplex printing, scan, and fax.',
      specifications: [
        { label: 'Type', value: 'Mono laser, all-in-one' },
        { label: 'Print speed', value: '29 ppm' },
        { label: 'Connectivity', value: 'Wi-Fi, USB, Ethernet' },
        { label: 'Warranty', value: '1 year' },
        { label: 'Country of origin', value: 'Vietnam' },
      ],
      basePrice: 2100,
      priceTiers: [
        { minQty: 1, maxQty: 4, unitPrice: 2100 },
        { minQty: 5, maxQty: 14, unitPrice: 1980 },
        { minQty: 15, unitPrice: 1850 },
      ],
      moq: 1,
      inventory: [{ warehouseId: 'wh-prime-accra', stock: 24, reserved: 3, lowStockThreshold: 8 }],
      rating: 4.1, reviewCount: 33, createdAt: '2025-10-28T09:00:00Z',
    },
    {
      id: 'prod-branded-notebooks', slug: 'branded-notebooks', name: 'Branded Notebooks (500-pack)', brand: 'Kumasi Print & Pack', sku: 'KPP-NB-500',
      supplierId: 'supplier-kpp', categoryId: 'cat-office-equipment', moderationStatus: 'PENDING_REVIEW',
      images: ['https://images.pexels.com/photos/6690918/pexels-photo-6690918.jpeg'],
      description: 'A5 hardcover notebooks with custom cover printing, sold in packs of 500.',
      specifications: [
        { label: 'Size', value: 'A5, 80 pages' },
        { label: 'Printing', value: 'Full-colour cover, one side' },
        { label: 'Lead time', value: '10 business days' },
        { label: 'Country of origin', value: 'Ghana' },
      ],
      basePrice: 4500,
      priceTiers: [{ minQty: 1, unitPrice: 4500 }],
      moq: 1,
      inventory: [{ warehouseId: 'wh-kpp-kumasi', stock: 20, reserved: 0, lowStockThreshold: 5 }],
      rating: 0, reviewCount: 0, createdAt: '2026-09-10T09:00:00Z',
    },
  ];

  for (const p of products) {
    const { specifications, priceTiers, inventory, createdAt, ...rest } = p;
    await db.product.upsert({
      where: { id: p.id },
      update: { ...rest, currency: 'GHS' },
      create: { ...rest, currency: 'GHS', createdAt: new Date(createdAt) },
    });
    // Specs/tiers/inventory are recreated fresh each run rather than upserted individually -
    // simplest way to keep a re-run idempotent without tracking each child row's own id.
    await db.productSpecification.deleteMany({ where: { productId: p.id } });
    await db.productSpecification.createMany({ data: specifications.map((s) => ({ ...s, productId: p.id })) });
    await db.priceTier.deleteMany({ where: { productId: p.id } });
    await db.priceTier.createMany({ data: priceTiers.map((t) => ({ ...t, productId: p.id })) });
    await db.inventoryRecord.deleteMany({ where: { productId: p.id } });
    await db.inventoryRecord.createMany({ data: inventory.map((i) => ({ ...i, productId: p.id })) });
  }

  // ---------------------------------------------------------------------------------------
  // RFQs, quotes, negotiation (Phase 14, Stage 5). Ported from src/lib/demo-data/procurement.ts,
  // same ids. supplierName/senderName aren't stored (derived via join from SupplierProfile/User
  // at read time - see server/dto/procurement.ts) so this seed only sets the columns that
  // actually exist on the real schema.
  // ---------------------------------------------------------------------------------------

  const rfqs = [
    {
      id: 'rfq-10082', reference: 'RFQ-10082', companyId: 'company-acme-gh', createdByUserId: 'user-john-doe',
      items: [{ id: 'rfqi-1', productId: 'prod-cisco-switch', productName: 'Cisco Catalyst Switch', quantity: 50 }],
      requiredDeliveryDate: '2026-09-20T00:00:00Z', deliveryLocation: 'Accra',
      additionalRequirements: 'Please include rack-mount kit and a spare unit if available.',
      suppliers: [
        { supplierId: 'supplier-abc', status: 'QUOTED' as const },
        { supplierId: 'supplier-wae', status: 'QUOTED' as const },
        { supplierId: 'supplier-prime', status: 'INVITED' as const },
      ],
      status: 'NEGOTIATION' as const, createdAt: '2026-09-03T09:00:00Z',
    },
    {
      id: 'rfq-10090', reference: 'RFQ-10090', companyId: 'company-acme-gh', createdByUserId: 'user-john-doe',
      items: [{ id: 'rfqi-2', productId: 'prod-office-desk', productName: 'Office Desk', quantity: 30 }],
      requiredDeliveryDate: '2026-09-25T00:00:00Z', deliveryLocation: 'Accra',
      suppliers: [{ supplierId: 'supplier-prime', status: 'INVITED' as const }],
      status: 'SENT' as const, createdAt: '2026-09-10T09:00:00Z',
    },
  ];

  for (const r of rfqs) {
    const { items, suppliers, createdAt, ...rest } = r;
    await db.rFQ.upsert({ where: { id: r.id }, update: { ...rest }, create: { ...rest, createdAt: new Date(createdAt) } });
    await db.rFQItem.deleteMany({ where: { rfqId: r.id } });
    await db.rFQItem.createMany({ data: items.map((i) => ({ ...i, rfqId: r.id })) });
    await db.rFQSupplier.deleteMany({ where: { rfqId: r.id } });
    await db.rFQSupplier.createMany({ data: suppliers.map((s) => ({ ...s, rfqId: r.id })) });
  }

  const quotes = [
    {
      id: 'quote-abc-10082', rfqId: 'rfq-10082', supplierId: 'supplier-abc',
      items: [{ id: 'qi-1', productId: 'prod-cisco-switch', quantity: 50, unitPrice: 7850 }],
      totalPrice: 392500, deliveryDays: 2, warrantyMonths: 24,
      notes: 'Includes rack-mount kit as requested. Spare unit available at an extra cost.',
      submittedAt: '2026-09-04T11:00:00Z',
    },
    {
      id: 'quote-wae-10082', rfqId: 'rfq-10082', supplierId: 'supplier-wae',
      items: [{ id: 'qi-2', productId: 'prod-cisco-switch', quantity: 50, unitPrice: 7650 }],
      totalPrice: 382500, deliveryDays: 4, warrantyMonths: 36,
      notes: 'Best price available for this volume. Rack-mount kit included.',
      submittedAt: '2026-09-05T09:30:00Z',
    },
  ];

  for (const q of quotes) {
    const { items, submittedAt, ...rest } = q;
    await db.quote.upsert({ where: { id: q.id }, update: { ...rest }, create: { ...rest, submittedAt: new Date(submittedAt) } });
    await db.quoteItem.deleteMany({ where: { quoteId: q.id } });
    await db.quoteItem.createMany({ data: items.map((i) => ({ ...i, quoteId: q.id })) });
  }

  const negotiations = [
    {
      id: 'neg-1', rfqId: 'rfq-10082', quoteId: 'quote-wae-10082', senderRole: 'BUYER' as const,
      senderUserId: 'user-john-doe',
      message: 'We can commit to 100 units if you can bring the price down further.',
      proposedQuantity: 100, sentAt: '2026-09-05T14:00:00Z',
    },
    {
      id: 'neg-2', rfqId: 'rfq-10082', quoteId: 'quote-wae-10082', senderRole: 'SUPPLIER' as const,
      message: 'We can offer ₵7,650 per unit for 100+ units, same delivery and warranty terms.',
      proposedPrice: 7650, proposedQuantity: 100, sentAt: '2026-09-05T16:20:00Z',
    },
  ];

  for (const n of negotiations) {
    const { sentAt, ...rest } = n;
    await db.negotiationMessage.upsert({ where: { id: n.id }, update: { ...rest }, create: { ...rest, sentAt: new Date(sentAt) } });
  }

  console.log(`Seeded ${users.length} users, ${companies.length} companies, ${memberships.length} memberships.`);
  console.log(`Seeded ${supplierProfiles.length} suppliers, ${categories.length} categories, ${products.length} products.`);
  console.log(`Seeded ${rfqs.length} RFQs, ${quotes.length} quotes, ${negotiations.length} negotiation messages.`);
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
