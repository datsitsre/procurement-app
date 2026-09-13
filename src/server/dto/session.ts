import 'server-only';
import { db } from '@/server/db';

/**
 * Builds the exact JSON shape src/services/auth.service.ts's `Session` interface expects (plus
 * a `companies` array the frontend uses to bridge into its still-mock company/product/order
 * data - see auth.service.ts's comment on `mergeIntoRuntimeCache` for why). Never includes
 * `passwordHash` - only DTO-mapped fields ever leave this module (section 36).
 */
export async function buildSessionPayload(userId: string, requestedActiveCompanyId?: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const memberships = await db.companyMembership.findMany({
    where: { userId, status: 'ACTIVE' },
    include: { company: { include: { addresses: true } } },
  });

  const activeCompanyId =
    (requestedActiveCompanyId && memberships.some((m) => m.companyId === requestedActiveCompanyId)
      ? requestedActiveCompanyId
      : memberships[0]?.companyId) ?? null;

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone ?? undefined,
      avatarUrl: user.avatarUrl ?? undefined,
      createdAt: user.createdAt.toISOString(),
    },
    memberships: memberships.map((m) => ({
      id: m.id,
      companyId: m.companyId,
      userId: m.userId,
      role: m.role,
      department: m.department ?? undefined,
      status: m.status,
      invitedAt: m.invitedAt?.toISOString(),
      joinedAt: m.joinedAt?.toISOString(),
    })),
    activeCompanyId,
    companies: memberships.map((m) => ({
      id: m.company.id,
      name: m.company.name,
      legalName: m.company.legalName ?? undefined,
      registrationNumber: m.company.registrationNumber ?? undefined,
      taxId: m.company.taxId ?? undefined,
      industry: m.company.industry ?? undefined,
      website: m.company.website ?? undefined,
      phone: m.company.phone ?? undefined,
      email: m.company.email ?? undefined,
      description: m.company.description ?? undefined,
      country: m.company.country,
      currency: m.company.currency,
      logoUrl: m.company.logoUrl ?? undefined,
      addresses: m.company.addresses.map((a) => ({
        id: a.id,
        label: a.label,
        line1: a.line1,
        line2: a.line2 ?? undefined,
        city: a.city,
        region: a.region ?? undefined,
        country: a.country,
        postalCode: a.postalCode ?? undefined,
        isDefault: a.isDefault,
      })),
      creditTerms: m.company.creditTerms,
      creditLimit: m.company.creditLimit ? Number(m.company.creditLimit) : undefined,
      creditAvailable: m.company.creditAvailable ? Number(m.company.creditAvailable) : undefined,
      isSupplier: m.company.isSupplier,
      isBuyer: m.company.isBuyer,
      parentGroupId: m.company.parentGroupId ?? undefined,
      createdAt: m.company.createdAt.toISOString(),
    })),
  };
}

export type SessionPayload = NonNullable<Awaited<ReturnType<typeof buildSessionPayload>>>;
