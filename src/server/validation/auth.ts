import { z } from 'zod';
import { PHONE_REGEX } from './company';

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

/** PUBLIC COMPANY REGISTRATION PAGE phase - the richer sibling of RegisterSchema above, reached
 *  from the login page's own "Create an account" link (/register/company), distinct from the
 *  plain company-name/country/currency flow RegisterSchema still serves (still reachable from the
 *  marketing landing page's own "Get started" buttons - untouched, not a route this phase owns).
 *  Reuses every enum/regex the Super Admin Add Company wizard already validates against
 *  (AddCompanyWizardSchema in server/validation/company.ts) - this is the same field vocabulary,
 *  never a second one, just collected from a public, unauthenticated visitor instead of a
 *  platform admin. `administrator` describes the person submitting the form themselves (see
 *  registerCompanyPublicly's own comment on why no invitation is issued here), so it carries its
 *  own `password` field - the same "password collected directly, hashed, immediately usable"
 *  architecture RegisterSchema's self-registration already uses, not the Add Company wizard's
 *  secure-invitation-link pattern (that pattern exists specifically because a platform admin is
 *  vouching for and inviting a *different* person; here the registrant and the administrator are
 *  the same person, so there is no one else to invite). */
export const RegisterCompanySchema = z.object({
  // Company information
  name: z.string().trim().min(1, 'Give the company a name').max(200),
  legalName: z.string().trim().min(1, 'Enter the legal/registered name').max(200),
  registrationNumber: z.string().trim().min(1, 'Enter the company registration number').max(100),
  companyType: z.enum(['LIMITED_LIABILITY', 'SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'PUBLIC_LIMITED', 'NGO', 'GOVERNMENT', 'OTHER']),
  email: z.string().trim().min(1, 'Enter the main email').max(254).email('Enter a valid email address'),
  phone: z.string().trim().min(1, 'Enter the main phone number').max(50).regex(PHONE_REGEX, 'Enter a valid phone number'),
  website: z.string().trim().min(1, 'Enter a website').max(300).url('Enter a valid website URL (include https://)'),
  businessRole: z.enum(['BUYER', 'SUPPLIER', 'BUYER_AND_SUPPLIER']),

  // Address (deliberately no city/region - see Address model's own schema comment)
  addressLine1: z.string().trim().min(1, 'Enter an address').max(300),
  country: z.enum(['GH', 'NG', 'KE', 'ZA', 'CI']),

  // Commercial
  currency: z.enum(['GHS', 'NGN', 'KES', 'ZAR', 'XOF', 'USD']),
  creditTerms: z.enum(['PREPAID', 'NET_7', 'NET_15', 'NET_30', 'NET_60']).optional(),
  defaultPaymentMethod: z.enum(['CARD', 'BANK_TRANSFER', 'MTN_MOMO', 'TELECEL_CASH', 'AIRTELTIGO_MONEY', 'WALLET', 'CREDIT_TERMS']).optional(),

  // Banking (optional, sensitive - see Company.bankName's own schema comment)
  bankName: z.string().trim().max(200).optional(),
  bankAccountName: z.string().trim().max(200).optional(),
  bankAccountNumber: z.string().trim().max(50).optional(),

  // Initial administrator - the registering visitor themselves, never a platform/supplier role
  administrator: z.object({
    name: z.string().trim().min(1, 'Enter your full name').max(200),
    email: z.string().trim().min(1, 'Enter an email address').max(254).email('Enter a valid email address'),
    phone: z.string().trim().max(50).regex(PHONE_REGEX, 'Enter a valid phone number').optional().or(z.literal('')),
    role: z.enum(['OWNER', 'ADMIN']).default('OWNER'),
    password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  }),
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
