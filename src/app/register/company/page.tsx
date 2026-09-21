'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { authService, type RegisterCompanyInput } from '@/services/auth.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

const COUNTRY_OPTIONS = [
  { value: 'GH', label: 'Ghana' },
  { value: 'NG', label: 'Nigeria' },
  { value: 'KE', label: 'Kenya' },
  { value: 'ZA', label: 'South Africa' },
  { value: 'CI', label: "Côte d'Ivoire" },
];
const CURRENCY_OPTIONS = ['GHS', 'NGN', 'KES', 'ZAR', 'XOF', 'USD'];
const COMPANY_TYPE_OPTIONS: { value: RegisterCompanyInput['companyType']; label: string }[] = [
  { value: 'LIMITED_LIABILITY', label: 'Limited Liability Company' },
  { value: 'SOLE_PROPRIETORSHIP', label: 'Sole Proprietorship' },
  { value: 'PARTNERSHIP', label: 'Partnership' },
  { value: 'PUBLIC_LIMITED', label: 'Public Limited Company' },
  { value: 'NGO', label: 'NGO / Non-profit' },
  { value: 'GOVERNMENT', label: 'Government Entity' },
  { value: 'OTHER', label: 'Other' },
];
const BUSINESS_ROLE_OPTIONS: { value: RegisterCompanyInput['businessRole']; label: string }[] = [
  { value: 'BUYER', label: 'Buyer' },
  { value: 'SUPPLIER', label: 'Supplier' },
  { value: 'BUYER_AND_SUPPLIER', label: 'Buyer + Supplier' },
];
const PAYMENT_METHOD_OPTIONS: { value: NonNullable<RegisterCompanyInput['defaultPaymentMethod']>; label: string }[] = [
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CARD', label: 'Card' },
  { value: 'MTN_MOMO', label: 'MTN Mobile Money' },
  { value: 'TELECEL_CASH', label: 'Telecel Cash' },
  { value: 'AIRTELTIGO_MONEY', label: 'AirtelTigo Money' },
  { value: 'WALLET', label: 'Wallet' },
  { value: 'CREDIT_TERMS', label: 'Credit Terms' },
];
const CREDIT_TERM_OPTIONS = ['PREPAID', 'NET_7', 'NET_15', 'NET_30', 'NET_60'] as const;

interface FormState {
  name: string;
  legalName: string;
  registrationNumber: string;
  companyType: RegisterCompanyInput['companyType'] | '';
  email: string;
  phone: string;
  website: string;
  businessRole: RegisterCompanyInput['businessRole'];
  addressLine1: string;
  country: string;
  currency: string;
  creditTerms: (typeof CREDIT_TERM_OPTIONS)[number];
  defaultPaymentMethod: RegisterCompanyInput['defaultPaymentMethod'] | '';
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  adminName: string;
  adminEmail: string;
  adminPhone: string;
  adminRole: 'OWNER' | 'ADMIN';
  password: string;
}

const INITIAL_STATE: FormState = {
  name: '',
  legalName: '',
  registrationNumber: '',
  companyType: '',
  email: '',
  phone: '',
  website: '',
  businessRole: 'BUYER',
  addressLine1: '',
  country: 'GH',
  currency: 'GHS',
  creditTerms: 'NET_30',
  defaultPaymentMethod: '',
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  adminName: '',
  adminEmail: '',
  adminPhone: '',
  adminRole: 'OWNER',
  password: '',
};

/**
 * PUBLIC COMPANY REGISTRATION PAGE phase - reached from the login page's own "Create an account"
 * link. Distinct from:
 *   - /register - the plain company-name/country/currency flow, still reachable from the
 *     marketing landing page's own "Get started" buttons; left completely unmodified.
 *   - /admin/companies "Add company" (AddCompanyWizard) - the Super Admin's authenticated,
 *     permission-gated creation flow, which invites a *different* person as administrator.
 *
 * Uses the same field vocabulary as the Add Company wizard (company/address/commercial/banking),
 * but this visitor IS the initial administrator - there is no one else to invite, so a password
 * is collected directly here, matching /register's own existing self-registration architecture
 * (a real account, hashed password, immediately usable once approved) rather than the wizard's
 * secure-invitation-link pattern. Every submission lands in the same PENDING_APPROVAL lifecycle
 * /register already established - nothing here is auto-activated.
 */
export default function RegisterCompanyPage() {
  const [state, setState] = useState<FormState>(INITIAL_STATE);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // Set specifically when the server rejects with ACCOUNT_EXISTS (SECURITY HARDENING phase) -
  // distinct from `error` so the page can show a "Sign in to continue" action instead of a plain
  // error banner, without the message itself needing to carry that instruction.
  const [accountExists, setAccountExists] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ companyName: string; email: string } | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function validate(): string | null {
    if (!state.name.trim()) return 'Enter a company/trading name.';
    if (!state.legalName.trim()) return 'Enter the legal/registered name.';
    if (!state.registrationNumber.trim()) return 'Enter the company registration number.';
    if (!state.companyType) return 'Choose a company type.';
    if (!state.email.trim()) return 'Enter the main email.';
    if (!state.phone.trim()) return 'Enter the main phone number.';
    if (!state.website.trim()) return 'Enter a website.';
    if (!state.addressLine1.trim()) return 'Enter an address.';
    if (!state.country) return 'Choose a country.';
    if (!state.currency) return 'Choose a currency.';
    if (!state.adminName.trim()) return 'Enter your full name.';
    if (!state.adminEmail.trim()) return 'Enter your email address.';
    if (state.password.length < 8) return 'Choose a password of at least 8 characters.';
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    setAccountExists(false);
    setFieldErrors({});

    const input: RegisterCompanyInput = {
      name: state.name.trim(),
      legalName: state.legalName.trim(),
      registrationNumber: state.registrationNumber.trim(),
      companyType: state.companyType as RegisterCompanyInput['companyType'],
      email: state.email.trim(),
      phone: state.phone.trim(),
      website: state.website.trim(),
      businessRole: state.businessRole,
      addressLine1: state.addressLine1.trim(),
      country: state.country,
      currency: state.currency,
      creditTerms: state.creditTerms,
      defaultPaymentMethod: state.defaultPaymentMethod || undefined,
      bankName: state.bankName.trim() || undefined,
      bankAccountName: state.bankAccountName.trim() || undefined,
      bankAccountNumber: state.bankAccountNumber.trim() || undefined,
      administrator: {
        name: state.adminName.trim(),
        email: state.adminEmail.trim(),
        phone: state.adminPhone.trim() || undefined,
        role: state.adminRole,
        password: state.password,
      },
    };

    const response = await authService.registerCompany(input);
    setSubmitting(false);
    if (!response.ok) {
      if (response.error.code === 'ACCOUNT_EXISTS') {
        setAccountExists(true);
        return;
      }
      setError(response.error.message);
      setFieldErrors(response.error.fieldErrors ?? {});
      return;
    }
    setResult({ companyName: response.data.company.name, email: response.data.company.registeredEmail });
  }

  if (accountExists) {
    return (
      <PageShell>
        <div className="rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
          <h1 className="text-h2 mb-2">Account already exists</h1>
          <p className="text-body mb-6 text-text-secondary">An account already exists for this email. Sign in to continue.</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href="/login">
              <Button className="w-full sm:w-auto">Sign in</Button>
            </Link>
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setAccountExists(false)}>
              Use a different email
            </Button>
          </div>
        </div>
      </PageShell>
    );
  }

  if (result) {
    return (
      <PageShell>
        <div className="rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-h2 mb-2">Company registration submitted</h1>
          <p className="text-body mb-6 text-text-secondary">Your company registration is now pending review.</p>

          <dl className="mb-6 flex flex-col gap-3 rounded-lg border border-border bg-neutral-bg p-4 text-left">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-caption">Company name</dt>
              <dd className="text-sm font-medium">{result.companyName}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-caption">Registered email</dt>
              <dd className="text-sm font-medium">{result.email}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-caption">Status</dt>
              <dd className="text-sm font-medium text-warning">Pending review</dd>
            </div>
          </dl>

          <p className="mb-6 text-sm text-text-secondary">
            A platform administrator needs to review and approve this registration before you can sign in.
          </p>

          <Link href="/login">
            <Button className="w-full">Return to sign in</Button>
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-8 rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
        {error && (
          <div role="alert" className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <FormSection title="Company information">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Company / Trading Name" required value={state.name} onChange={(e) => update('name', e.target.value)} />
            <Input label="Legal / Registered Name" required value={state.legalName} onChange={(e) => update('legalName', e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Company Registration Number"
              required
              value={state.registrationNumber}
              onChange={(e) => update('registrationNumber', e.target.value)}
            />
            <Select label="Company Type" required value={state.companyType} onChange={(e) => update('companyType', e.target.value as FormState['companyType'])}>
              <option value="">Select a type</option>
              {COMPANY_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Main Email" type="email" required value={state.email} onChange={(e) => update('email', e.target.value)} error={fieldErrors.email} />
            <Input label="Main Phone" required value={state.phone} onChange={(e) => update('phone', e.target.value)} error={fieldErrors.phone} />
          </div>
          <Input label="Website" required placeholder="https://" value={state.website} onChange={(e) => update('website', e.target.value)} error={fieldErrors.website} />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-primary">
              Business Role <span className="text-danger">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {BUSINESS_ROLE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => update('businessRole', o.value)}
                  aria-pressed={state.businessRole === o.value}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    state.businessRole === o.value ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-secondary hover:bg-neutral-bg'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </FormSection>

        <FormSection title="Address">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Address Line 1" required value={state.addressLine1} onChange={(e) => update('addressLine1', e.target.value)} />
            <Select label="Country" required value={state.country} onChange={(e) => update('country', e.target.value)}>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        </FormSection>

        <FormSection title="Commercial information">
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Currency" required value={state.currency} onChange={(e) => update('currency', e.target.value)}>
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select label="Credit Terms" value={state.creditTerms} onChange={(e) => update('creditTerms', e.target.value as FormState['creditTerms'])}>
              {CREDIT_TERM_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </Select>
            <Select
              label="Default Payment Method"
              value={state.defaultPaymentMethod}
              onChange={(e) => update('defaultPaymentMethod', e.target.value as FormState['defaultPaymentMethod'])}
            >
              <option value="">Not set</option>
              {PAYMENT_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        </FormSection>

        <FormSection title="Banking information" hint="Optional. Treated as sensitive - never shown in company lists or activity feeds.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Bank Name" value={state.bankName} onChange={(e) => update('bankName', e.target.value)} />
            <Input label="Bank Account Name" value={state.bankAccountName} onChange={(e) => update('bankAccountName', e.target.value)} />
            <Input label="Bank Account Number" value={state.bankAccountNumber} onChange={(e) => update('bankAccountNumber', e.target.value)} />
          </div>
        </FormSection>

        <FormSection title="Initial administrator" hint="This is you - you'll be the first administrator of this company's procurement workspace.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full Name" required value={state.adminName} onChange={(e) => update('adminName', e.target.value)} />
            <Input label="Email" type="email" required value={state.adminEmail} onChange={(e) => update('adminEmail', e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Phone" value={state.adminPhone} onChange={(e) => update('adminPhone', e.target.value)} />
            <Select label="Role" required value={state.adminRole} onChange={(e) => update('adminRole', e.target.value as 'OWNER' | 'ADMIN')}>
              <option value="OWNER">Owner</option>
              <option value="ADMIN">Admin</option>
            </Select>
          </div>
          <Input
            label="Password"
            type="password"
            required
            value={state.password}
            onChange={(e) => update('password', e.target.value)}
            hint="At least 8 characters"
            error={fieldErrors.password}
          />
        </FormSection>

        <Button type="submit" loading={submitting} className="w-full">
          Create company
        </Button>
      </form>
    </PageShell>
  );
}

function FormSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <legend className="mb-1 text-h3">{title}</legend>
      {hint && <p className="-mt-2 text-caption text-text-tertiary">{hint}</p>}
      {children}
    </fieldset>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">N</span>
            <span className="text-h3">NorthCiti Procurement</span>
          </div>
          <p className="text-sm text-text-secondary">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-accent hover:underline">
              Sign in
            </Link>
          </p>
        </div>

        <div>
          <h1 className="text-h1">Create company</h1>
          <p className="text-body text-text-secondary">Register your company on the procurement platform.</p>
        </div>

        {children}
      </div>
    </div>
  );
}
