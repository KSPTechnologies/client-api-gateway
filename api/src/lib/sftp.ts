import { Env } from '../index';
import type { TenantContext } from '../auth';
import { handleOrders } from '../routes/orders';
import { handleTracking } from '../routes/tracking';

/**
 * SFTP file-drop connector (Gray Tools + future clients).
 *
 * Clients drop gateway-v1-JSON order files into their SFTP `in/` folder; SFTPGo
 * writes them into the R2 bucket (binding: SFTP) under `sftp/<user>/in/`.
 * On a cron we:
 *   - inbound: pick up new files, submit each order via the existing handleOrders
 *     path, then move the file to `processed/` (or `failed/`) and record status.
 *   - confirmations (option b): once an SFTP-sourced order is fulfilled (the
 *     existing tracking-sync flips its status), write a tracking/confirmation
 *     file to the client's `out/` folder.
 *
 * ADDITIVE: new file. Reuses handleOrders/handleTracking unchanged; never
 * touches syncTracking.
 */

interface SftpClient {
  sftp_username: string;
  tenant_id: string;
  environment: string;
  r2_prefix: string;
}

function tenantCtx(c: SftpClient): TenantContext {
  return {
    tenantId: c.tenant_id,
    tenantName: c.sftp_username,
    rateLimit: 60,
    active: true,
    environment: c.environment === 'production' ? 'production' : 'sandbox',
  };
}

export async function syncSftpInbound(env: Env): Promise<void> {
  const { results: clients } = await env.DB.prepare(
    `SELECT sftp_username, tenant_id, environment, r2_prefix FROM sftp_clients WHERE enabled = 1`
  ).all();
  if (!clients || clients.length === 0) return;

  for (const row of clients) {
    const c = row as unknown as SftpClient;
    const inPrefix = `${c.r2_prefix}in/`;

    let listed;
    try {
      listed = await env.SFTP.list({ prefix: inPrefix });
    } catch (err) {
      console.error(`[sftp] list failed for ${c.sftp_username}:`, err);
      continue;
    }

    for (const obj of listed.objects) {
      const key = obj.key;
      const name = key.slice(inPrefix.length);
      if (!name || name.endsWith('/')) continue; // folder marker
      if (!name.toLowerCase().endsWith('.json')) continue; // only order files

      // Atomic claim — INSERT OR IGNORE on the unique r2_key. If another
      // (possibly overlapping) cron run already claimed this object, changes=0
      // and we skip it, eliminating the double-processing races.
      let fileId = crypto.randomUUID();
      const claim = await env.DB.prepare(
        `INSERT OR IGNORE INTO sftp_files (id, sftp_username, tenant_id, r2_key, file_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'received', datetime('now'), datetime('now'))`
      ).bind(fileId, c.sftp_username, c.tenant_id, key, name).run();

      if (!claim.meta || claim.meta.changes === 0) {
        // A row already owns this in/ key. Two legitimate cases to take over:
        //  - a stale 'received' claim (a run that died mid-flight >10 min ago)
        //  - a terminal row (error/sent) whose key still points at in/ — that
        //    means a failed move or a client RE-DROP of the same filename;
        //    since the object is demonstrably present, reprocess it.
        const row = (await env.DB.prepare(
          `SELECT id, status, updated_at FROM sftp_files WHERE r2_key = ?`
        ).bind(key).first()) as any;
        if (!row) continue;
        if (row.status === 'received') {
          const ageMs = Date.now() - Date.parse(`${row.updated_at}Z`);
          if (isNaN(ageMs) || ageMs < 10 * 60 * 1000) continue; // active claim
        }
        fileId = row.id;
        await env.DB.prepare(
          `UPDATE sftp_files SET status='received', last_error=NULL, updated_at=datetime('now') WHERE id = ?`
        ).bind(fileId).run();
      }

      try {
        const body = await env.SFTP.get(key);
        if (!body) {
          // Object gone (moved by a prior run) — release nothing, just skip;
          // the row that moved it already records the outcome.
          continue;
        }
        const text = await body.text();
        const parsed = JSON.parse(text);
        const orders = Array.isArray(parsed) ? parsed : [parsed];

        const tenant = tenantCtx(c);
        let firstCode: string | null = null;
        let firstOrderId: string | null = null;
        let errorMsg: string | null = null;

        for (const order of orders) {
          const req = new Request('https://internal/v1/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(order),
          });
          const res = await handleOrders(req, env, tenant, '/v1/orders');
          const r = (await res.json().catch(() => ({}))) as any;
          if (!firstCode) firstCode = r.code ?? (order as any).code ?? null;
          if (!firstOrderId) firstOrderId = r.orderId ?? null;
          if (r.status === 'error' || !res.ok) errorMsg = r.message ?? `submit failed (${res.status})`;
        }

        // Move out of in/ so it isn't reprocessed. Archive name is timestamped
        // so re-drops of the same filename never collide (in R2 or on the
        // unique r2_key column), and every attempt is preserved.
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
        const dest = `${c.r2_prefix}${errorMsg ? 'failed' : 'processed'}/${stamp}_${name}`;
        await env.SFTP.put(dest, text);
        await env.SFTP.delete(key);

        await env.DB.prepare(
          `UPDATE sftp_files SET order_code=?, gateway_order_id=?, status=?, last_error=?, r2_key=?, updated_at=datetime('now') WHERE id=?`
        ).bind(firstCode, firstOrderId, errorMsg ? 'error' : 'sent', errorMsg, dest, fileId).run();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[sftp] processing ${key} failed:`, msg);
        let movedTo: string | null = null;
        try {
          const b = await env.SFTP.get(key);
          if (b) {
            const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
            movedTo = `${c.r2_prefix}failed/${stamp}_${name}`;
            await env.SFTP.put(movedTo, await b.text());
            await env.SFTP.delete(key);
          }
        } catch {
          movedTo = null; /* leave in place for retry next run */
        }
        // Record the failure — and the new key if the move happened, so the
        // in/ key is freed for future re-drops.
        if (movedTo) {
          await env.DB.prepare(
            `UPDATE sftp_files SET status='error', last_error=?, r2_key=?, updated_at=datetime('now') WHERE id=?`
          ).bind(msg, movedTo, fileId).run();
        } else {
          await env.DB.prepare(
            `UPDATE sftp_files SET status='error', last_error=?, updated_at=datetime('now') WHERE id=?`
          ).bind(msg, fileId).run();
        }
      }
    }
  }
}

export async function syncSftpConfirmations(env: Env): Promise<void> {
  // SFTP-sourced orders that have been fulfilled but not yet confirmed to the client.
  const { results } = await env.DB.prepare(
    `SELECT sf.id, sf.sftp_username, sf.tenant_id, sf.order_code, sf.gateway_order_id,
            c.r2_prefix, c.environment
     FROM sftp_files sf
     JOIN orders o ON o.id = sf.gateway_order_id
     JOIN sftp_clients c ON c.sftp_username = sf.sftp_username
     WHERE sf.status = 'sent' AND sf.gateway_order_id IS NOT NULL
       AND o.status IN ('fulfilled','closed')
     LIMIT 50`
  ).all();
  if (!results || results.length === 0) return;

  for (const row of results as any[]) {
    try {
      const tenant = tenantCtx({
        sftp_username: row.sftp_username,
        tenant_id: row.tenant_id,
        environment: row.environment,
        r2_prefix: row.r2_prefix,
      });
      const path = `/v1/orders/${row.gateway_order_id}/tracking`;
      const req = new Request(`https://internal${path}`, { method: 'GET' });
      const res = await handleTracking(req, env, tenant, path);
      const tracking = await res.json().catch(() => ({}));

      const outName = `${row.order_code || row.gateway_order_id}-confirmation.json`;
      const outKey = `${row.r2_prefix}out/${outName}`;
      await env.SFTP.put(outKey, JSON.stringify(tracking, null, 2));

      await env.DB.prepare(
        `UPDATE sftp_files SET status='confirmed', confirmation_key=?, last_error=NULL, updated_at=datetime('now') WHERE id=?`
      ).bind(outKey, row.id).run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sftp] confirmation for order ${row.gateway_order_id} failed:`, msg);
      await env.DB.prepare(
        `UPDATE sftp_files SET last_error=?, updated_at=datetime('now') WHERE id=?`
      ).bind(msg, row.id).run();
    }
  }
}
