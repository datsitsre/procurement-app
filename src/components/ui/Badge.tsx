import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/utils/cn';
import type { StatusTone } from '@/types/status';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium border',
  {
    variants: {
      tone: {
        neutral: 'bg-neutral-bg text-neutral-text border-neutral-border',
        info: 'bg-info-bg text-info border-info-border',
        success: 'bg-success-bg text-success border-success-border',
        warning: 'bg-warning-bg text-warning border-warning-border',
        danger: 'bg-danger-bg text-danger border-danger-border',
      } satisfies Record<StatusTone, string>,
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/** A plain labeled pill - use StatusBadge instead when the label is one of the platform's
 *  centralized order/payment/RFQ/approval statuses, so the color mapping stays consistent. */
export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
