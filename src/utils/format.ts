import type { CurrencyCode } from '@/types/common';

const CURRENCY_LOCALE: Record<CurrencyCode, string> = {
  GHS: 'en-GH',
  NGN: 'en-NG',
  KES: 'en-KE',
  ZAR: 'en-ZA',
  XOF: 'fr-CI',
  USD: 'en-US',
};

/** Formats a raw number as currency using the right locale/symbol for that currency - never
 *  hard-codes "GH₵" as a prefix, since the platform must scale to other African markets
 *  (section 55) without touching this formatter. */
export function formatMoney(amount: number, currency: CurrencyCode = 'GHS'): string {
  return new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...opts,
  }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return formatDate(iso, { hour: 'numeric', minute: '2-digit' });
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
