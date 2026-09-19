'use client';

import { useId, useState } from 'react';
import { cn } from '@/utils/cn';

export interface TabItem {
  value: string;
  label: string;
  /** Optional count badge, e.g. "Quotes (3)" without hardcoding the parenthetical everywhere. */
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  children: (activeValue: string) => React.ReactNode;
}

/** Simple, accessible tabs (role="tablist"/"tab"/"tabpanel", arrow-key navigation) - the one
 *  tabs implementation for the whole app. Works controlled (pass `value`+`onChange`, e.g. to
 *  keep the active tab in a URL query param) or uncontrolled (`defaultValue` only). */
export function Tabs({ items, value, defaultValue, onChange, children }: TabsProps) {
  const id = useId();
  const [internalValue, setInternalValue] = useState(defaultValue ?? items[0]?.value);
  const activeValue = value ?? internalValue;

  function select(next: string) {
    if (value === undefined) setInternalValue(next);
    onChange?.(next);
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const next = items[(index + delta + items.length) % items.length];
    select(next.value);
    document.getElementById(`${id}-tab-${next.value}`)?.focus();
  }

  return (
    <div>
      <div role="tablist" className="flex items-center gap-1 border-b border-border">
        {items.map((item, index) => {
          const active = item.value === activeValue;
          return (
            <button
              key={item.value}
              id={`${id}-tab-${item.value}`}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls={`${id}-panel-${item.value}`}
              tabIndex={active ? 0 : -1}
              onClick={() => select(item.value)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                active
                  ? 'border-accent text-text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary',
              )}
            >
              {item.label}
              {item.count !== undefined && (
                <span className={cn('rounded-full px-1.5 py-0.5 text-xs', active ? 'bg-accent/10 text-accent' : 'bg-neutral-bg text-text-tertiary')}>
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div id={`${id}-panel-${activeValue}`} role="tabpanel" aria-labelledby={`${id}-tab-${activeValue}`} className="pt-4">
        {children(activeValue)}
      </div>
    </div>
  );
}
