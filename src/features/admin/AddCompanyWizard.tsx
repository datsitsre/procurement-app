'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { companyService, type AddCompanyWizardInput } from '@/services/company.service';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { WorkflowStepper, type WorkflowStep } from '@/components/ui/WorkflowStepper';
import { useToast } from '@/components/ui/Toast';
import { RoleLabels } from '@/config/rbac';

const COUNTRY_OPTIONS = ['GH', 'NG', 'KE', 'ZA', 'CI'];
const CURRENCY_OPTIONS = ['GHS', 'NGN', 'KES', 'ZAR', 'XOF', 'USD'];
const COMPANY_TYPE_OPTIONS: { value: AddCompanyWizardInput['companyType']; label: string }[] = [
  { value: 'LIMITED_LIABILITY', label: 'Limited Liability Company' },
  { value: 'SOLE_PROPRIETORSHIP', label: 'Sole Proprietorship' },
  { value: 'PARTNERSHIP', label: 'Partnership' },
  { value: 'PUBLIC_LIMITED', label: 'Public Limited Company' },
  { value: 'NGO', label: 'NGO / Non-profit' },
  { value: 'GOVERNMENT', label: 'Government Entity' },
  { value: 'OTHER', label: 'Other' },
];
const BUSINESS_ROLE_OPTIONS: { value: AddCompanyWizardInput['businessRole']; label: string }[] = [
  { value: 'BUYER', label: 'Buyer' },
  { value: 'SUPPLIER', label: 'Supplier' },
  { value: 'BUYER_AND_SUPPLIER', label: 'Buyer + Supplier' },
];
const PAYMENT_METHOD_OPTIONS: { value: NonNullable<AddCompanyWizardInput['defaultPaymentMethod']>; label: string }[] = [
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CARD', label: 'Card' },
  { value: 'MTN_MOMO', label: 'MTN Mobile Money' },
  { value: 'TELECEL_CASH', label: 'Telecel Cash' },
  { value: 'AIRTELTIGO_MONEY', label: 'AirtelTigo Money' },
  { value: 'WALLET', label: 'Wallet' },
  { value: 'CREDIT_TERMS', label: 'Credit Terms' },
];
const CREDIT_TERM_OPTIONS = ['PREPAID', 'NET_7', 'NET_15', 'NET_30', 'NET_60'] as const;

const STEP_LABELS = ['Company', 'Address', 'Commercial', 'Banking', 'Administrator', 'Review'] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4 | 5;

interface WizardState {
  name: string;
  legalName: string;
  registrationNumber: string;
  companyType: AddCompanyWizardInput['companyType'] | '';
  email: string;
  phone: string;
  website: string;
  businessRole: AddCompanyWizardInput['businessRole'];
  addressLine1: string;
  country: string;
  currency: string;
  creditTerms: (typeof CREDIT_TERM_OPTIONS)[number];
  defaultPaymentMethod: AddCompanyWizardInput['defaultPaymentMethod'] | '';
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  adminName: string;
  adminEmail: string;
  adminPhone: string;
  adminRole: 'OWNER' | 'ADMIN';
}

const INITIAL_STATE: WizardState = {
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
};

/**
 * The Super Admin's multi-step Add Company wizard (Add Company / Initial Administrator Setup
 * phase) - replaces the previous single-dialog "name + country + currency" create flow for
 * *creation* specifically (editing an existing company still uses the simpler CompanyFormDialog
 * in the parent page, unchanged). Every field maps to a real, additive Company column (see
 * company.service.ts's own AddCompanyWizardInput comment) - nothing here is stored anywhere but
 * the real POST /api/admin/companies endpoint, and no client-side check here is the security
 * boundary (the server independently re-validates and re-derives the caller's own role).
 *
 * The initial administrator step reuses the exact same invitation architecture the company
 * Team page's own Add User flow uses - never an immediately-ACTIVE account with a temporary
 * password. WorkflowStepper (used elsewhere only as a read-only status indicator) is reused here
 * purely for the visual progress chrome; all step navigation/validation is this component's own.
 */
export function AddCompanyWizard({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState<StepIndex>(0);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ companyId: string; invitation?: { token: string; email: string; role: string } } | null>(null);
  const [copied, setCopied] = useState(false);

  function update<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function reset() {
    setStep(0);
    setState(INITIAL_STATE);
    setError(null);
    setCreated(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function validateStep(index: StepIndex): string | null {
    if (index === 0) {
      if (!state.name.trim()) return 'Enter a company/trading name.';
      if (!state.legalName.trim()) return 'Enter the legal/registered name.';
      if (!state.registrationNumber.trim()) return 'Enter the company registration number.';
      if (!state.companyType) return 'Choose a company type.';
      if (!state.email.trim()) return 'Enter the main email.';
      if (!state.phone.trim()) return 'Enter the main phone number.';
      if (!state.website.trim()) return 'Enter a website.';
      return null;
    }
    if (index === 1) {
      if (!state.addressLine1.trim()) return 'Enter an address.';
      if (!state.country) return 'Choose a country.';
      return null;
    }
    if (index === 4 && (state.adminName.trim() || state.adminEmail.trim())) {
      if (!state.adminName.trim()) return "Enter the administrator's name.";
      if (!state.adminEmail.trim()) return "Enter the administrator's email.";
    }
    return null;
  }

  function goNext() {
    const validationError = validateStep(step);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setStep((s) => Math.min(s + 1, 5) as StepIndex);
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0) as StepIndex);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    const hasAdmin = state.adminName.trim() && state.adminEmail.trim();
    const input: AddCompanyWizardInput = {
      name: state.name.trim(),
      legalName: state.legalName.trim(),
      registrationNumber: state.registrationNumber.trim(),
      companyType: state.companyType as AddCompanyWizardInput['companyType'],
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
      initialAdministrator: hasAdmin
        ? { name: state.adminName.trim(), email: state.adminEmail.trim(), phone: state.adminPhone.trim() || undefined, role: state.adminRole }
        : undefined,
    };
    const result = await companyService.createCompanyWithAdministrator(input);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    toast.show(`${state.name} created.`, 'success');
    setCreated({ companyId: result.data.id, invitation: result.data.invitation });
    onCreated();
  }

  async function copyLink() {
    if (!created?.invitation) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    await navigator.clipboard.writeText(`${origin}/accept-invitation?token=${created.invitation.token}`).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const steps: WorkflowStep[] = STEP_LABELS.map((label, i) => ({
    key: label,
    label,
    status: created ? 'done' : i < step ? 'done' : i === step ? 'current' : 'upcoming',
  }));

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Add company"
      size="lg"
      footer={
        created ? (
          <Button size="sm" onClick={handleClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={step === 0 ? handleClose : goBack} disabled={submitting}>
              {step === 0 ? 'Cancel' : 'Back'}
            </Button>
            {step < 5 ? (
              <Button size="sm" onClick={goNext}>
                Next
              </Button>
            ) : (
              <Button size="sm" onClick={handleSubmit} loading={submitting}>
                Create company
              </Button>
            )}
          </>
        )
      }
    >
      <div className="flex flex-col gap-6">
        {!created && (
          <div className="overflow-x-auto pb-2">
            <WorkflowStepper steps={steps} />
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {created ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-success">
              <Check className="h-5 w-5" aria-hidden="true" />
              <p className="font-medium">Company created successfully.</p>
            </div>
            {created.invitation ? (
              <div className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg p-3 text-sm">
                <p className="font-medium text-warning">
                  Invitation created for {created.invitation.email} ({created.invitation.role === 'OWNER' ? 'Owner' : 'Admin'}).
                </p>
                <p className="text-warning">Email delivery is not configured - copy this link and share it with them.</p>
                <p className="text-warning">It won&rsquo;t be shown again after you leave this dialog.</p>
                <div className="flex items-center gap-2">
                  <code className="overflow-x-auto rounded bg-surface px-2 py-1 font-mono text-xs">
                    {typeof window !== 'undefined' ? window.location.origin : ''}/accept-invitation?token={created.invitation.token}
                  </code>
                  <Button size="sm" variant="outline" onClick={copyLink}>
                    {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                    {copied ? 'Copied' : 'Copy link'}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-secondary">No initial administrator was set - add one later from the company&rsquo;s own Team page.</p>
            )}
          </div>
        ) : step === 0 ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Company / Trading Name" required value={state.name} onChange={(e) => update('name', e.target.value)} />
              <Input label="Legal / Registered Name" required value={state.legalName} onChange={(e) => update('legalName', e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Company Registration Number" required value={state.registrationNumber} onChange={(e) => update('registrationNumber', e.target.value)} />
              <Select label="Company Type" required value={state.companyType} onChange={(e) => update('companyType', e.target.value as WizardState['companyType'])}>
                <option value="">Select a type</option>
                {COMPANY_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Main Email" type="email" required value={state.email} onChange={(e) => update('email', e.target.value)} />
              <Input label="Main Phone" required value={state.phone} onChange={(e) => update('phone', e.target.value)} />
            </div>
            <Input label="Website" required placeholder="https://" value={state.website} onChange={(e) => update('website', e.target.value)} />
            <div>
              <label className="mb-1 block text-sm font-medium text-text-primary">
                Business Role <span className="text-danger">*</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {BUSINESS_ROLE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => update('businessRole', o.value)}
                    className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                      state.businessRole === o.value ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-secondary hover:bg-neutral-bg'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : step === 1 ? (
          <div className="flex flex-col gap-4">
            <Input label="Address Line 1" required value={state.addressLine1} onChange={(e) => update('addressLine1', e.target.value)} />
            <Select label="Country" required value={state.country} onChange={(e) => update('country', e.target.value)}>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <p className="text-caption text-text-tertiary">City and Region are not collected here - the company&rsquo;s own admin can add branch-level detail later.</p>
          </div>
        ) : step === 2 ? (
          <div className="flex flex-col gap-4">
            <Select label="Currency" required value={state.currency} onChange={(e) => update('currency', e.target.value)}>
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select label="Credit Terms" value={state.creditTerms} onChange={(e) => update('creditTerms', e.target.value as WizardState['creditTerms'])}>
              {CREDIT_TERM_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </Select>
            <Select label="Default Payment Method" value={state.defaultPaymentMethod} onChange={(e) => update('defaultPaymentMethod', e.target.value as WizardState['defaultPaymentMethod'])}>
              <option value="">Not set</option>
              {PAYMENT_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        ) : step === 3 ? (
          <div className="flex flex-col gap-4">
            <p className="text-caption text-text-tertiary">Optional. Treated as sensitive - never shown in company lists or activity feeds.</p>
            <Input label="Bank Name" value={state.bankName} onChange={(e) => update('bankName', e.target.value)} />
            <Input label="Bank Account Name" value={state.bankAccountName} onChange={(e) => update('bankAccountName', e.target.value)} />
            <Input label="Bank Account Number" value={state.bankAccountNumber} onChange={(e) => update('bankAccountNumber', e.target.value)} />
          </div>
        ) : step === 4 ? (
          <div className="flex flex-col gap-4">
            <p className="text-caption text-text-tertiary">
              Optional. If set, they&rsquo;ll receive a secure invitation link to accept and set their own password - never an immediately-active account with a
              temporary password.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Full Name" value={state.adminName} onChange={(e) => update('adminName', e.target.value)} />
              <Input label="Email" type="email" value={state.adminEmail} onChange={(e) => update('adminEmail', e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Phone" value={state.adminPhone} onChange={(e) => update('adminPhone', e.target.value)} />
              <Select label="Role" value={state.adminRole} onChange={(e) => update('adminRole', e.target.value as 'OWNER' | 'ADMIN')}>
                <option value="OWNER">{RoleLabels.OWNER}</option>
                <option value="ADMIN">{RoleLabels.ADMIN}</option>
              </Select>
            </div>
          </div>
        ) : (
          <ReviewStep state={state} onEditStep={setStep} />
        )}
      </div>
    </Dialog>
  );
}

function ReviewStep({ state, onEditStep }: { state: WizardState; onEditStep: (step: StepIndex) => void }) {
  const companyTypeLabel = COMPANY_TYPE_OPTIONS.find((o) => o.value === state.companyType)?.label;
  const businessRoleLabel = BUSINESS_ROLE_OPTIONS.find((o) => o.value === state.businessRole)?.label;
  const paymentMethodLabel = PAYMENT_METHOD_OPTIONS.find((o) => o.value === state.defaultPaymentMethod)?.label;
  const hasAdmin = state.adminName.trim() && state.adminEmail.trim();

  return (
    <div className="flex flex-col gap-5">
      <ReviewSection title="Company" onEdit={() => onEditStep(0)}>
        <ReviewField label="Trading Name" value={state.name} />
        <ReviewField label="Legal Name" value={state.legalName} />
        <ReviewField label="Registration Number" value={state.registrationNumber} />
        <ReviewField label="Company Type" value={companyTypeLabel} />
        <ReviewField label="Main Email" value={state.email} />
        <ReviewField label="Main Phone" value={state.phone} />
        <ReviewField label="Website" value={state.website} />
        <ReviewField label="Business Role" value={businessRoleLabel} />
      </ReviewSection>

      <ReviewSection title="Address" onEdit={() => onEditStep(1)}>
        <ReviewField label="Address Line 1" value={state.addressLine1} />
        <ReviewField label="Country" value={state.country} />
      </ReviewSection>

      <ReviewSection title="Commercial" onEdit={() => onEditStep(2)}>
        <ReviewField label="Currency" value={state.currency} />
        <ReviewField label="Credit Terms" value={state.creditTerms.replace('_', ' ')} />
        <ReviewField label="Default Payment Method" value={paymentMethodLabel ?? 'Not set'} />
      </ReviewSection>

      <ReviewSection title="Banking" onEdit={() => onEditStep(3)}>
        <ReviewField label="Bank Name" value={state.bankName || 'Not set'} />
        <ReviewField label="Bank Account Name" value={state.bankAccountName || 'Not set'} />
        <ReviewField label="Bank Account Number" value={state.bankAccountNumber ? maskAccountNumber(state.bankAccountNumber) : 'Not set'} />
      </ReviewSection>

      <ReviewSection title="Initial Administrator" onEdit={() => onEditStep(4)}>
        {hasAdmin ? (
          <>
            <ReviewField label="Name" value={state.adminName} />
            <ReviewField label="Email" value={state.adminEmail} />
            <ReviewField label="Phone" value={state.adminPhone || 'Not set'} />
            <ReviewField label="Role" value={RoleLabels[state.adminRole]} />
          </>
        ) : (
          <p className="text-sm text-text-secondary">None - add one later from the company&rsquo;s own Team page.</p>
        )}
      </ReviewSection>
    </div>
  );
}

/** Never shows the full account number back to the reviewer, even though they just typed it
 *  themselves - the review screen never reveals a password or invitation token either, and this
 *  keeps banking data consistently masked everywhere it's displayed, not just in responses. */
function maskAccountNumber(value: string): string {
  const digits = value.replace(/\s/g, '');
  if (digits.length <= 4) return digits;
  return `${'•'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function ReviewSection({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-h3">{title}</p>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</dl>
    </div>
  );
}

function ReviewField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-metadata">{label}</dt>
      <dd className="text-sm font-medium">{value || '—'}</dd>
    </div>
  );
}
