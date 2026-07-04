/**
 * @jest-environment node
 */
/* global beforeEach, describe, expect, it */

const {
  checkLoginRateLimit,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginRateLimitForTests,
} = require('../src/lib/login-rate-limit');

function requestFromIp(ip) {
  return { headers: new Headers({ 'x-forwarded-for': ip }) };
}

const WINDOW_MS = 15 * 60 * 1000;

describe('login rate limiting', () => {
  beforeEach(() => {
    resetLoginRateLimitForTests();
  });

  it('limits an IP+account pair after 5 failures within the window', () => {
    const request = requestFromIp('203.0.113.9');
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      expect(checkLoginRateLimit(request, 'admin', now).limited).toBe(false);
      recordLoginFailure(request, 'admin', now);
    }

    const result = checkLoginRateLimit(request, 'admin', now);
    expect(result.limited).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);

    // Other accounts from the same IP are unaffected.
    expect(checkLoginRateLimit(request, 'other', now).limited).toBe(false);
  });

  it('limits an account across rotating spoofed IPs after 20 failures', () => {
    const now = Date.now();

    for (let i = 0; i < 20; i++) {
      recordLoginFailure(requestFromIp(`198.51.100.${i}`), 'admin', now);
    }

    expect(
      checkLoginRateLimit(requestFromIp('198.51.100.250'), 'admin', now)
        .limited,
    ).toBe(true);
  });

  it('clears counters after a successful login', () => {
    const request = requestFromIp('203.0.113.9');
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      recordLoginFailure(request, 'admin', now);
    }
    expect(checkLoginRateLimit(request, 'admin', now).limited).toBe(true);

    recordLoginSuccess(request, 'admin');
    expect(checkLoginRateLimit(request, 'admin', now).limited).toBe(false);
  });

  it('forgets failures once the window has passed', () => {
    const request = requestFromIp('203.0.113.9');
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      recordLoginFailure(request, 'admin', now);
    }
    expect(checkLoginRateLimit(request, 'admin', now).limited).toBe(true);
    expect(
      checkLoginRateLimit(request, 'admin', now + WINDOW_MS + 1000).limited,
    ).toBe(false);
  });

  it('treats account names case-insensitively', () => {
    const request = requestFromIp('203.0.113.9');
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      recordLoginFailure(request, 'Admin', now);
    }

    expect(checkLoginRateLimit(request, 'admin', now).limited).toBe(true);
  });
});
