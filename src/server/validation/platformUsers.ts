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
