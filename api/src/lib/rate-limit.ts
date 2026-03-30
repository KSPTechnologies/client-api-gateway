/**
 * Simple sliding-window rate limiter using KV.
 * Each tenant gets a counter key that expires after the window.
 */

import { Env } from '../index';

const WINDOW_SECONDS = 60;

export async function checkRateLimit(
  env: Env,
  tenantId: string,
  limit: number
): Promise<{ allowed: boolean; remaining: number; resetSeconds: number }> {
  const key = `ratelimit:${tenantId}`;
  const current = await env.KV.get(key, 'text');
  const count = current ? parseInt(current, 10) : 0;

  if (count >= limit) {
    return { allowed: false, remaining: 0, resetSeconds: WINDOW_SECONDS };
  }

  // Increment counter — always set TTL so the key expires
  const newCount = count + 1;
  await env.KV.put(key, newCount.toString(), {
    expirationTtl: WINDOW_SECONDS,
  });

  return { allowed: true, remaining: limit - newCount, resetSeconds: WINDOW_SECONDS };
}
