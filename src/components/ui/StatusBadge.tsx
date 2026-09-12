import { Badge } from './Badge';
import { getStatusLabel, getStatusTone, type StatusDomain } from '@/types/status';

export interface StatusBadgeProps {
  domain: StatusDomain;
  status: string;
  className?: string;
}

/** Renders any of the platform's centralized status enums (order/payment/rfq/approval/
 *  purchase-request/invoice/supplier-verification/dispute) with its correct semantic color and
 *  a human-readable label - the only place that mapping is decided (see types/status.ts). */
export function StatusBadge({ domain, status, className }: StatusBadgeProps) {
  return (
    <Badge tone={getStatusTone(domain, status)} className={className}>
      {getStatusLabel(status)}
    </Badge>
  );
}
