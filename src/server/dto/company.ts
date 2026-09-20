import 'server-only';
import type { Branch, Company, CompanyUser, CostCenter, Department, User } from '@/types/company';
import type {
  Branch as PrismaBranch,
  Company as PrismaCompany,
  CompanyMembership as PrismaCompanyMembership,
  CostCenter as PrismaCostCenter,
  Department as PrismaDepartment,
  User as PrismaUser,
  Address as PrismaAddress,
} from '@prisma/client';

/** Maps Prisma's generated model shapes to the exact frontend types (src/types/company.ts) -
 *  Decimal -> number, Date -> ISO string, null -> undefined, never a raw ORM entity crossing
 *  the API boundary (section 36's "use DTOs, not raw database entities" rule). */

export function toCompanyDto(company: PrismaCompany & { addresses?: PrismaAddress[]; parentGroup?: { name: string } | null }): Company {
  return {
    id: company.id,
    name: company.name,
    legalName: company.legalName ?? undefined,
    registrationNumber: company.registrationNumber ?? undefined,
    taxId: company.taxId ?? undefined,
    industry: company.industry ?? undefined,
    website: company.website ?? undefined,
    phone: company.phone ?? undefined,
    email: company.email ?? undefined,
    description: company.description ?? undefined,
    country: company.country as Company['country'],
    currency: company.currency as Company['currency'],
    logoUrl: company.logoUrl ?? undefined,
    addresses: (company.addresses ?? []).map((a) => ({
      id: a.id,
      label: a.label,
      line1: a.line1,
      line2: a.line2 ?? undefined,
      // Nullable in the database (the Add Company wizard deliberately doesn't collect it) but
      // kept as a required string on the DTO boundary, matching every existing consumer of this
      // shape (checkout address pickers, etc.) - '' reads as "not provided", never a fabricated
      // real-looking city name.
      city: a.city ?? '',
      region: a.region ?? undefined,
      country: a.country as Company['country'],
      postalCode: a.postalCode ?? undefined,
      isDefault: a.isDefault,
    })),
    creditTerms: company.creditTerms,
    creditLimit: company.creditLimit ? Number(company.creditLimit) : undefined,
    creditAvailable: company.creditAvailable ? Number(company.creditAvailable) : undefined,
    isSupplier: company.isSupplier,
    isBuyer: company.isBuyer,
    parentGroupId: company.parentGroupId ?? undefined,
    parentGroupName: company.parentGroup?.name ?? undefined,
    createdAt: company.createdAt.toISOString(),
    status: company.status,
    updatedAt: company.updatedAt.toISOString(),
  };
}

export function toDepartmentDto(d: PrismaDepartment): Department {
  return { id: d.id, companyId: d.companyId, name: d.name };
}

export function toCostCenterDto(c: PrismaCostCenter): CostCenter {
  return { id: c.id, companyId: c.companyId, code: c.code, name: c.name, departmentId: c.departmentId ?? undefined };
}

export function toBranchDto(b: PrismaBranch): Branch {
  return {
    id: b.id,
    companyId: b.companyId,
    name: b.name,
    addressId: b.addressId,
    contactName: b.contactName ?? undefined,
    contactPhone: b.contactPhone ?? undefined,
    costCenterId: b.costCenterId ?? undefined,
    isWarehouse: b.isWarehouse,
    isHeadOffice: b.isHeadOffice,
    createdAt: b.createdAt.toISOString(),
  };
}

export function toMembershipDto(m: PrismaCompanyMembership): CompanyUser {
  return {
    id: m.id,
    companyId: m.companyId,
    userId: m.userId,
    role: m.role,
    department: m.department ?? undefined,
    status: m.status,
    invitedAt: m.invitedAt?.toISOString(),
    joinedAt: m.joinedAt?.toISOString(),
  };
}

export function toUserDto(u: PrismaUser): User {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone ?? undefined,
    avatarUrl: u.avatarUrl ?? undefined,
    createdAt: u.createdAt.toISOString(),
  };
}
