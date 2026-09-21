'use client';

import { useMemo, useState } from 'react';
import { UserCheck, Search } from 'lucide-react';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { useAsyncData } from '@/hooks/useAsyncData';
import { platformUsersService, type PlatformUserRow } from '@/services/platformUsers.service';
import { RoleLabels } from '@/config/rbac';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/utils/format';

const COMPANY_TYPE_LABELS: Record<string, string> = {
  LIMITED_LIABILITY: 'Limited Liability Company',
  SOLE_PROPRIETORSHIP: 'Sole Proprietorship',
  PARTNERSHIP: 'Partnership',
  PUBLIC_LIMITED: 'Public Limited Company',
  NGO: 'NGO / Non-profit',
  GOVERNMENT: 'Government Entity',
  OTHER: 'Other',
};

const BUSINESS_ROLE_LABELS: Record<string, string> = {
  BUYER: 'Buyer',
  SUPPLIER: 'Supplier',
  BUYER_AND_SUPPLIER: 'Buyer + Supplier',
  NONE: 'Not set',
};

const STATUS_TABS = [
  { value: 'PENDING_APPROVAL', label: 'Pending' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'ALL', label: 'All' },
];

/**
 * PLATFORM COMPANY REGISTRATION APPROVAL WORKFLOW phase - still the exact same approval
 * mechanism the prior "focused view of pending registrations" comment described: every row here
 * is a real CompanyMembership with status PENDING_APPROVAL or REJECTED, decided through the same
 * platformUsersService.decideRegistration() -> PATCH /api/admin/platform/users/[userId]/registration
 * -> decideRegistration() (server/services/platformUsers.service.ts) call path that already
 * existed - never a second approval system. What changed is purely presentational: the queue now
 * shows the full company-registration detail (server/services/platformUsers.service.ts's own
 * PlatformCompanyRegistrationDetail, joined onto every row) instead of just name/email/company,
 * a Rejected/All filter so decided registrations remain visible (not just hidden once decided),
 * and a Review drawer for the full picture before deciding. Banking fields are never fetched by
 * the underlying query at all (see listPlatformUsers's own comment) - there is nothing for this
 * page to accidentally render even by mistake.
 */
export default function AdminApprovalsPage() {
  return (
    <AdminGuard>
      <ApprovalsQueue />
    </AdminGuard>
  );
}

function ApprovalsQueue() {
  const { data: users, error, reload } = useAsyncData<PlatformUserRow[]>('admin-approvals', () => platformUsersService.listPlatformUsers());
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<string>('PENDING_APPROVAL');
  const [search, setSearch] = useState('');
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<PlatformUserRow | null>(null);
  const [confirming, setConfirming] = useState<{ row: PlatformUserRow; decision: 'APPROVED' | 'REJECTED' } | null>(null);

  const key = (u: PlatformUserRow) => `${u.userId}:${u.companyId}`;

  // Every row this page ever shows already came back scoped to registrations/decided-registrations/
  // platform-role holders (listPlatformUsers's own query) - this filters that further down to just
  // the registration rows (PENDING_APPROVAL/REJECTED), never a platform-role grant, matching what
  // section 2/3 of this phase calls "Company Registrations".
  const registrations = useMemo(() => (users ?? []).filter((u) => u.status === 'PENDING_APPROVAL' || u.status === 'REJECTED'), [users]);

  const filtered = useMemo(() => {
    const byStatus = statusFilter === 'ALL' ? registrations : registrations.filter((u) => u.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter(
      (u) => u.companyName.toLowerCase().includes(q) || u.userEmail.toLowerCase().includes(q) || u.companyRegistration.email?.toLowerCase().includes(q),
    );
  }, [registrations, statusFilter, search]);

  const counts = useMemo(
    () => ({
      PENDING_APPROVAL: registrations.filter((u) => u.status === 'PENDING_APPROVAL').length,
      REJECTED: registrations.filter((u) => u.status === 'REJECTED').length,
      ALL: registrations.length,
    }),
    [registrations],
  );

  async function decide(u: PlatformUserRow, decision: 'APPROVED' | 'REJECTED') {
    setActingKey(key(u));
    const result = await platformUsersService.decideRegistration(u.userId, u.companyId, decision);
    setActingKey(null);
    setConfirming(null);
    if (!result.ok) return toast.show(result.error.message, 'error');
    toast.show(`${u.companyName}'s registration ${decision === 'APPROVED' ? 'approved' : 'rejected'}.`, 'success');
    if (reviewing && key(reviewing) === key(u)) setReviewing(null);
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Approvals</h1>
        <p className="text-body text-text-secondary">Review company registrations awaiting platform approval.</p>
      </div>

      {error ? (
        <ErrorState title="Couldn't load pending approvals" description={error} secondaryAction={{ label: 'Try again', onClick: reload }} />
      ) : users === null ? (
        <SkeletonTable rows={4} columns={6} />
      ) : (
        <>
          <Tabs items={STATUS_TABS.map((t) => ({ ...t, count: counts[t.value as keyof typeof counts] }))} value={statusFilter} onChange={setStatusFilter}>
            {() => null}
          </Tabs>

          <div className="max-w-xs">
            <Input
              placeholder="Search company or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              leadingIcon={<Search className="h-4 w-4" aria-hidden="true" />}
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={UserCheck}
              title={statusFilter === 'REJECTED' ? 'No rejected registrations' : 'No pending approvals'}
              description="Company registrations awaiting review will appear here."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-table">
                <thead>
                  <tr className="text-metadata">
                    <th className="p-4 text-left">Company</th>
                    <th className="p-4 text-left">Type</th>
                    <th className="p-4 text-left">Business Role</th>
                    <th className="p-4 text-left">Main Email</th>
                    <th className="p-4 text-left">Country</th>
                    <th className="p-4 text-left">Submitted</th>
                    <th className="p-4 text-left">Initial Administrator</th>
                    <th className="p-4 text-left">Status</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr key={key(u)} className="border-t border-border">
                      <td className="p-4">
                        <p className="font-medium">{u.companyName}</p>
                        {u.companyRegistration.legalName && u.companyRegistration.legalName !== u.companyName && (
                          <p className="text-caption">{u.companyRegistration.legalName}</p>
                        )}
                        {u.companyRegistration.registrationNumber && <p className="text-caption">Reg. {u.companyRegistration.registrationNumber}</p>}
                      </td>
                      <td className="p-4 text-text-secondary">{COMPANY_TYPE_LABELS[u.companyRegistration.companyType ?? ''] ?? '—'}</td>
                      <td className="p-4 text-text-secondary">{BUSINESS_ROLE_LABELS[u.companyRegistration.businessRole]}</td>
                      <td className="p-4 text-text-secondary">{u.companyRegistration.email ?? '—'}</td>
                      <td className="p-4 text-text-secondary">{u.companyRegistration.country}</td>
                      <td className="p-4 text-text-secondary">{formatDate(u.createdAt)}</td>
                      <td className="p-4">
                        <p className="font-medium">{u.userName}</p>
                        <p className="text-caption">
                          {u.userEmail} · {RoleLabels[u.role] ?? u.role}
                        </p>
                      </td>
                      <td className="p-4">
                        <StatusBadge domain="membership" status={u.status} />
                      </td>
                      <td className="p-4">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setReviewing(u)}>
                            Review
                          </Button>
                          {u.status === 'PENDING_APPROVAL' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                loading={actingKey === key(u)}
                                onClick={() => setConfirming({ row: u, decision: 'REJECTED' })}
                              >
                                Reject
                              </Button>
                              <Button size="sm" loading={actingKey === key(u)} onClick={() => setConfirming({ row: u, decision: 'APPROVED' })}>
                                Approve
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {reviewing && (
        <RegistrationDetailDrawer
          row={reviewing}
          onClose={() => setReviewing(null)}
          onApprove={() => setConfirming({ row: reviewing, decision: 'APPROVED' })}
          onReject={() => setConfirming({ row: reviewing, decision: 'REJECTED' })}
          acting={actingKey === key(reviewing)}
        />
      )}

      <ConfirmationDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          if (confirming) await decide(confirming.row, confirming.decision);
        }}
        title={confirming?.decision === 'APPROVED' ? 'Approve registration?' : 'Reject registration?'}
        description={
          confirming?.decision === 'APPROVED'
            ? `${confirming.row.companyName} will become an active organization and its initial administrator will receive company access.`
            : `Reject ${confirming?.row.companyName}'s company registration? This cannot be undone through this queue.`
        }
        confirmLabel={confirming?.decision === 'APPROVED' ? 'Approve' : 'Reject'}
        destructive={confirming?.decision === 'REJECTED'}
      />
    </div>
  );
}

function RegistrationDetailDrawer({
  row,
  onClose,
  onApprove,
  onReject,
  acting,
}: {
  row: PlatformUserRow;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  acting: boolean;
}) {
  const c = row.companyRegistration;
  return (
    <Drawer
      open
      onClose={onClose}
      title={row.companyName}
      footer={
        row.status === 'PENDING_APPROVAL' ? (
          <>
            <Button variant="outline" size="sm" onClick={onReject} loading={acting}>
              Reject
            </Button>
            <Button size="sm" onClick={onApprove} loading={acting}>
              Approve
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <StatusBadge domain="membership" status={row.status} />
          <span className="text-caption">Submitted {formatDate(row.createdAt)}</span>
        </div>

        <DetailSection title="Company">
          <DetailField label="Trading Name" value={row.companyName} />
          <DetailField label="Legal Name" value={c.legalName} />
          <DetailField label="Registration Number" value={c.registrationNumber} />
          <DetailField label="Company Type" value={COMPANY_TYPE_LABELS[c.companyType ?? '']} />
          <DetailField label="Main Email" value={c.email} />
          <DetailField label="Main Phone" value={c.phone} />
          <DetailField label="Website" value={c.website} />
          <DetailField label="Buyer/Supplier" value={BUSINESS_ROLE_LABELS[c.businessRole]} />
        </DetailSection>

        <DetailSection title="Address">
          <DetailField label="Address Line 1" value={c.addressLine1} />
          <DetailField label="Country" value={c.country} />
        </DetailSection>

        <DetailSection title="Commercial">
          <DetailField label="Currency" value={c.currency} />
          <DetailField label="Credit Terms" value={c.creditTerms?.replace('_', ' ')} />
          <DetailField label="Default Payment Method" value={c.defaultPaymentMethod} />
        </DetailSection>

        <DetailSection title="Initial Administrator">
          <DetailField label="Name" value={row.userName} />
          <DetailField label="Email" value={row.userEmail} />
          <DetailField label="Phone" value={c.administratorPhone} />
          <DetailField label="Role" value={RoleLabels[row.role] ?? row.role} />
          <DetailField label="Membership Status" value={<StatusBadge domain="membership" status={row.status} />} />
        </DetailSection>

        {/* Deliberately no Banking section - bank fields are never fetched by the underlying
            query (listPlatformUsers), so there is nothing to show here even for an authorized
            reviewer. Reintroducing banking visibility, if ever genuinely needed, belongs in a
            separately-gated, deliberately restricted view - not this general approval drawer. */}
      </div>
    </Drawer>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-h3 mb-3">{title}</p>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</dl>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-metadata">{label}</dt>
      <dd className="text-sm font-medium">{value || <Badge tone="neutral">Not set</Badge>}</dd>
    </div>
  );
}
