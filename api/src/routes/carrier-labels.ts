import { Env } from '../index';
import { TenantContext } from '../auth';
import { badRequest, methodNotAllowed } from '../lib/errors';
import { getLogiwaCredentials, getTenantLogiwaConfig, listCarrierLabels, buildListFilters } from '../lib/logiwa';

/**
 * GET /v1/carrier-labels — per-package carrier label pricing for an order.
 * Passthrough to Logiwa /v3.1/ShipmentOrder/carrierlabel/list with the same
 * LQL filter conventions as GET /v1/orders. Logiwa-supported keys:
 *   ShipmentOrderCode.eq, TrackingNumber.eq, MasterTrackingNumber.eq,
 *   Rate.(eq|gt|gte|lt|lte), Carrier.eq, ExternalReference.eq
 * ClientIdentifier / WarehouseIdentifier are gateway-controlled (stripped and
 * re-injected by buildListFilters) so results stay scoped to the tenant.
 * ADDITIVE: new route + endpoint type (carrier_labels); nothing existing changed.
 */
export async function handleCarrierLabels(
  request: Request,
  env: Env,
  tenant: TenantContext,
  path: string
): Promise<Response> {
  if (path !== '/v1/carrier-labels' && path !== '/v1/carrier-labels/') {
    throw badRequest(`Unknown path: ${path}`);
  }
  if (request.method !== 'GET') {
    throw methodNotAllowed();
  }

  const logiwaConfig = await getTenantLogiwaConfig(env, tenant.tenantId, tenant.environment);
  const creds = getLogiwaCredentials(env, logiwaConfig.environment, logiwaConfig.clientIdentifier);
  if (!creds) {
    throw badRequest('Logiwa credentials not configured for this environment');
  }

  const url = new URL(request.url);
  const page = Math.max(0, parseInt(url.searchParams.get('page') || '1') - 1);
  const size = parseInt(url.searchParams.get('size') || '50');

  const filters = buildListFilters(url, creds.clientIdentifier);

  try {
    const result = await listCarrierLabels(creds, page, size, filters);
    return Response.json(result);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Logiwa carrier labels failed:', errMsg);

    await env.DB.prepare(
      `INSERT INTO error_log (tenant_id, endpoint, method, error_message, error_code, retry_count, resolved, created_at)
       VALUES (?, '/v1/carrier-labels', 'GET', ?, 502, 0, 0, datetime('now'))`
    ).bind(tenant.tenantId, errMsg).run();

    return Response.json({ error: errMsg }, { status: 502 });
  }
}
