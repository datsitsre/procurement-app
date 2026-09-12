'use client';

import { LayoutDashboard } from 'lucide-react';
import { useAuth, useActiveCompany, useActiveMembership } from '@/hooks/useAuth';
import { EmptyState } from '@/components/ui/EmptyState';
import { RoleLabels } from '@/config/rbac';

/**
 * Phase 1 placeholder. The brief's real buyer dashboard (spend, open orders, pending
 * approvals, outstanding invoices - section 9/63) ships in Phase 2 once the orders/RFQ/invoice
 * mock services exist to back it with real (if fictional) data. Showing fabricated numbers
 * here now would violate "no fake functionality that appears operational but does nothing."
 */
export default function DashboardPage() {
  const { session } = useAuth();
  const company = useActiveCompany();
  const membership = useActiveMembership();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Good day, {session?.user.name.split(' ')[0]}</h1>
        <p className="text-body text-text-secondary">
          {company?.name} · {membership ? RoleLabels[membership.role] : ''}
        </p>
      </div>

      <EmptyState
        icon={LayoutDashboard}
        title="Your dashboard is next"
        description="Spend summaries, open orders, pending approvals, and outstanding invoices will appear here once the procurement modules are built (Phase 2)."
      />
    </div>
  );
}
