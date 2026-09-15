// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { parsePagination, toPage } from './pagination';

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
