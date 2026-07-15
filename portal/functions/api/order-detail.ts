interface Env {
  DB: D1Database;
  R2?: R2Bucket;
}

async function readPayload(env: Env, key: string | null): Promise<string | null> {
  if (!key || !env.R2 || typeof env.R2.get !== 'function') return null;
  try {
    const obj = await env.R2.get(key);
    if (!obj) return null;
    const text = await obj.text();
    return text.length > 6000 ? text.slice(0, 6000) + '\n… (truncated)' : text;
  } catch {
    return null;
  }
}

// GET /api/order-detail?id=<gateway order id>
// One order's full story: core row, channel linkage, timeline, raw payloads.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const order = (await env.DB.prepare(
    `SELECT o.*, t.name as tenant_name FROM orders o JOIN tenants t ON o.tenant_id = t.id WHERE o.id = ?`
  ).bind(id).first()) as any;
  if (!order) return Response.json({ error: 'order not found' }, { status: 404 });

  const sftp = (await env.DB.prepare(
    `SELECT * FROM sftp_files WHERE gateway_order_id = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(id).first()) as any;
  const zoho = (await env.DB.prepare(
    `SELECT * FROM zoho_sync WHERE gateway_order_id = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(id).first()) as any;

  const source = sftp ? 'sftp' : zoho ? 'zoho' : 'api';

  // Timeline (server-assembled, newest last)
  const timeline: { at: string | null; label: string; detail: string }[] = [];
  if (sftp) {
    timeline.push({ at: sftp.created_at, label: 'Received via SFTP', detail: `file ${sftp.file_name} (user ${sftp.sftp_username})` });
  } else if (zoho) {
    timeline.push({ at: zoho.created_at, label: `Received via Zoho (${zoho.source})`, detail: `record ${zoho.zoho_record_id}` });
  } else {
    timeline.push({ at: order.created_at, label: 'Received via API', detail: `POST /v1/orders (code ${order.external_order_id})` });
  }
  if (order.logiwa_order_id) {
    timeline.push({ at: order.updated_at, label: 'Submitted to Logiwa', detail: `Logiwa order ${order.logiwa_order_id}` });
  }
  if (order.status === 'error') {
    timeline.push({ at: order.updated_at, label: 'Errored', detail: sftp?.last_error || zoho?.last_error || 'see error message' });
  }
  if (order.status === 'fulfilled' || order.status === 'closed') {
    timeline.push({ at: order.updated_at, label: order.status === 'fulfilled' ? 'Fulfilled (shipped)' : 'Closed', detail: 'status via tracking sync' });
  }
  if (sftp?.confirmation_key) {
    timeline.push({ at: sftp.updated_at, label: 'Confirmation delivered', detail: `out-file ${sftp.confirmation_key.split('/').pop()}` });
  }
  if (zoho && zoho.writeback_status === 'written') {
    timeline.push({ at: zoho.updated_at, label: 'Confirmation written to Zoho', detail: `record ${zoho.zoho_record_id}` });
  }

  const requestPayload = await readPayload(env, order.request_payload_key);
  const responsePayload = await readPayload(env, order.response_payload_key);

  return Response.json({
    order,
    source,
    sftp: sftp || null,
    zoho: zoho || null,
    timeline,
    requestPayload,
    responsePayload,
    payloadsAvailable: !!(env.R2 && typeof env.R2.get === 'function'),
  });
};
