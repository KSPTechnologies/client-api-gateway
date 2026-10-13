import { Env } from '../index';
import {
  getSpeedeeConfig, getSpeedeeCreds, speedee, SpeedeeEnv, SpeedeeError, SpeedeeCreds,
} from '../lib/speedee';
import {
  SpeedeeConfig, buildSpeedeeBody, bucketCharges, businessDaysBetween, isTemporaryTracking,
} from '../lib/speedee-map';

/**
 * Logiwa Custom Carrier adapter for SpeeDee (ShipIt).
 * Routes (branched in router.ts BEFORE tenant auth — this uses its own
 * key/secret -> bearer token system, like Logiwa's custom-carrier contract):
 *   POST /carriers/speedee/token     key/secret -> bearer token
 *   POST /carriers/speedee/rate      CustomCarrier GetRate
 *   POST /carriers/speedee/create    CustomCarrier CreateLabel
 *   POST /carriers/speedee/void      CustomCarrier VoidLabel
 *   POST /carriers/speedee/eod       CustomCarrier EndOfDay
 *   POST /carriers/speedee/webhook   SpeeDee status callbacks
 *
 * Contract notes: per-item failures return HTTP 200 with isSuccessful:false;
 * HTTP 400/401/500 are reserved for malformed payloads, auth, or total outage.
 */

export async function handleSpeedeeCarrier(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  const sub = path.replace(/^\/carriers\/speedee\/?/, '').replace(/\/$/, '');

  if (request.method !== 'POST') {
    return Response.json({ error: 'POST only' }, { status: 405 });
  }

  if (sub === 'token') return issueToken(request, env);
  if (sub === 'webhook') return handleWebhook(request, env);

  // Everything else requires a bearer token issued by /token
  const authz = request.headers.get('Authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : null;
  const tokenOk = token ? await env.KV.get(`speedee_token:${token}`) : null;
  if (!tokenOk) {
    return Response.json({ error: 'invalid or expired token' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const cfg = await getSpeedeeConfig(env);
  const webhookUrl = `${new URL(request.url).origin}/carriers/speedee/webhook`;

  switch (sub) {
    case 'rate': return handleRate(env, cfg, body, webhookUrl);
    case 'create': return handleCreate(env, cfg, body, webhookUrl);
    case 'void': return handleVoid(env, cfg, body);
    case 'eod': return handleEod(env, cfg, body);
    default: return Response.json({ error: 'not found' }, { status: 404 });
  }
}

// ── Token endpoint ───────────────────────────────────
// Logiwa's exact token request shape isn't documented in our spec dump, so
// accept all common shapes and LOG which one arrived (watch once wired up).

async function issueToken(request: Request, env: Env): Promise<Response> {
  let apiKey: string | null = null;
  let apiSecret: string | null = null;
  let shape = 'unknown';

  const basic = request.headers.get('Authorization') || '';
  if (basic.startsWith('Basic ')) {
    try {
      const [k, s] = atob(basic.slice(6)).split(':');
      if (k && s) { apiKey = k; apiSecret = s; shape = 'http-basic'; }
    } catch { /* fall through */ }
  }

  if (!apiKey) {
    const ct = (request.headers.get('Content-Type') || '').toLowerCase();
    try {
      if (ct.includes('json')) {
        const b: any = await request.json();
        apiKey = b?.apiKey ?? b?.api_key ?? b?.client_id ?? b?.clientId ?? b?.key ?? null;
        apiSecret = b?.apiSecret ?? b?.api_secret ?? b?.client_secret ?? b?.clientSecret ?? b?.secret ?? null;
        shape = 'json';
      } else {
        const text = await request.text();
        const form = new URLSearchParams(text);
        apiKey = form.get('client_id') || form.get('apiKey') || form.get('api_key') || form.get('username');
        apiSecret = form.get('client_secret') || form.get('apiSecret') || form.get('api_secret') || form.get('password');
        shape = 'form-urlencoded';
      }
    } catch { /* leave null */ }
  }

  console.log(`[speedee] token request shape=${shape} keyPresent=${!!apiKey}`);
  if (!apiKey || !apiSecret) {
    return Response.json({ error: 'missing credentials' }, { status: 400 });
  }

  const secretHash = await sha256Hex(apiSecret);
  const row = (await env.DB.prepare(
    `SELECT id FROM carrier_api_clients WHERE carrier='speedee' AND api_key = ? AND secret_hash = ? AND active = 1`
  ).bind(apiKey, secretHash).first()) as any;
  if (!row) {
    return Response.json({ error: 'invalid credentials' }, { status: 401 });
  }

  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await env.KV.put(`speedee_token:${token}`, JSON.stringify({ apiKey, clientId: row.id }), { expirationTtl: 3600 });

  // OAuth-style plus aliases — Logiwa implementations vary in which field they read.
  return Response.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: 3600,
    token,
    apiToken: token,
  });
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Shared helpers ───────────────────────────────────

const asArray = (b: any): any[] => (Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : [b]);

function envOf(req: any): SpeedeeEnv {
  // testLabel on each request; absent => TEST (never make real labels by accident).
  if (req?.testLabel === false || req?.testLabel === 'false') return 'production';
  if (req?.testLabel === undefined || req?.testLabel === null) {
    console.log('[speedee] request without testLabel — defaulting to TEST env');
  }
  return 'test';
}

function fail(req: any, messages: string[]): Record<string, unknown> {
  return {
    shipmentOrderIdentifier: req?.shipmentOrderIdentifier ?? null,
    shipmentOrderCode: req?.shipmentOrderCode ?? null,
    isSuccessful: false,
    message: messages,
  };
}

function validationMessages(resp: any): string[] {
  const v = resp?.validationErrors;
  if (!Array.isArray(v) || v.length === 0) return [];
  return v.map((e: any) => String(e?.message ?? e?.error ?? JSON.stringify(e)).slice(0, 300));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Mock-mode triggers mirror Logiwa's own test harness (FAIL / 400 / TIMEOUT15).
function mockTrigger(cfg: SpeedeeConfig, req: any): 'fail' | 'http400' | 'timeout' | null {
  if (!cfg.mockMode) return null;
  const code = String(req?.shipmentOrderCode ?? '');
  if (code.includes('TIMEOUT15')) return 'timeout';
  if (code.includes('400')) return 'http400';
  if (code.includes('FAIL')) return 'fail';
  return null;
}

// ── Rate ─────────────────────────────────────────────

async function handleRate(env: Env, cfg: SpeedeeConfig, body: any, webhookUrl: string): Promise<Response> {
  const out: Array<Record<string, unknown>> = [];
  for (const req of asArray(body)) {
    const trigger = mockTrigger(cfg, req);
    if (trigger === 'http400') return Response.json({ error: 'mock 400' }, { status: 400 });
    if (trigger === 'timeout') await sleep(15_000);
    if (trigger === 'fail') { out.push(fail(req, ['mock failure (FAIL trigger)'])); continue; }

    try {
      const environment = envOf(req);
      const creds = await getSpeedeeCreds(env, environment);
      if (!creds) { out.push(fail(req, [`SpeeDee ${environment} credentials not configured`])); continue; }

      const mapped = buildSpeedeeBody(req, cfg, webhookUrl);
      if (mapped.errors.length) { out.push(fail(req, mapped.errors)); continue; }

      const quote = await speedee.quote(creds, cfg, mapped.body);
      const vErrs = validationMessages(quote);
      if (vErrs.length) { out.push(fail(req, vErrs)); continue; }

      const charges: any[] = quote?.charges ?? quote?.data?.charges ?? [];
      const buckets = bucketCharges(charges, cfg);
      const dropoffEnd = quote?.dropoffWindow?.end ?? quote?.data?.dropoffWindow?.end ?? null;
      const readyAt = String((mapped.body as any).readyAt);

      out.push({
        shipmentOrderIdentifier: req?.shipmentOrderIdentifier ?? null,
        shipmentOrderCode: req?.shipmentOrderCode ?? null,
        rateList: [{
          carrier: cfg.displayName,
          shippingOption: req?.shippingOption ?? req?.shippingOptionName ?? 'GROUND',
          totalCost: buckets.totalCost,
          shippingCost: buckets.shippingCost,
          otherCost: buckets.otherCost,
          currency: 'USD',
          expectedDeliveryDate: dropoffEnd,
          estimatedDays: dropoffEnd ? businessDaysBetween(readyAt, dropoffEnd) : 1,
        }],
        isSuccessful: true,
        message: mapped.warnings,
      });
    } catch (err) {
      out.push(fail(req, [err instanceof Error ? err.message : String(err)]));
    }
  }
  return Response.json({ data: out });
}

// ── Create Label ─────────────────────────────────────

async function handleCreate(env: Env, cfg: SpeedeeConfig, body: any, webhookUrl: string): Promise<Response> {
  const out: Array<Record<string, unknown>> = [];
  for (const req of asArray(body)) {
    out.push(await createOne(env, cfg, req, webhookUrl));
  }
  return Response.json({ data: out });
}

async function createOne(env: Env, cfg: SpeedeeConfig, req: any, webhookUrl: string): Promise<Record<string, unknown>> {
  const soId = String(req?.shipmentOrderIdentifier ?? '');
  const soCode = req?.shipmentOrderCode ?? null;
  const started = Date.now();

  const trigger = mockTrigger(cfg, req);
  if (trigger === 'timeout') await sleep(15_000);
  if (trigger === 'fail') return fail(req, ['mock failure (FAIL trigger)']);

  try {
    if (!soId) return fail(req, ['missing shipmentOrderIdentifier']);

    // Idempotency: an existing non-voided/non-failed SpeeDee order replays its
    // stored response — Logiwa retries after timeouts and must not get dupes.
    const existing = (await env.DB.prepare(
      `SELECT status, response_json FROM speedee_orders WHERE shipment_order_identifier = ?`
    ).bind(soId).first()) as any;
    if (existing && existing.status === 'CREATED' && existing.response_json) {
      console.log(`[speedee] create ${soCode}: replaying stored result (idempotent)`);
      return JSON.parse(existing.response_json);
    }

    // ZPL only
    const fileType = String(req?.labelSpecification?.labelFileType ?? 'ZPL').toUpperCase();
    if (fileType !== 'ZPL') {
      return fail(req, [`SpeeDee supports ZPL 4x6 only (requested ${fileType})`]);
    }

    const environment = envOf(req);
    const creds = await getSpeedeeCreds(env, environment);
    if (!creds) return fail(req, [`SpeeDee ${environment} credentials not configured`]);

    const mapped = buildSpeedeeBody(req, cfg, webhookUrl);
    if (mapped.errors.length) return fail(req, mapped.errors);
    const warnings = [...mapped.warnings];

    // Return labels: default = create a normal order with the given (already
    // reversed) addresses; config flag switches to /orders/return when we know
    // the original SpeeDee order.
    let created: any;
    let usedReturnEndpoint = false;
    if (req?.isReturnLabel === true && cfg.useReturnEndpoint) {
      const orig = (await env.DB.prepare(
        `SELECT speedee_order_id FROM speedee_orders WHERE shipment_order_code = ? AND status='CREATED' ORDER BY created_at DESC LIMIT 1`
      ).bind(req?.originalShipmentOrderCode ?? soCode).first()) as any;
      if (orig?.speedee_order_id) {
        created = await speedee.createReturn(creds, cfg, orig.speedee_order_id, mapped.body);
        usedReturnEndpoint = true;
      }
    }
    if (!created) created = await speedee.createOrder(creds, cfg, mapped.body);

    const orderId: string | null =
      created?.orderId ?? created?.id ?? created?.data?.orderId ?? created?.order?.orderId ?? null;

    const vErrs = validationMessages(created);
    if (vErrs.length) {
      if (orderId) { try { await speedee.cancelOrder(creds, cfg, orderId); } catch { /* best-effort */ } }
      return fail(req, vErrs);
    }
    if (!orderId) return fail(req, ['SpeeDee did not return an orderId']);

    // Persist early (status CREATED comes only after tracking+labels succeed).
    await upsertOrder(env, soId, soCode, orderId, environment, 'PENDING', null, null, null, null);

    // Poll until every item's tracking number is real (temporary = 01, 02, …).
    // Never return a label carrying a temporary number.
    let items: any[] = [];
    let backoffIdx = 0;
    for (;;) {
      const itemsResp = await speedee.getItems(creds, cfg, orderId);
      items = itemsResp?.items ?? itemsResp?.data ?? (Array.isArray(itemsResp) ? itemsResp : []);
      const pending = items.filter((it: any) => isTemporaryTracking(it?.trackingNumber ?? it?.tracking));
      if (items.length > 0 && pending.length === 0) break;
      if (Date.now() - started > cfg.pollBudgetMs) {
        try { await speedee.cancelOrder(creds, cfg, orderId); } catch { /* best-effort */ }
        await upsertOrder(env, soId, soCode, orderId, environment, 'FAILED', null, null, null, null);
        return fail(req, ['tracking number not assigned in time, retry']);
      }
      const wait = cfg.pollBackoffMs[Math.min(backoffIdx++, cfg.pollBackoffMs.length - 1)];
      await sleep(wait);
    }

    // Labels (ZPL, STANDARD 4x6)
    const labelsResp = await speedee.labelsJson(creds, cfg, orderId);
    const labels = extractLabels(labelsResp);
    if (labels.length === 0) {
      try { await speedee.cancelOrder(creds, cfg, orderId); } catch { /* best-effort */ }
      await upsertOrder(env, soId, soCode, orderId, environment, 'FAILED', null, null, null, null);
      return fail(req, ['SpeeDee returned no labels']);
    }

    // Charges for rate detail: from the order, else re-quote the same body.
    let charges: any[] = [];
    try {
      const order = await speedee.getOrder(creds, cfg, orderId);
      charges = order?.charges ?? order?.data?.charges ?? order?.order?.charges ?? [];
    } catch { /* fall through */ }
    if (charges.length === 0) {
      try {
        const q = await speedee.quote(creds, cfg, mapped.body);
        charges = q?.charges ?? q?.data?.charges ?? [];
      } catch { warnings.push('pricing unavailable (order charges and fallback quote both failed)'); }
    }
    const buckets = bucketCharges(charges, cfg);
    const zone = (charges || []).find((ch: any) =>
      String(ch?.chargeId ?? ch?.id ?? '').toUpperCase() === 'DELIVERY')?.toZone ?? null;

    // Build per-package responses, storing each ZPL in R2.
    const reqPkgs: any[] = Array.isArray(req?.requestedPackageLineItems) ? req.requestedPackageLineItems : [];
    const perPkgCost = reqPkgs.length > 0 ? round2(buckets.totalCost / reqPkgs.length) : buckets.totalCost;
    const packages: Array<{ sequence: number; trackingNumber: string; labelKey: string }> = [];
    const packageResponse: Array<Record<string, unknown>> = [];

    for (let i = 0; i < items.length; i++) {
      const tracking = String(items[i]?.trackingNumber ?? items[i]?.tracking ?? '');
      const zplB64 = labels[i] ?? labels[0];
      const labelKey = `speedee/${environment}/${orderId}/label-${i}.zpl`;
      try { await env.R2.put(labelKey, Uint8Array.from(atob(zplB64), (ch) => ch.charCodeAt(0))); } catch { /* non-fatal */ }
      packages.push({ sequence: i, trackingNumber: tracking, labelKey });
      packageResponse.push({
        packageSequenceNumber: reqPkgs[i]?.packageSequenceNumber ?? i + 1,
        trackingNumber: tracking,
        encodedLabel: zplB64,
        labelUrl: null,
        trackingUrl: cfg.trackingUrlTemplate.replace('{tracking}', encodeURIComponent(tracking)),
        externalReference: orderId,
        rateDetail: { totalCost: perPkgCost, currency: 'USD' },
      });
    }

    const masterTracking = packages[0]?.trackingNumber ?? null;
    let dropoffEnd: string | null = null;
    try {
      const order = await speedee.getOrder(creds, cfg, orderId);
      dropoffEnd = order?.dropoffWindow?.end ?? order?.data?.dropoffWindow?.end ?? null;
    } catch { /* optional */ }
    if (usedReturnEndpoint) warnings.push('created via SpeeDee return-order endpoint');

    const entry: Record<string, unknown> = {
      shipmentOrderIdentifier: soId,
      shipmentOrderCode: soCode,
      carrier: cfg.displayName,
      shippingOption: req?.shippingOption ?? req?.shippingOptionName ?? 'GROUND',
      zone,
      masterTrackingNumber: masterTracking,
      packageResponse,
      rateDetail: { ...buckets, currency: 'USD' },
      encodedInvoice: null,
      invoiceUrl: null,
      expectedDeliveryDate: dropoffEnd,
      isSuccessful: true,
      message: warnings,
    };

    await upsertOrder(
      env, soId, soCode, orderId, environment, 'CREATED',
      masterTracking, JSON.stringify(packages), JSON.stringify(charges), JSON.stringify(entry)
    );
    console.log(`[speedee] created ${soCode} -> ${orderId} (${items.length} pkg, ${Date.now() - started}ms)`);
    return entry;
  } catch (err) {
    const msg = err instanceof SpeedeeError || err instanceof Error ? err.message : String(err);
    console.error(`[speedee] create ${soCode} failed:`, msg);
    return fail(req, [msg]);
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

function upsertOrder(
  env: Env, soId: string, soCode: string | null, orderId: string | null, environment: string,
  status: string, masterTracking: string | null, packages: string | null, charges: string | null, responseJson: string | null
) {
  return env.DB.prepare(
    `INSERT INTO speedee_orders (id, shipment_order_identifier, shipment_order_code, speedee_order_id, environment, status, master_tracking_number, packages, charges, response_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(shipment_order_identifier) DO UPDATE SET
       speedee_order_id = excluded.speedee_order_id, status = excluded.status,
       master_tracking_number = excluded.master_tracking_number, packages = excluded.packages,
       charges = excluded.charges, response_json = excluded.response_json, updated_at = datetime('now')`
  ).bind(crypto.randomUUID(), soId, soCode, orderId, environment, status, masterTracking, packages, charges, responseJson).run();
}

/** Accept the label-download response in any plausible shape; return base64 ZPLs. */
function extractLabels(resp: any): string[] {
  const list = resp?.labels ?? resp?.data ?? (Array.isArray(resp) ? resp : []);
  const out: string[] = [];
  for (const l of list) {
    const raw = l?.zpl ?? l?.label ?? l?.data ?? l?.content ?? (typeof l === 'string' ? l : null);
    if (!raw) continue;
    const s = String(raw);
    // ZPL starts with ^XA; base64 of it starts with XlhB. Encode raw ZPL.
    out.push(s.startsWith('^') ? btoa(s) : s);
  }
  return out;
}

// ── Void ─────────────────────────────────────────────

async function handleVoid(env: Env, cfg: SpeedeeConfig, body: any): Promise<Response> {
  const out: Array<Record<string, unknown>> = [];
  for (const req of asArray(body)) {
    out.push(await voidOne(env, cfg, req));
  }
  return Response.json({ data: out });
}

async function voidOne(env: Env, cfg: SpeedeeConfig, req: any): Promise<Record<string, unknown>> {
  const soId = req?.shipmentOrderIdentifier ?? null;
  const masterTracking = req?.masterTrackingNumber ?? req?.trackingNumber ?? null;
  const respond = (ok: boolean, msgs: string[]) => ({
    shipmentOrderIdentifier: soId, masterTrackingNumber: masterTracking, isSuccessful: ok, message: msgs,
  });

  try {
    const environment = envOf(req);
    const creds = await getSpeedeeCreds(env, environment);
    if (!creds) return respond(false, [`SpeeDee ${environment} credentials not configured`]);

    // Resolve the SpeeDee orderId: externalReference -> our DB -> search.
    let orderId: string | null = req?.externalReference ?? req?.packageResponse?.[0]?.externalReference ?? null;
    let row: any = null;
    if (soId) {
      row = await env.DB.prepare(
        `SELECT speedee_order_id, status, packages FROM speedee_orders WHERE shipment_order_identifier = ?`
      ).bind(String(soId)).first();
      orderId = orderId || row?.speedee_order_id || null;
    }
    if (!orderId && masterTracking) {
      row = await env.DB.prepare(
        `SELECT speedee_order_id, status, packages FROM speedee_orders WHERE master_tracking_number = ?`
      ).bind(String(masterTracking)).first();
      orderId = row?.speedee_order_id || null;
    }
    if (!orderId && masterTracking) {
      try {
        const found = await speedee.search(creds, cfg, { trackingNumber: masterTracking });
        orderId = found?.orders?.[0]?.orderId ?? found?.data?.[0]?.orderId ?? null;
      } catch { /* fall through */ }
    }
    if (!orderId) return respond(false, ['SpeeDee order not found for this shipment']);

    // Idempotent: already voided => success.
    if (row?.status === 'VOIDED') return respond(true, ['already voided']);

    // Scope: single package among several active => delete that item only.
    const pkgRef = req?.packageReference ?? req?.packageTrackingNumber ?? null;
    const pkgs: any[] = row?.packages ? JSON.parse(row.packages) : [];
    if (pkgRef && pkgs.length > 1) {
      const target = pkgs.find((p) => String(p.trackingNumber) === String(pkgRef) || String(p.sequence) === String(pkgRef));
      if (target) {
        await speedee.deleteItems(creds, cfg, orderId, [target.trackingNumber]);
        return respond(true, [`package ${pkgRef} removed from SpeeDee order ${orderId}`]);
      }
    }

    try {
      await speedee.cancelOrder(creds, cfg, orderId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Already-canceled must be idempotent success; picked-up is a real refusal.
      if (/already.*(cancel|void)/i.test(msg)) { /* treat as success */ }
      else return respond(false, [msg]);
    }

    if (soId || masterTracking) {
      await env.DB.prepare(
        `UPDATE speedee_orders SET status='VOIDED', updated_at=datetime('now') WHERE speedee_order_id = ?`
      ).bind(orderId).run();
    }
    return respond(true, [`SpeeDee order ${orderId} voided`]);
  } catch (err) {
    return respond(false, [err instanceof Error ? err.message : String(err)]);
  }
}

// ── End of Day ───────────────────────────────────────

async function handleEod(env: Env, cfg: SpeedeeConfig, body: any): Promise<Response> {
  const req = asArray(body)[0] ?? {};
  const closeDate = String(req?.closeDate ?? new Date().toISOString()).slice(0, 10);
  const environment = envOf(req);

  if (cfg.eodMode === 'portal') {
    return Response.json({
      encodedReport: null,
      isSuccessful: true,
      message: [
        `SpeeDee manifest for ${closeDate}: print from the ShipIt web portal (Orders -> Reports -> manifest for ship date).`,
        'Gateway manifest summary sheet is disabled pending SpeeDee Integrations approval (speedee:config eodMode).',
      ],
    });
  }

  const { results } = await env.DB.prepare(
    `SELECT shipment_order_code, speedee_order_id, master_tracking_number, packages, charges, created_at
     FROM speedee_orders
     WHERE environment = ? AND status = 'CREATED' AND date(created_at) = date(?)
     ORDER BY created_at`
  ).bind(environment, closeDate).all();

  const rows: string[][] = [];
  let pkgCount = 0;
  for (const r of (results || []) as any[]) {
    const pkgs: any[] = r.packages ? JSON.parse(r.packages) : [];
    const charges: any[] = r.charges ? JSON.parse(r.charges) : [];
    const accessorials = charges
      .map((c) => String(c?.chargeId ?? c?.id ?? '').toUpperCase())
      .filter((id) => ['AOD', 'AODSIGNATURE', 'AODINDIRECT', 'HAZMAT', 'DECLAREDVALUE'].includes(id))
      .join('+');
    for (const p of pkgs) {
      pkgCount++;
      rows.push([String(r.speedee_order_id ?? ''), String(p.trackingNumber ?? ''), String(r.shipment_order_code ?? ''), accessorials || '-']);
    }
  }

  const pdf = buildManifestPdf(closeDate, (results || []).length, pkgCount, rows);
  return Response.json({
    encodedReport: pdf,
    isSuccessful: true,
    message: [`gateway-generated manifest summary sheet (${(results || []).length} orders, ${pkgCount} packages) — not an official ShipIt manifest`],
  });
}

// Minimal hand-rolled PDF (Courier text rows) — keeps CPU tiny on the Workers
// free plan; no dependencies. One or more pages of fixed-width rows.
function buildManifestPdf(closeDate: string, orderCount: number, pkgCount: number, rows: string[][]): string {
  const header = [
    `KSP Fulfillment — SpeeDee Manifest Summary Sheet`,
    `Ship date: ${closeDate}    Orders: ${orderCount}    Packages: ${pkgCount}`,
    ``,
    `${'SpeeDee ID'.padEnd(12)}${'Tracking'.padEnd(24)}${'Reference'.padEnd(20)}Accessorials`,
    `${'-'.repeat(70)}`,
  ];
  const lines = [
    ...header,
    ...rows.map((r) => `${r[0].padEnd(12)}${r[1].padEnd(24)}${r[2].padEnd(20)}${r[3]}`),
    ``, ``,
    `Driver signature: ______________________    Shipper signature: ______________________`,
  ];

  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const perPage = 54;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (pages.length === 0) pages.push(['(no SpeeDee orders for this date)']);

  const objects: string[] = [];
  const pageObjIds: number[] = [];
  let nextId = 3; // 1=catalog, 2=pages
  const fontId = nextId++;
  for (const pageLines of pages) {
    const contentId = nextId++;
    const pageId = nextId++;
    const text = pageLines.map((l, idx) => `BT /F1 9 Tf 36 ${756 - idx * 13} Td (${esc(l)}) Tj ET`).join('\n');
    objects[contentId] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    pageObjIds.push(pageId);
  }
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>`;
  objects[fontId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < nextId; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let i = 1; i < nextId; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return btoa(pdf);
}

// ── Webhook (SpeeDee delivered/canceled callbacks) ───

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  let payload: any = null;
  try { payload = await request.json(); } catch { /* accept anything */ }
  const orderId = payload?.orderId ?? payload?.order?.orderId ?? null;
  const status = String(payload?.status ?? payload?.event ?? '').toUpperCase();
  console.log(`[speedee] webhook orderId=${orderId} status=${status}`);
  if (orderId && (status.includes('CANCEL') || status.includes('VOID'))) {
    await env.DB.prepare(
      `UPDATE speedee_orders SET status='VOIDED', updated_at=datetime('now') WHERE speedee_order_id = ?`
    ).bind(String(orderId)).run();
  }
  // Logiwa tracks its own custom-carrier shipments; nothing to forward today.
  return Response.json({ ok: true });
}
