/*
 * In-memory login rate limiter (per instance).
 *
 * Failed attempts are tracked per IP+account pair and per account, so a
 * brute-force against one account is throttled even when the attacker
 * rotates spoofed X-Forwarded-For values. State lives in module memory:
 * multi-instance deployments bound attempts per instance rather than
 * globally, which still caps the practical guess rate; put a shared
 * limiter (WAF, reverse proxy) in front for stronger guarantees.
 */
import type { NextRequest } from 'next/server';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IP_ACCOUNT = 5;
const MAX_FAILURES_PER_ACCOUNT = 20;
// Bound memory when attackers spray random usernames or spoofed IPs.
const MAX_TRACKED_KEYS = 10_000;

const failures = new Map<string, number[]>();

export function getClientIp(request: Pick<NextRequest, 'headers'>): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0].trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') || 'unknown';
}

function normalizeAccount(username: string): string {
  return username.trim().toLowerCase();
}

function keysFor(request: Pick<NextRequest, 'headers'>, username: string) {
  const account = normalizeAccount(username);
  return [
    {
      key: `combo:${getClientIp(request)}:${account}`,
      max: MAX_FAILURES_PER_IP_ACCOUNT,
    },
    { key: `acct:${account}`, max: MAX_FAILURES_PER_ACCOUNT },
  ];
}

function recentFailures(key: string, now: number): number[] {
  const timestamps = (failures.get(key) || []).filter(
    (at) => at > now - WINDOW_MS,
  );
  if (timestamps.length === 0) {
    failures.delete(key);
  } else {
    failures.set(key, timestamps);
  }
  return timestamps;
}

export function checkLoginRateLimit(
  request: Pick<NextRequest, 'headers'>,
  username: string,
  now = Date.now(),
): { limited: boolean; retryAfterSeconds: number } {
  let retryAfterMs = 0;

  for (const { key, max } of keysFor(request, username)) {
    const timestamps = recentFailures(key, now);
    if (timestamps.length >= max) {
      const oldestCounted = timestamps[timestamps.length - max];
      retryAfterMs = Math.max(retryAfterMs, oldestCounted + WINDOW_MS - now);
    }
  }

  return {
    limited: retryAfterMs > 0,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}

export function recordLoginFailure(
  request: Pick<NextRequest, 'headers'>,
  username: string,
  now = Date.now(),
): void {
  if (failures.size >= MAX_TRACKED_KEYS) {
    const oldestKey = failures.keys().next().value;
    if (oldestKey !== undefined) failures.delete(oldestKey);
  }

  for (const { key } of keysFor(request, username)) {
    failures.set(key, [...recentFailures(key, now), now]);
  }
}

export function recordLoginSuccess(
  request: Pick<NextRequest, 'headers'>,
  username: string,
): void {
  for (const { key } of keysFor(request, username)) {
    failures.delete(key);
  }
}

export function resetLoginRateLimitForTests(): void {
  failures.clear();
}
