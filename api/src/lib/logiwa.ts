import { Env } from '../index';
import { ApiError } from './errors';

/**
 * Logiwa IO API client.
 * Credentials are set once as Worker environment variables — not per-tenant.
 * All tenants share the same Logiwa account (we are the 3PL).
 */

export interface LogiwaCredentials {
  apiUrl: string;
  username: string;
  password: string;
  clientIdentifier?: string;
  warehouseIdentifier?: string;
}

export interface LogiwaToken {
  token: string;
  expiresAt: number;
}

// ── Environment ──────────────────────────────────────

export type LogiwaEnvironment = 'sandbox' | 'production';

// ── Credential Fetching ──────────────────────────────

export function getLogiwaCredentials(env: Env, environment: LogiwaEnvironment, clientIdentifier?: string): LogiwaCredentials | null {
  if (environment === 'production') {
    if (!env.LOGIWA_PROD_API_URL || !env.LOGIWA_PROD_USERNAME || !env.LOGIWA_PROD_PASSWORD) {
      return null;
    }
    return {
      apiUrl: env.LOGIWA_PROD_API_URL,
      username: env.LOGIWA_PROD_USERNAME,
      password: env.LOGIWA_PROD_PASSWORD,
      clientIdentifier,
      warehouseIdentifier: env.LOGIWA_PROD_WAREHOUSE_IDENTIFIER,
    };
  }

  if (!env.LOGIWA_SANDBOX_API_URL || !env.LOGIWA_SANDBOX_USERNAME || !env.LOGIWA_SANDBOX_PASSWORD) {
    return null;
  }
  return {
    apiUrl: env.LOGIWA_SANDBOX_API_URL,
    username: env.LOGIWA_SANDBOX_USERNAME,
    password: env.LOGIWA_SANDBOX_PASSWORD,
    clientIdentifier,
    warehouseIdentifier: env.LOGIWA_SANDBOX_WAREHOUSE_IDENTIFIER,
  };
}

interface TenantLogiwaConfig {
  environment: LogiwaEnvironment;
  clientIdentifier?: string;
}

/**
 * Look up a tenant's Logiwa environment and client identifier from D1.
 */
export async function getTenantLogiwaConfig(env: Env, tenantId: string): Promise<TenantLogiwaConfig> {
  const row = await env.DB.prepare(
    'SELECT logiwa_environment, logiwa_sandbox_client_id, logiwa_prod_client_id FROM tenants WHERE id = ?'
  ).bind(tenantId).first();

  const environment: LogiwaEnvironment = (row?.logiwa_environment === 'production') ? 'production' : 'sandbox';
  const clientIdentifier = environment === 'production'
    ? (row?.logiwa_prod_client_id as string | undefined)
    : (row?.logiwa_sandbox_client_id as string | undefined);

  return { environment, clientIdentifier };
}

// ── Token Management ─────────────────────────────────

const tokenCache = new Map<string, LogiwaToken>();

async function getToken(creds: LogiwaCredentials): Promise<string> {
  const cacheKey = `${creds.apiUrl}:${creds.username}`;
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const res = await fetch(`${creds.apiUrl}/v3.1/Authorize/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: creds.username,
      password: creds.password,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(502, `Logiwa auth failed (${res.status}): ${body}`, 'LOGIWA_AUTH_FAILED');
  }

  const data = (await res.json()) as { token: string };
  const token: LogiwaToken = {
    token: data.token,
    expiresAt: Date.now() + 55 * 60_000,
  };
  tokenCache.set(cacheKey, token);
  return token.token;
}

// ── HTTP Helper ──────────────────────────────────────

async function logiwaFetch(
  creds: LogiwaCredentials,
  method: string,
  path: string,
  body?: unknown
): Promise<any> {
  const token = await getToken(creds);
  const url = `${creds.apiUrl}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    tokenCache.delete(`${creds.apiUrl}:${creds.username}`);
    const freshToken = await getToken(creds);
    const retry = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${freshToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!retry.ok) {
      const errBody = await retry.text();
      throw new ApiError(502, `Logiwa API error (${retry.status}): ${errBody}`, 'LOGIWA_API_ERROR');
    }
    if (retry.status === 204) return null;
    return retry.json();
  }

  if (!res.ok) {
    const errBody = await res.text();
    throw new ApiError(502, `Logiwa API error (${res.status}): ${errBody}`, 'LOGIWA_API_ERROR');
  }

  if (res.status === 204) return null;
  return res.json();
}

// ── Shipment Order Operations ────────────────────────

export interface CreateShipmentOrderInput {
  code: string;
  customer: { firstName: string; lastName: string; email?: string };
  shipmentAddress: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    phoneNumber?: string;
  };
  shipmentOrderLineList: Array<{
    sku: string;
    packQuantity: number;
    unitPrice?: number;
  }>;
  note?: string;
  clientReferenceCode?: string;
  shipmentOrderType?: string;
  shipmentOrderDate?: string;
  expectedShipmentDate?: string;
}

export async function createShipmentOrder(
  creds: LogiwaCredentials,
  order: CreateShipmentOrderInput
): Promise<{ identifier: string; status: number; message: string }> {
  const payload = {
    ...order,
    shipmentOrderType: order.shipmentOrderType || 'Sales Order',
    shipmentOrderDate: order.shipmentOrderDate || new Date().toISOString().split('T')[0],
    clientIdentifier: creds.clientIdentifier,
    warehouseIdentifier: creds.warehouseIdentifier,
    useSameAddress: true,
  };

  const result = await logiwaFetch(creds, 'POST', '/v3.1/ShipmentOrder/create', payload);
  return {
    identifier: result.value || result.data,
    status: result.status || 0,
    message: result.message || 'Created',
  };
}

export async function getShipmentOrder(
  creds: LogiwaCredentials,
  identifier: string
): Promise<any> {
  return logiwaFetch(creds, 'GET', `/v3.1/ShipmentOrder/${identifier}`);
}

export async function listShipmentOrders(
  creds: LogiwaCredentials,
  index: number,
  size: number,
  filters?: Record<string, string>
): Promise<{ data: any[]; totalCount: number }> {
  let path = `/v3.1/ShipmentOrder/list/i/${index}/s/${size}`;
  if (filters) {
    const params = new URLSearchParams(filters);
    path += `?${params.toString()}`;
  }
  return logiwaFetch(creds, 'GET', path);
}

export async function cancelShipmentOrder(
  creds: LogiwaCredentials,
  identifier: string,
  reason?: string
): Promise<boolean> {
  const payload = {
    clientIdentifier: creds.clientIdentifier,
    cancelReasonName: reason || 'Cancelled via API gateway',
  };
  const result = await logiwaFetch(creds, 'POST', `/v3.1/ShipmentOrder/cancel/${identifier}`, payload);
  return result?.value === true;
}

// ── Inventory Operations ─────────────────────────────

export interface InventoryItem {
  identifier: string;
  productSku: string;
  productName: string;
  totalQuantity: number;
  availableQuantity: number;
  allocatedQuantity: number;
  warehouseCode: string;
  warehouseLocationCode: string;
  inventoryStatusName: string;
  lotBatchNumber?: string;
  expiryDate?: string;
}

export async function queryInventory(
  creds: LogiwaCredentials,
  skus: string[],
  pageSize = 200
): Promise<InventoryItem[]> {
  const allItems: InventoryItem[] = [];

  for (const sku of skus) {
    const filters: Record<string, string> = { 'Sku.eq': sku };
    if (creds.clientIdentifier) {
      filters['ClientIdentifier.eq'] = creds.clientIdentifier;
    }
    const params = new URLSearchParams(filters);
    const path = `/v3.1/Inventory/list/i/0/s/${pageSize}?${params.toString()}`;
    const result = await logiwaFetch(creds, 'GET', path);

    if (result?.data) {
      allItems.push(...result.data);
    }
  }

  return allItems;
}

// ── Purchase Order Operations ────────────────────────

export interface CreatePurchaseOrderInput {
  code: string;
  vendor?: string;
  purchaseOrderDate?: string;
  plannedReceivingDate?: string;
  plannedArrivalDate?: string;
  referenceNumber?: string;
  purchaseOrderLineList: Array<{
    sku: string;
    packType?: string;
    packQuantity: number;
    unitPrice?: number;
    lotBatchNumber?: string;
  }>;
  vendorBillingAddress?: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  vendorShipmentAddress?: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
}

export async function createPurchaseOrder(
  creds: LogiwaCredentials,
  po: CreatePurchaseOrderInput
): Promise<{ identifier: string; status: number; message: string }> {
  const today = new Date().toISOString().split('T')[0];
  const payload = {
    ...po,
    purchaseOrderDate: po.purchaseOrderDate || today,
    clientIdentifier: creds.clientIdentifier,
    warehouseIdentifier: creds.warehouseIdentifier,
  };

  const result = await logiwaFetch(creds, 'POST', '/v3.1/PurchaseOrder/create', payload);
  return {
    identifier: result.value || result.data,
    status: result.status || 0,
    message: result.message || 'Created',
  };
}

export async function getPurchaseOrder(
  creds: LogiwaCredentials,
  identifier: string
): Promise<any> {
  return logiwaFetch(creds, 'GET', `/v3.1/PurchaseOrder/${identifier}`);
}

export async function listPurchaseOrders(
  creds: LogiwaCredentials,
  index: number,
  size: number,
  filters?: Record<string, string>
): Promise<{ data: any[]; totalCount: number }> {
  let path = `/v3.1/PurchaseOrder/list/i/${index}/s/${size}`;
  if (filters) {
    const params = new URLSearchParams(filters);
    path += `?${params.toString()}`;
  }
  return logiwaFetch(creds, 'GET', path);
}

export async function getPurchaseOrderReceipts(
  creds: LogiwaCredentials,
  index: number,
  size: number,
  filters?: Record<string, string>
): Promise<any[]> {
  let path = `/v3.1/Report/PurchaseOrderReceivingHistory/i/${index}/s/${size}`;
  if (filters) {
    const params = new URLSearchParams(filters);
    path += `?${params.toString()}`;
  }
  const result = await logiwaFetch(creds, 'GET', path);
  return result?.data || [];
}

// ── Webhook Management ───────────────────────────────

export async function subscribeWebhook(
  creds: LogiwaCredentials,
  topic: string,
  callbackUrl: string
): Promise<string> {
  const payload = {
    topic,
    address: callbackUrl,
    clientIdentifier: creds.clientIdentifier,
    ignoreClient: false,
  };
  const result = await logiwaFetch(creds, 'POST', '/v3.1/Webhook/create', payload);
  return result.data;
}

export async function listWebhooks(
  creds: LogiwaCredentials
): Promise<any[]> {
  const result = await logiwaFetch(creds, 'GET', '/v3.1/Webhook/list');
  return result?.data || [];
}

export async function deleteWebhook(
  creds: LogiwaCredentials,
  subscriptionId: string
): Promise<boolean> {
  const result = await logiwaFetch(creds, 'DELETE', `/v3.1/Webhook/${subscriptionId}`);
  return result?.value === true;
}
