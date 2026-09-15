// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { isSameOrigin } from './csrf';

function request(url: string, headers: Record<string, string>): NextRequest {
  return new NextRequest(url, { method: 'POST', headers });
}

describe('isSameOrigin', () => {
  it('allows a request whose Origin host matches the actual Host header it arrived on', () => {
    const req = request('http://127.0.0.1:3000/api/auth/login', {
      origin: 'http://127.0.0.1:3000',
      host: '127.0.0.1:3000',
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it('rejects a cross-origin Origin header even if the request URL matches the server', () => {
    const req = request('http://127.0.0.1:3000/api/auth/login', {
      origin: 'https://evil.example',
      host: '127.0.0.1:3000',
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it('rejects a request with no Origin or Referer at all', () => {
    const req = request('http://127.0.0.1:3000/api/auth/login', { host: '127.0.0.1:3000' });
    expect(isSameOrigin(req)).toBe(false);
  });

  it('falls back to Referer when Origin is absent', () => {
    const req = request('http://127.0.0.1:3000/api/auth/login', {
      referer: 'http://127.0.0.1:3000/login',
      host: '127.0.0.1:3000',
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it('does not trust the server-bound URL (Next.js internal hostname/port) instead of the real Host header', () => {
    // Regression test: nextUrl.origin reflects Next.js's own bound hostname (e.g. "0.0.0.0"
    // under the standalone server, or a hardcoded "localhost" under `next start`), never the
    // domain a real client actually connected to - comparing against it instead of the request's
    // own Host header would reject every legitimate same-origin request in a real deployment.
    // This constructs the request against one URL (standing in for Next's internal bound
    // address) while the client's actual Host header names a different, real domain, and expects
    // a same-origin request to that real domain to still be accepted.
    const req = request('http://0.0.0.0:3000/api/auth/login', {
      origin: 'https://app.example.com',
      host: 'app.example.com',
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it('prefers the real Host header over nextUrl.host when they disagree', () => {
    // The request was constructed against one URL (standing in for Next's own internally bound
    // address, e.g. "0.0.0.0" under the standalone server) but arrived with a Host header naming
    // the real domain - the Host header must win, since that's what actually matters for CSRF.
    const req = request('http://0.0.0.0:3000/api/auth/login', {
      origin: 'http://0.0.0.0:3000',
      host: 'app.example.com',
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it('rejects a mismatched port, not just a mismatched hostname', () => {
    const req = request('http://127.0.0.1:3000/api/auth/login', {
      origin: 'http://127.0.0.1:4000',
      host: '127.0.0.1:3000',
    });
    expect(isSameOrigin(req)).toBe(false);
  });
});
