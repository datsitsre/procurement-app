// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

/**
 * Phase 17, section 4 - regression suite for the CSP nonce plumbing added to the existing
 * request-id proxy. `CSP_ENFORCED` is read once at module load (a top-level const, matching how
 * every other env-driven constant in this app works - see src/server/env.ts), so these tests
 * exercise this process's actual default (enforced, unless `CSP_ENFORCED=false` is set in the
 * test environment) rather than toggling it per test.
 */

function pageRequest(path = '/dashboard') {
  return new NextRequest(`http://localhost${path}`);
}

function apiRequest(path = '/api/orders') {
  return new NextRequest(`http://localhost${path}`);
}

describe('proxy - CSP nonce (page requests)', () => {
  it('sets a CSP header whose script-src nonce matches the forwarded x-nonce request header', () => {
    const response = proxy(pageRequest());
    const cspHeader = response.headers.get('Content-Security-Policy') ?? response.headers.get('Content-Security-Policy-Report-Only');
    expect(cspHeader).not.toBeNull();
    const forwardedNonce = response.headers.get('x-middleware-request-x-nonce') ?? response.headers.get('x-nonce');
    // The nonce embedded in the CSP header's script-src must be the exact same value forwarded
    // to the route/render pipeline - otherwise Next couldn't attach a matching nonce to its own
    // framework scripts.
    const match = cspHeader?.match(/'nonce-([^']+)'/);
    expect(match).not.toBeNull();
    expect(forwardedNonce).toBeTruthy();
    if (match) expect(match[1]).toBe(forwardedNonce);
  });

  it('mints a fresh, different nonce on every call - never reused across requests', () => {
    const first = proxy(pageRequest()).headers.get('Content-Security-Policy')?.match(/'nonce-([^']+)'/)?.[1];
    const second = proxy(pageRequest()).headers.get('Content-Security-Policy')?.match(/'nonce-([^']+)'/)?.[1];
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it('never includes script-src \'unsafe-inline\' - an un-nonced inline script must not be silently allowed', () => {
    const response = proxy(pageRequest());
    const cspHeader = response.headers.get('Content-Security-Policy') ?? response.headers.get('Content-Security-Policy-Report-Only');
    const scriptSrc = cspHeader?.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptSrc).not.toContain('unsafe-inline');
  });

  it('style-src retains \'unsafe-inline\' - a nonce cannot cover inline style="" attributes, only <style>/<script> elements', () => {
    const response = proxy(pageRequest());
    const cspHeader = response.headers.get('Content-Security-Policy') ?? response.headers.get('Content-Security-Policy-Report-Only');
    const styleSrc = cspHeader?.split(';').find((d) => d.trim().startsWith('style-src'));
    expect(styleSrc).toContain("'unsafe-inline'");
  });

  it('sets exactly one of the two CSP header variants, never both', () => {
    const response = proxy(pageRequest());
    const hasEnforced = response.headers.has('Content-Security-Policy');
    const hasReportOnly = response.headers.has('Content-Security-Policy-Report-Only');
    expect(hasEnforced).not.toBe(hasReportOnly);
  });
});

describe('proxy - request id (API requests, unchanged from Phase 14)', () => {
  it('still tags an /api/* request with a request id, carrying no CSP header', () => {
    const response = proxy(apiRequest());
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    expect(response.headers.has('Content-Security-Policy')).toBe(false);
    expect(response.headers.has('Content-Security-Policy-Report-Only')).toBe(false);
  });

  it('trusts a safe, well-formed upstream x-request-id instead of generating a new one', () => {
    const request = new NextRequest('http://localhost/api/orders', { headers: { 'x-request-id': 'trace-abc-123' } });
    const response = proxy(request);
    expect(response.headers.get('X-Request-Id')).toBe('trace-abc-123');
  });

  it('rejects a malformed/oversized upstream x-request-id and generates a fresh one instead', () => {
    const request = new NextRequest('http://localhost/api/orders', { headers: { 'x-request-id': 'a'.repeat(500) } });
    const response = proxy(request);
    const id = response.headers.get('X-Request-Id');
    expect(id).toBeTruthy();
    expect(id).not.toBe('a'.repeat(500));
  });
});
