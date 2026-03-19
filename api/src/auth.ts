import { Env } from './index';

export interface TenantContext {
  tenantId: string;
  tenantName: string;
  rateLimit: number;
  active: boolean;
}

/**
 * Validate the API key from the request header and return tenant context.
 * Keys are stored as SHA-256 hashes in KV for fast lookup.
 */
export async function authenticateRequest(
  request: Request,
  env: Env
): Promise<TenantContext | null> {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey) return null;

  const keyHash = await hashApiKey(apiKey);
  const tenantData = await env.KV.get(`apikey:${keyHash}`, 'json');

  if (!tenantData) return null;

  const tenant = tenantData as TenantContext;
  if (!tenant.active) return null;

  return tenant;
}

export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
