import type { LucideIcon } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Card } from './Card';

export interface StatCardProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  trend?: { value: string; direction: 'up' | 'down' };
  tone?: 'neutral' | 'accent' | 'warning' | 'danger';
  className?: string;
}

const toneClasses: Record<NonNullable<StatCardProps['tone']>, string> = {
  neutral: 'bg-neutral-bg text-text-secondary',
  accent: 'bg-info-bg text-accent',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
};

/** The compact metric tile used across every dashboard (buyer, supplier, admin) - "Total
 *  spend", "Pending approvals", "Open orders", etc. Deliberately plain: one number, one label,
 *  an optional trend - see section 63's "don't overwhelm users with information". */
export function StatCard({ label, value, icon: Icon, trend, tone = 'neutral', className }: StatCardProps) {
  return (
    <Card className={cn('flex items-start justify-between p-5', className)}>
      <div className="flex flex-col gap-1">
        <span className="text-metadata">{label}</span>
        <span className="text-h1">{value}</span>
        {trend && (
          <span
            className={cn(
              'text-caption font-medium',
              trend.direction === 'up' ? 'text-success' : 'text-danger',
            )}
          >
            {trend.direction === 'up' ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>
      {Icon && (
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-md', toneClasses[tone])}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
    </Card>
  );
}
