// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { decodeCursor, encodeCursor, parseCursorPagination, parsePagination, toCursorPage, toPage } from './pagination';

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/test${query}`);
}

describe('parsePagination', () => {
  it('defaults to page 1, pageSize 25 when no query params are given', () => {
    const params = parsePagination(request(''));
    expect(params).toEqual({ page: 1, pageSize: 25, skip: 0, take: 25 });
  });

  it('honors valid page/pageSize query params', () => {
    const params = parsePagination(request('?page=3&pageSize=10'));
    expect(params).toEqual({ page: 3, pageSize: 10, skip: 20, take: 10 });
  });

  it('never allows pageSize to exceed the configured maximum (section 15)', () => {
    const params = parsePagination(request('?pageSize=1000000'));
    expect(params.pageSize).toBe(100);
    expect(params.take).toBe(100);
  });

  it('respects a custom max/default when given', () => {
    const params = parsePagination(request('?pageSize=500'), { defaultPageSize: 10, maxPageSize: 50 });
    expect(params.pageSize).toBe(50);
  });

  it.each(['0', '-1', 'abc', '1.5', ''])('falls back to page 1 for an invalid page value (%s)', (value) => {
    const params = parsePagination(request(`?page=${value}`));
    expect(params.page).toBe(1);
  });

  it.each(['0', '-5', 'abc', '2.5'])('falls back to the default pageSize for an invalid pageSize value (%s)', (value) => {
    const params = parsePagination(request(`?pageSize=${value}`));
    expect(params.pageSize).toBe(25);
  });

  it('computes skip correctly across several pages', () => {
    expect(parsePagination(request('?page=1&pageSize=20')).skip).toBe(0);
    expect(parsePagination(request('?page=2&pageSize=20')).skip).toBe(20);
    expect(parsePagination(request('?page=5&pageSize=20')).skip).toBe(80);
  });
});

describe('toPage', () => {
  it('builds the Page<T> envelope from items/total/params', () => {
    const page = toPage(['a', 'b'], 42, { page: 2, pageSize: 2, skip: 2, take: 2 });
    expect(page).toEqual({ items: ['a', 'b'], total: 42, page: 2, pageSize: 2 });
  });
});

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a cursor exactly', () => {
    const cursor = { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 'abc123' };
    const decoded = decodeCursor(encodeCursor(cursor));
    expect(decoded).toEqual(cursor);
  });

  it('returns null for a malformed cursor rather than throwing', () => {
    expect(decodeCursor('not-valid-base64!!!')).toBeNull();
    expect(decodeCursor(Buffer.from('no-separator-here').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('not-a-date|abc').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('2026-01-01T00:00:00.000Z|').toString('base64url'))).toBeNull();
  });

  it('a tampered/attacker-crafted cursor decodes to a value, never throws - the query itself stays tenant-scoped regardless', () => {
    const forged = encodeCursor({ createdAt: new Date('2099-01-01'), id: 'not-a-real-id' });
    expect(decodeCursor(forged)).toEqual({ createdAt: new Date('2099-01-01'), id: 'not-a-real-id' });
  });
});

describe('parseCursorPagination', () => {
  it('defaults to a null cursor and the default page size', () => {
    const params = parseCursorPagination(request(''));
    expect(params).toEqual({ cursor: null, take: 25 });
  });

  it('decodes a valid cursor query param', () => {
    const cursor = { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 'xyz' };
    const params = parseCursorPagination(request(`?cursor=${encodeCursor(cursor)}`));
    expect(params.cursor).toEqual(cursor);
  });

  it('falls back to null for an invalid cursor rather than failing the request', () => {
    const params = parseCursorPagination(request('?cursor=garbage'));
    expect(params.cursor).toBeNull();
  });

  it('never allows pageSize to exceed the configured maximum', () => {
    expect(parseCursorPagination(request('?pageSize=99999')).take).toBe(100);
  });
});

describe('toCursorPage', () => {
  const row = (id: string, createdAt: string) => ({ id, createdAt: new Date(createdAt) });

  it('reports hasNext=false and no cursor when fewer rows than take+1 were fetched', () => {
    const rows = [row('a', '2026-01-03'), row('b', '2026-01-02')];
    const page = toCursorPage(rows, 5);
    expect(page.items).toHaveLength(2);
    expect(page.hasNext).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('slices off the extra row and derives nextCursor from the real last item, when there are more', () => {
    const rows = [row('a', '2026-01-03'), row('b', '2026-01-02'), row('c', '2026-01-01')];
    const page = toCursorPage(rows, 2);
    expect(page.items.map((r) => r.id)).toEqual(['a', 'b']);
    expect(page.hasNext).toBe(true);
    expect(decodeCursor(page.nextCursor!)).toEqual({ createdAt: new Date('2026-01-02'), id: 'b' });
  });

  it('handles an empty result set', () => {
    const page = toCursorPage([], 25);
    expect(page.items).toEqual([]);
    expect(page.hasNext).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});
