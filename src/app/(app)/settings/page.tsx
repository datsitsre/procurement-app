'use client';

import { useActiveCompany, useActiveMembership, useWorkspace } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { RoleLabels } from '@/config/rbac';
import { formatMoney } from '@/utils/format';

export default function SettingsPage() {
  const workspace = useWorkspace();
  const company = useActiveCompany();
  const membership = useActiveMembership();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Company profile</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Company name" value={company?.name} />
            <Field label="Country" value={company?.country} />
            <Field label="Currency" value={company?.currency} />
            {workspace === 'buyer' && <Field label="Payment terms" value={company?.creditTerms.replace('_', ' ')} />}
            {workspace === 'buyer' && company?.creditLimit !== undefined && (
              <Field label="Credit limit" value={formatMoney(company.creditLimit, company.currency)} />
            )}
            {workspace === 'buyer' && company?.creditAvailable !== undefined && (
              <Field label="Credit available" value={formatMoney(company.creditAvailable, company.currency)} />
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your access</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Role" value={membership && RoleLabels[membership.role]} />
            <Field label="Department" value={membership?.department ?? '—'} />
            <Field label="Status" value={membership?.status} />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-metadata">{label}</dt>
      <dd className="text-sm font-medium">{value ?? '—'}</dd>
    </div>
  );
}
