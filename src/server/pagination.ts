import 'server-only';
import type { NextRequest } from 'next/server';
import type { Page } from '@/types/common';

/**
 * Shared pagination contract (section 14/15). The audit found zero list endpoints paginate -
 * every `findMany` across all 21 services returns the complete result set. Not urgent at current
 * seed-data scale, but the primary real scalability risk once a tenant has years of orders/
 * invoices/payments. Deliberately not applied to all 83 routes in one pass (section 14's own
 * explicit instruction) - this is the shared utility plus its first real application (the
 * platform-wide payments list, the single most unbounded-by-construction endpoint in the app:
 * every payment across every tenant, with no natural upper bound). Other list endpoints adopt
 * the same utility incrementally as they're touched.
 *
 * Uses the `Page<T>` envelope already declared in `types/common.ts` (present but unused until
 * now) rather than inventing a second, competing pagination shape.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface PaginationParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

/** Parses and validates `?page=&pageSize=` from the request's query string (section 15 - never
 *  let `?pageSize=1000000` cause an unbounded query). A missing, non-numeric, non-integer, or
 *  out-of-range value falls back to a safe default rather than erroring the request - a
 *  malformed pagination param isn't reason enough to fail an otherwise-valid list request. */
export function parsePagination(request: NextRequest, opts?: { defaultPageSize?: number; maxPageSize?: number }): PaginationParams {
  const defaultPageSize = opts?.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const maxPageSize = opts?.maxPageSize ?? MAX_PAGE_SIZE;

  const rawPage = Number(request.nextUrl.searchParams.get('page'));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawPageSize = Number(request.nextUrl.searchParams.get('pageSize'));
  const pageSize = Number.isInteger(rawPageSize) && rawPageSize > 0 ? Math.min(rawPageSize, maxPageSize) : defaultPageSize;

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function toPage<T>(items: T[], total: number, params: PaginationParams): Page<T> {
  return { items, total, page: params.page, pageSize: params.pageSize };
}
