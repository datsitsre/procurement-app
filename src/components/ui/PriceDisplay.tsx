import { cn } from '@/utils/cn';
import { formatMoney } from '@/utils/format';
import type { CurrencyCode } from '@/types/common';

export interface PriceDisplayProps {
  amount: number;
  currency?: CurrencyCode;
  size?: 'sm' | 'md' | 'lg';
  strikethrough?: boolean;
  className?: string;
}

const sizeClasses = { sm: 'text-sm', md: 'text-base font-semibold', lg: 'text-h2' };

/** The one place currency amounts are formatted for display - guarantees GH₵/₦/KSh etc. and
 *  thousands separators are consistent everywhere a price appears (cards, tables, invoices). */
export function PriceDisplay({ amount, currency = 'GHS', size = 'md', strikethrough, className }: PriceDisplayProps) {
  return (
    <span
      className={cn(
        sizeClasses[size],
        strikethrough && 'text-text-tertiary line-through font-normal',
        className,
      )}
    >
      {formatMoney(amount, currency)}
    </span>
  );
}
