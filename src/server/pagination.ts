import 'server-only';
import type { NextRequest } from 'next/server';
import type { CursorPage, Page } from '@/types/common';

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

/**
 * Cursor pagination (Phase 16, section 6) - for append-only, continuously-growing feeds
 * (notifications today; audit logs/messages would use the same shape if/when they get a list
 * endpoint) where offset pagination degrades as the table grows and "page 40 of 900" isn't a
 * meaningful thing for a user to ask for anyway. The cursor encodes `(createdAt, id)`, not just a
 * timestamp - two rows can share a millisecond, and `id` (a cuid, monotonically ordered by
 * creation) breaks the tie deterministically so no row is ever skipped or repeated across pages.
 */

export interface Cursor {
  createdAt: Date;
  id: string;
}

export interface CursorPaginationParams {
  cursor: Cursor | null;
  take: number;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, 'utf8').toString('base64url');
}

/** Returns null for a missing, malformed, or tampered cursor - never throws. A bad cursor just
 *  means "start from the beginning" rather than failing the request; there's no security
 *  implication in accepting an attacker-crafted cursor value here, since the query it drives is
 *  still always scoped by the caller's own tenant/user id, never by anything the cursor itself
 *  asserts about who's asking. */
export function decodeCursor(raw: string): Cursor | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const separatorIndex = decoded.indexOf('|');
    if (separatorIndex < 0) return null;
    const iso = decoded.slice(0, separatorIndex);
    const id = decoded.slice(separatorIndex + 1);
    if (!id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export function parseCursorPagination(request: NextRequest, opts?: { defaultPageSize?: number; maxPageSize?: number }): CursorPaginationParams {
  const defaultPageSize = opts?.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const maxPageSize = opts?.maxPageSize ?? MAX_PAGE_SIZE;

  const rawPageSize = Number(request.nextUrl.searchParams.get('pageSize'));
  const take = Number.isInteger(rawPageSize) && rawPageSize > 0 ? Math.min(rawPageSize, maxPageSize) : defaultPageSize;

  const rawCursor = request.nextUrl.searchParams.get('cursor');
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;

  return { cursor, take };
}

/** `rows` must have been fetched with `take: params.take + 1` (one extra, to know whether
 *  there's a next page without a separate count query - section 17's "don't load everything just
 *  to compute pagination metadata"). Slices the extra row off and derives the next cursor from
 *  the real last item, never from client input. */
export function toCursorPage<T extends { createdAt: Date; id: string }>(rows: T[], take: number): CursorPage<T> {
  const hasNext = rows.length > take;
  const items = hasNext ? rows.slice(0, take) : rows;
  const last = items[items.length - 1];
  return { items, hasNext, nextCursor: hasNext && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null };
}
