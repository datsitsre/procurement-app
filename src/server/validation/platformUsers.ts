import { z } from 'zod';

export const DecideRegistrationSchema = z.object({
  companyId: z.string().trim().min(1, 'companyId is required'),
  decision: z.enum(['APPROVED', 'REJECTED']),
});

export const SetMembershipStatusSchema = z.object({
  companyId: z.string().trim().min(1, 'companyId is required'),
  status: z.enum(['SUSPENDED', 'ACTIVE']),
});

export const ChangePlatformRoleSchema = z.object({
  companyId: z.string().trim().min(1, 'companyId is required'),
  role: z.enum(['PLATFORM_MANAGER', 'PLATFORM_SUPER_ADMIN']),
});

export const NewPlatformInvitationSchema = z.object({
  email: z.string().trim().min(1, 'Enter an email address').max(254).email('Enter a valid email address'),
  name: z.string().trim().min(1, "Enter this person's name").max(200),
  // Never the legacy PLATFORM_ADMIN - "do not grant this role to new accounts" (rbac.ts's own
  // comment on that role), same restriction changePlatformRole already enforces.
  role: z.enum(['PLATFORM_MANAGER', 'PLATFORM_SUPER_ADMIN']),
});
