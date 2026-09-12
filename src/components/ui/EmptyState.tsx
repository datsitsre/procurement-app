import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Honest "there's nothing here yet" state (section 52) - used for empty order lists, RFQ
 *  lists, etc. Never render fabricated placeholder rows to make a screen look populated. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center',
        className,
      )}
    >
      {Icon && (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-bg text-text-tertiary">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-h3">{title}</p>
        {description && <p className="text-body max-w-sm text-text-secondary">{description}</p>}
      </div>
      {action}
    </div>
  );
}
