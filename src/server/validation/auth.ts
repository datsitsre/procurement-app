import { z } from 'zod';

/** Server-side input validation (section 10) for every auth mutation. Rejected before any
 *  business logic runs - a malformed request never reaches password hashing, session creation,
 *  or the database at all. */

export const LoginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').max(254).email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required').max(200),
});

export const RegisterSchema = z.object({
  companyName: z.string().trim().min(2, 'Company name is required').max(200),
  country: z.enum(['GH', 'NG', 'KE', 'ZA', 'CI']),
  currency: z.enum(['GHS', 'NGN', 'KES', 'ZAR', 'XOF', 'USD']),
  fullName: z.string().trim().min(2, 'Full name is required').max(200),
  email: z.string().trim().min(1, 'Email is required').max(254).email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(200),
});

export const SwitchCompanySchema = z.object({
  companyId: z.string().trim().min(1, 'companyId is required'),
});

export const CompletePasswordResetSchema = z.object({
  token: z.string().trim().min(1, 'A reset token is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

export const AcceptInvitationSchema = z.object({
  token: z.string().trim().min(1, 'An invitation token is required'),
  // Only required when accepting creates a brand-new account - the service itself checks that
  // once it knows whether an account already exists for the invitation's email.
  password: z.string().min(8, 'Password must be at least 8 characters').max(200).optional(),
  name: z.string().trim().max(200).optional(),
});
