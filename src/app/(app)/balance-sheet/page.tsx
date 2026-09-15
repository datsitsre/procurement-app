'use client';

import { useMemo } from 'react';
import { Info } from 'lucide-react';
import { useActiveCompany, useTenantContext, useWorkspace } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { invoicesService } from '@/services/invoices.service';
import { catalogService } from '@/services/catalog.service';
import { StatCard } from '@/components/ui/StatCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatMoney } from '@/utils/format';
import type { Invoice } from '@/types/orders';
import type { Product } from '@/types/catalog';
import type { CurrencyCode } from '@/types/common';

/**
 * Not a formal GAAP balance sheet - this platform has no chart of accounts, cash ledger, or
 * equity/capital tracking, so there is no honest way to compute Assets = Liabilities + Equity.
 * What it shows instead is real: outstanding invoice exposure (aged by due date) and, for a
 * supplier, inventory value at listed price - the two balance-sheet-shaped numbers this app's
 * own data actually supports. Every figure here is derived from real Invoice/Product rows, never
 * invented to make a total balance.
 */
export default function BalanceSheetPage() {
  const workspace = useWorkspace();
  const company = useActiveCompany();
  const tenant = useTenantContext();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Balance sheet</h1>
        <p className="text-body text-text-secondary">{company?.name}&rsquo;s financial position, as far as this platform&rsquo;s own data goes.</p>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-border bg-neutral-bg p-3 text-sm text-text-secondary">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          This reflects accounts {workspace === 'supplier' ? 'receivable and inventory value' : 'payable and credit utilization'} from real
          invoice{workspace === 'supplier' ? ' and product' : ''} data. Cash, owner&rsquo;s equity, and anything else outside this platform aren&rsquo;t
          tracked here, so this intentionally doesn&rsquo;t balance to a formal Assets = Liabilities + Equity total.
        </p>
      </div>

      {workspace === 'supplier' ? (
        <SupplierBalanceSheet supplierId={tenant.supplierId} currency={company?.currency ?? 'GHS'} />
      ) : (
        <BuyerBalanceSheet companyId={company?.id} currency={company?.currency ?? 'GHS'} creditLimit={company?.creditLimit} creditAvailable={company?.creditAvailable} />
      )}
    </div>
  );
}

interface AgingBuckets {
  current: number;
  overdue1to30: number;
  overdue31to60: number;
  overdue61to90: number;
  overdue90plus: number;
  total: number;
}

/** Ages the still-owed portion of every non-paid, non-void invoice by days past `dueDate` - the
 *  same bucketing any AR/AP aging report uses. */
function ageInvoices(invoices: Invoice[]): AgingBuckets {
  const now = Date.now();
  const buckets: AgingBuckets = { current: 0, overdue1to30: 0, overdue31to60: 0, overdue61to90: 0, overdue90plus: 0, total: 0 };

  for (const invoice of invoices) {
    if (invoice.status === 'PAID' || invoice.status === 'VOID' || invoice.status === 'DRAFT') continue;
    const owed = invoice.total - invoice.amountPaid;
    if (owed <= 0) continue;

    const daysOverdue = Math.floor((now - new Date(invoice.dueDate).getTime()) / (24 * 60 * 60 * 1000));
    if (daysOverdue <= 0) buckets.current += owed;
    else if (daysOverdue <= 30) buckets.overdue1to30 += owed;
    else if (daysOverdue <= 60) buckets.overdue31to60 += owed;
    else if (daysOverdue <= 90) buckets.overdue61to90 += owed;
    else buckets.overdue90plus += owed;
    buckets.total += owed;
  }
  return buckets;
}

function AgingTable({ buckets, currency }: { buckets: AgingBuckets; currency: CurrencyCode }) {
  const rows: { label: string; amount: number; tone?: 'danger' }[] = [
    { label: 'Current (not yet due)', amount: buckets.current },
    { label: '1-30 days overdue', amount: buckets.overdue1to30 },
    { label: '31-60 days overdue', amount: buckets.overdue31to60, tone: buckets.overdue31to60 > 0 ? 'danger' : undefined },
    { label: '61-90 days overdue', amount: buckets.overdue61to90, tone: buckets.overdue61to90 > 0 ? 'danger' : undefined },
    { label: '90+ days overdue', amount: buckets.overdue90plus, tone: buckets.overdue90plus > 0 ? 'danger' : undefined },
  ];

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-h3">Aging</h2>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between px-5 py-3 text-sm">
            <span className="text-text-secondary">{r.label}</span>
            <span className={r.tone === 'danger' && r.amount > 0 ? 'font-medium text-danger' : 'font-medium'}>
              {formatMoney(r.amount, currency)}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between px-5 py-3 text-sm font-semibold">
          <span>Total</span>
          <span>{formatMoney(buckets.total, currency)}</span>
        </li>
      </ul>
    </div>
  );
}

function BuyerBalanceSheet({
  companyId,
  currency,
  creditLimit,
  creditAvailable,
}: {
  companyId?: string;
  currency: CurrencyCode;
  creditLimit?: number;
  creditAvailable?: number;
}) {
  const { data: invoices } = useAsyncData<Invoice[]>(companyId ?? null, () => invoicesService.listInvoices(companyId!));
  const payable = useMemo(() => (invoices ? ageInvoices(invoices) : null), [invoices]);
  const creditUsed = creditLimit !== undefined ? creditLimit - (creditAvailable ?? creditLimit) : null;

  if (!payable) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Accounts payable" value={formatMoney(payable.total, currency)} tone={payable.total > 0 ? 'warning' : 'neutral'} />
        {creditUsed !== null && (
          <StatCard label="Credit utilized" value={`${formatMoney(creditUsed, currency)} of ${formatMoney(creditLimit ?? 0, currency)}`} tone="accent" />
        )}
      </div>
      <AgingTable buckets={payable} currency={currency} />
    </div>
  );
}

function SupplierBalanceSheet({ supplierId, currency }: { supplierId?: string; currency: CurrencyCode }) {
  const { data: invoices } = useAsyncData<Invoice[]>(supplierId ?? null, () => invoicesService.listInvoicesForSupplier(supplierId!));
  const { data: products } = useAsyncData<Product[]>(supplierId ?? null, () => catalogService.listProductsForSupplier(supplierId!));

  const receivable = useMemo(() => (invoices ? ageInvoices(invoices) : null), [invoices]);
  const inventoryValue = useMemo(
    () => products?.reduce((sum, p) => sum + p.inventory.reduce((s, i) => s + i.stock, 0) * p.basePrice, 0) ?? null,
    [products],
  );

  if (!receivable || inventoryValue === null) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Accounts receivable" value={formatMoney(receivable.total, currency)} tone={receivable.total > 0 ? 'accent' : 'neutral'} />
        <StatCard label="Inventory value (at listed price)" value={formatMoney(inventoryValue, currency)} />
      </div>
      <AgingTable buckets={receivable} currency={currency} />
    </div>
  );
}
