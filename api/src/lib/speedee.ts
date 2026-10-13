import { Env } from '../index';
import { SpeedeeConfig, mergeConfig } from './speedee-map';

/**
 * SpeeDee ShipIt API client. HTTP Basic auth on every call; separate
 * credentials per environment in KV:
 *   speedee:env:test       {"baseUrl": "...", "username": "...", "password": "..."}
 *   speedee:env:production {"baseUrl": "...", "username": "...", "password": "..."}
 * Config overrides (incl. UNCONFIRMED endpoint paths) in KV speedee:config.
 * Credentials never pass through Logiwa and are never logged.
 */

export type SpeedeeEnv = 'test' | 'production';

export interface SpeedeeCreds {
  baseUrl: string;
  username: string;
  password: string;
}

export class SpeedeeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getSpeedeeConfig(env: Env): Promise<SpeedeeConfig> {
  try {
    const stored = (await env.KV.get('speedee:config', 'json')) as Partial<SpeedeeConfig> | null;
    return mergeConfig(stored);
  } catch {
    return mergeConfig(null);
  }
}

export async function getSpeedeeCreds(env: Env, environment: SpeedeeEnv): Promise<SpeedeeCreds | null> {
  try {
    const creds = (await env.KV.get(`speedee:env:${environment}`, 'json')) as SpeedeeCreds | null;
    if (!creds || !creds.baseUrl || !creds.username) return null;
    return creds;
  } catch {
    return null;
  }
}

const OUTBOUND_TIMEOUT_MS = 8_000; // below Logiwa's ~15s budget

async function speedeeFetch(
  creds: SpeedeeCreds,
  method: string,
  path: string,
  body?: unknown
): Promise<any> {
  const url = `${creds.baseUrl.replace(/\/+$/, '')}${path}`;
  const auth = btoa(`${creds.username}:${creds.password}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OUTBOUND_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error && err.name === 'AbortError'
      ? `SpeeDee request timed out (${OUTBOUND_TIMEOUT_MS}ms): ${method} ${path}`
      : `SpeeDee request failed: ${err instanceof Error ? err.message : String(err)}`;
    throw new SpeedeeError(0, msg);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }

  if (!res.ok) {
    const detail = json?.message || json?.error || text.slice(0, 300) || res.statusText;
    throw new SpeedeeError(res.status, `SpeeDee ${res.status}: ${detail}`);
  }
  return json;
}

function sub(path: string, orderId: string): string {
  return path.replace('{orderId}', encodeURIComponent(orderId));
}

// ── Operations (paths come from config so unconfirmed ones are fixable live) ──

export const speedee = {
  quote: (c: SpeedeeCreds, cfg: SpeedeeConfig, body: unknown) =>
    speedeeFetch(c, 'POST', cfg.paths.quote, body),

  createOrder: (c: SpeedeeCreds, cfg: SpeedeeConfig, body: unknown) =>
    speedeeFetch(c, 'POST', cfg.paths.createOrder, body),

  createReturn: (c: SpeedeeCreds, cfg: SpeedeeConfig, sourceOrderId: string, body: unknown) =>
    speedeeFetch(c, 'POST', `${cfg.paths.returnOrder}?sourceOrderId=${encodeURIComponent(sourceOrderId)}`, body),

  getOrder: (c: SpeedeeCreds, cfg: SpeedeeConfig, orderId: string) =>
    speedeeFetch(c, 'GET', sub(cfg.paths.getOrder, orderId)),

  getItems: (c: SpeedeeCreds, cfg: SpeedeeConfig, orderId: string) =>
    speedeeFetch(c, 'GET', sub(cfg.paths.getItems, orderId)),

  labelsJson: (c: SpeedeeCreds, cfg: SpeedeeConfig, orderId: string) =>
    speedeeFetch(c, 'GET', sub(cfg.paths.labelsJson, orderId)),

  // Confirmed: cancel is DELETE on the order resource.
  cancelOrder: (c: SpeedeeCreds, cfg: SpeedeeConfig, orderId: string) =>
    speedeeFetch(c, 'DELETE', sub(cfg.paths.cancelOrder, orderId)),

  // Confirmed: DELETE .../items with a bare JSON array of itemIds.
  deleteItems: (c: SpeedeeCreds, cfg: SpeedeeConfig, orderId: string, itemIds: unknown[]) =>
    speedeeFetch(c, 'DELETE', sub(cfg.paths.deleteItems, orderId), itemIds),

  search: (c: SpeedeeCreds, cfg: SpeedeeConfig, body: unknown) =>
    speedeeFetch(c, 'POST', cfg.paths.search, body),
};
