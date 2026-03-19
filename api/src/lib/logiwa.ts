import { Env } from '../index';

/**
 * Logiwa IO API client.
 * Initialized per-request with tenant-specific credentials from D1.
 *
 * TODO: Phase 3 — implement when Logiwa API spec is available.
 */

export interface LogiwaCredentials {
  apiUrl: string;
  username: string;
  password: string;
  // Add token fields as needed for Logiwa auth flow
}

export async function getLogiwaCredentials(
  env: Env,
  tenantId: string
): Promise<LogiwaCredentials | null> {
  const result = await env.DB.prepare(
    'SELECT logiwa_api_url, logiwa_credentials FROM tenants WHERE id = ? AND active = 1'
  )
    .bind(tenantId)
    .first();

  if (!result) return null;

  // TODO: decrypt credentials
  const creds = JSON.parse(result.logiwa_credentials as string);
  return {
    apiUrl: result.logiwa_api_url as string,
    ...creds,
  };
}

// TODO: Phase 3 — add methods:
// - authenticate(creds) — get/refresh Logiwa auth token
// - createOrder(creds, orderData)
// - getOrder(creds, orderId)
// - getTracking(creds, orderId)
// - queryInventory(creds, skus)
