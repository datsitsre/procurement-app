'use client';

import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAuth } from '@/hooks/useAuth';
import { companiesOf } from '@/services/auth.service';

/** Lets a user who belongs to multiple companies (e.g. regional entities of one group) switch
 *  which one is "active" - every company-scoped view (orders, spend, suppliers, invoices)
 *  re-reads `session.activeCompanyId` after this, per section 10. */
export function CompanySwitcher() {
  const { session, switchCompany } = useAuth();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    // Phase 19 accessibility audit - a keyboard user who opened this dropdown had no way to
    // close it without a mouse click outside.
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, []);

  if (!session) return null;

  const myCompanies = companiesOf(session);
  const activeCompany = myCompanies.find((c) => c.id === session.activeCompanyId);
  // Real data (Phase 19) - `mirrorIntoRuntimeCache` (auth.service.ts) writes `parentGroupId`/
  // `parentGroupName` as a company-profile override for every company on every login/register/
  // switch-company response, seeded or not, specifically so this resolves here without a
  // static lookup or a second request.
  const groupName = activeCompany?.parentGroupName;

  if (myCompanies.length <= 1) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium">
        <Building2 className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
        {activeCompany?.name ?? 'No company'}
      </div>
    );
  }

  async function handleSelect(companyId: string) {
    setSwitching(true);
    await switchCompany(companyId);
    setSwitching(false);
    setOpen(false);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={switching}
        className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-hover disabled:opacity-60"
      >
        <Building2 className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
        <span className="max-w-45 truncate">{activeCompany?.name ?? 'Select company'}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-text-tertiary" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 z-40 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          {groupName && (
            <div className="border-b border-border px-3 py-2 text-metadata">{groupName}</div>
          )}
          <ul className="max-h-72 overflow-y-auto py-1">
            {myCompanies.map((company) => (
              <li key={company.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={company.id === session.activeCompanyId}
                  onClick={() => handleSelect(company.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-bg',
                    company.id === session.activeCompanyId && 'font-medium',
                  )}
                >
                  <span className="flex flex-col">
                    <span>{company.name}</span>
                    <span className="text-caption">{company.currency}</span>
                  </span>
                  {company.id === session.activeCompanyId && (
                    <Check className="h-4 w-4 text-accent" aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
