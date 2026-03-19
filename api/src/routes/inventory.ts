import { Env } from '../index';
import { TenantContext } from '../auth';
import { inventoryQuerySchema } from '../lib/validate';
import { badRequest, methodNotAllowed } from '../lib/errors';
import { getLogiwaCredentials, queryInventory } from '../lib/logiwa';

export async function handleInventory(
  request: Request,
  env: Env,
  tenant: TenantContext,
  path: string
): Promise<Response> {
  if (request.method === 'POST' && path === '/v1/inventory/query') {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw badRequest('Invalid JSON body');
    }

    const parsed = inventoryQuerySchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw badRequest(`Validation failed: ${issues.join('; ')}`);
    }

    const { skus } = parsed.data;

    // Query inventory cache in D1
    const placeholders = skus.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT sku, quantity, last_synced_at
       FROM inventory_cache
       WHERE tenant_id = ? AND sku IN (${placeholders})`
    )
      .bind(tenant.tenantId, ...skus)
      .all();

    const found = new Map(results.map((r: any) => [r.sku as string, r]));
    const missedSkus = skus.filter((sku) => !found.has(sku));

    // For cache misses, query Logiwa live and backfill cache
    if (missedSkus.length > 0) {
      const creds = getLogiwaCredentials(env);
      if (creds) {
        try {
          const liveItems = await queryInventory(creds, missedSkus);
          for (const item of liveItems) {
            found.set(item.productSku, {
              sku: item.productSku,
              quantity: item.availableQuantity,
              last_synced_at: new Date().toISOString(),
            });

            await env.DB.prepare(
              `INSERT INTO inventory_cache (tenant_id, sku, quantity, last_synced_at)
               VALUES (?, ?, ?, datetime('now'))
               ON CONFLICT (tenant_id, sku) DO UPDATE SET quantity = ?, last_synced_at = datetime('now')`
            )
              .bind(tenant.tenantId, item.productSku, item.availableQuantity, item.availableQuantity)
              .run();
          }
        } catch (err) {
          console.error('Logiwa inventory query failed:', err);
        }
      }
    }

    const items = skus.map((sku) => {
      const cached = found.get(sku);
      return cached
        ? { sku, quantity: cached.quantity, lastSyncedAt: cached.last_synced_at }
        : { sku, quantity: null, lastSyncedAt: null };
    });

    return Response.json({ items });
  }

  throw methodNotAllowed();
}
