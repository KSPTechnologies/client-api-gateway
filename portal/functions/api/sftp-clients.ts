import { provisionSftpUser, provisioningConfigured, ProvisionEnv } from './_sftpgo';

interface Env extends ProvisionEnv {
  DB: D1Database;
}

// GET /api/sftp-clients — list SFTP→tenant links + selectable tenants
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const clients = await env.DB.prepare(
    `SELECT sc.sftp_username, sc.tenant_id, t.name as tenant_name, sc.environment,
            sc.r2_prefix, sc.enabled, sc.created_at
     FROM sftp_clients sc LEFT JOIN tenants t ON sc.tenant_id = t.id
     ORDER BY sc.created_at DESC`
  ).all();
  const tenants = await env.DB.prepare(
    `SELECT id, name, logiwa_sandbox_client_id, logiwa_prod_client_id
     FROM tenants WHERE active = 1 ORDER BY name`
  ).all();
  return Response.json({
    clients: clients.results,
    tenants: tenants.results,
    provisioning: provisioningConfigured(env),
  });
};

// POST /api/sftp-clients — link (default), or { action: 'toggle' | 'unlink' }
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as {
    action?: 'toggle' | 'unlink';
    sftp_username?: string;
    tenant_id?: string;
    environment?: 'sandbox' | 'production';
    enabled?: number;
    public_key?: string;
  };

  const username = (body.sftp_username || '').trim();
  if (!username) return Response.json({ error: 'sftp_username is required' }, { status: 400 });

  if (body.action === 'toggle') {
    await env.DB.prepare(
      `UPDATE sftp_clients SET enabled = ?, updated_at = datetime('now') WHERE sftp_username = ?`
    ).bind(body.enabled ? 1 : 0, username).run();
    return Response.json({ ok: true });
  }

  if (body.action === 'unlink') {
    await env.DB.prepare('DELETE FROM sftp_clients WHERE sftp_username = ?').bind(username).run();
    return Response.json({ ok: true });
  }

  // Create / update a link
  if (!body.tenant_id) return Response.json({ error: 'Select a client to link' }, { status: 400 });
  const environment = body.environment === 'production' ? 'production' : 'sandbox';

  const tenant = await env.DB.prepare(
    'SELECT name, logiwa_sandbox_client_id, logiwa_prod_client_id FROM tenants WHERE id = ?'
  ).bind(body.tenant_id).first();
  if (!tenant) return Response.json({ error: 'Client not found' }, { status: 404 });

  const clientId = environment === 'production' ? tenant.logiwa_prod_client_id : tenant.logiwa_sandbox_client_id;
  if (!clientId) {
    return Response.json(
      { error: `${tenant.name} has no Logiwa ${environment} client configured. Set it up in the client's settings first.` },
      { status: 400 }
    );
  }

  const r2Prefix = `sftp/${username}/`;
  await env.DB.prepare(
    `INSERT INTO sftp_clients (sftp_username, tenant_id, environment, r2_prefix, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
     ON CONFLICT(sftp_username) DO UPDATE SET
       tenant_id = excluded.tenant_id,
       environment = excluded.environment,
       r2_prefix = excluded.r2_prefix,
       enabled = 1,
       updated_at = datetime('now')`
  ).bind(username, body.tenant_id, environment, r2Prefix).run();

  // Auto-provision the SFTPGo account if configured.
  let provisioned: string | null = null;
  if (provisioningConfigured(env)) {
    try {
      const r = await provisionSftpUser(env, username, (body.public_key || '').trim() || null);
      provisioned = r.created ? 'SFTP account created' : 'SFTP account updated';
    } catch (err) {
      provisioned = `mapping saved, but SFTP provisioning failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    provisioned = 'mapping saved (SFTP account must be created manually — provisioning not configured)';
  }

  return Response.json({ ok: true, sftp_username: username, r2_prefix: r2Prefix, environment, provisioned });
};
