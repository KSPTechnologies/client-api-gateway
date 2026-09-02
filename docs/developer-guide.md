# Developer Guide — how the gateway is wired (and how to add a connector)

Read this before touching the repo. It explains the moving parts, the one rule that
protects production, and the recipe every existing connector (Zoho, SFTP, AfterShip)
followed.

---

## 1. The golden rule: ADDITIVE ONLY

**Live production traffic runs through this gateway right now** (Master Tool Repair,
Gray Tools, Pivot Health). You extend it by *adding* — a new tenant, a new route, a new
lib module, a new cron case, a new table — and by *calling* existing functions
(`handleOrders`, `handlePurchaseOrders`, `handleTracking`). You do **not** change the
behavior of functions already in place. If a connector needs something an existing
function almost does, wrap it or add a parallel path; don't edit the hot path.

## 2. Three separate deployables (this trips everyone up)

The repo holds **two different Cloudflare projects plus one external server**. They are
deployed independently and only meet at shared storage:

```
┌────────────────────────┐      ┌──────────────────────────────┐
│  api/  — the WORKER    │      │  portal/ — CF PAGES project  │
│  connect.ksp3plhq.com  │      │  connect-portal.ksp3plhq.com │
│                        │      │                              │
│  client-facing API,    │      │  src/       React SPA (UI)   │
│  crons, connectors     │      │  functions/ Pages Functions  │
└───────────┬────────────┘      └──────────────┬───────────────┘
            │        shared bindings           │
            ▼                                  ▼
        ┌──────────────────────────────────────────┐
        │   D1 (one database) · KV · R2 buckets    │
        └──────────────────────────────────────────┘

  SFTPGo on Linode (172.237.136.77) writes client file-drops into R2 directly;
  the Worker's cron picks them up from R2. The Worker never talks to Linode.
```

What this means in practice:

- **Portal Pages Functions are NOT the Worker.** `portal/functions/api/*.ts` run inside
  the Pages project. They read the *same* D1/KV/R2 via their own bindings in
  `portal/wrangler.toml`, but they share zero code or runtime with `api/src/`. A helper
  added in `api/src/lib/` is not available to a portal function (and vice versa) — if
  both sides need logic, it gets duplicated or kept trivially thin on the portal side.
- **Two wrangler.tomls.** A new binding (e.g. an R2 bucket) must be added to *each*
  project that needs it, separately.
- **Two deploys.** CI deploys both on push to `master`, but they build independently —
  a change under `api/` does not redeploy the portal, and vice versa.
- The portal's job is **visibility and admin** (watch orders/files/pushes, manage
  tenants/keys/links). The Worker's job is **moving data**. Keep writes-to-Logiwa in the
  Worker; the portal reads D1/R2 and only writes admin state.

## 3. How a request flows (API channel)

1. Client calls `https://connect.ksp3plhq.com/v1/...` with `X-API-Key`.
2. `router.ts`: auth (SHA-256 of key → KV `apikey:<hash>` → tenant context), rate limit,
   CORS, request logging.
3. Route handler (`routes/*.ts`): zod validation, then per-tenant transforms in order —
   `applyShippingOptionMapping` → `applyRetailerMapping` → `resolveMissingPackTypes`.
4. `lib/logiwa.ts` forwards to the right Logiwa environment (resolved from the **key's**
   env, falling back to the tenant's), using the tenant's Logiwa client GUID.
5. Result → D1 `orders` row (stamped with `environment`), raw payloads → R2, response →
   client.

Non-API channels (SFTP files, Zoho webhooks) converge on step 3 by constructing an
internal `Request` and calling `handleOrders`/`handlePurchaseOrders` directly — that's
the pattern, because it buys every transform, log, and portal view for free.

## 4. Crons

`api/src/index.ts` `scheduled()` dispatches by cron expression to jobs in `lib/scheduled.ts`,
`lib/sftp.ts`, `lib/aftership.ts`. Every job is wrapped in `recordRun(...)` which writes a
heartbeat row to `cron_runs` — the portal Activity page renders these as health cards.
Current jobs: tracking sync + recent-shipments sweep (15 min), SFTP inbound + confirmations
(2 min), AfterShip push (2 min), inventory cache refresh (hourly).

Adding a schedule = new entry in `api/wrangler.toml` `[triggers]` + a case in `scheduled()`
+ `recordRun` wrapper. Never bolt work onto an existing job's function.

## 5. Recipe: building a new connector

This is the shape Zoho, SFTP, and AfterShip all follow. Copy it.

1. **Migration** — `db/migrations/00XX_<name>.sql`: connector's own tables (an
   `<x>_accounts`/config table keyed by `tenant_id`, and an `<x>_sync`/audit table for
   per-event records). Never `ALTER` hot tables if a new table works. Apply manually:
   `npx wrangler d1 execute client-api-gateway --remote --file=db/migrations/00XX_....sql`
   (migrations are not auto-run by CI).
2. **Tenant** — create the client in the portal (or D1) like any API tenant; the
   connector rides on the normal tenant → Logiwa-client mapping and env toggle.
3. **Credentials** — third-party secrets go in **KV**, keyed `service:<tenantId>`
   (e.g. `aftership:<tenantId>`), never in D1 and never hardcoded. See gotchas below
   before writing them.
4. **Worker code** — one new file: `routes/<x>.ts` for inbound push (webhook) connectors
   (+ a routing branch in `router.ts`), or `lib/<x>.ts` for polling/outbound connectors
   (+ a cron case). Inbound order data funnels into `handleOrders`/`handlePurchaseOrders`
   via an internal `Request` — do not re-implement order submission.
5. **Idempotency** — assume every trigger fires twice. Claim work atomically
   (`INSERT OR IGNORE` on a unique key, like `sftp_files.r2_key`) and make replays
   no-ops (e.g. AfterShip treats duplicate-exists as success, UNIQUE on
   (order_id, tracking_number)).
6. **Ship-state discipline** — anything that fires "on shipment" keys off **actual ship**
   (`logiwaStatus` shipped/delivered or `actualShipmentDate`), never off a tracking
   number existing — labels print minutes before the ship scan.
7. **Portal visibility** — a Pages Function under `portal/functions/api/` that reads the
   connector's D1 tables, and a page under `portal/src/pages/` (register it in
   `App.tsx`). Watch-only is the norm; admin actions stay SQL/KV unless asked.
8. **Docs** — client-facing contract in `docs/` (like `sftp-file-drop-guide.md`), plus a
   README bullet under Current State.

## 6. Gotchas that have each cost real days

- **`wrangler kv key put/get/... ` targets a LOCAL simulator by default. Always pass
  `--remote`.** Two separate multi-day mysteries (util-key 401s; "missing" AfterShip
  creds) were writes that never reached production KV.
- **Secrets with special characters:** write the value to a file with Node and use
  `--path` (or `wrangler secret bulk` with a Node-written JSON). Never shell-interpolate —
  and note PowerShell pipes prepend a UTF-16 BOM that corrupts the stored value.
- **Production cutover is per-KEY, not just per-tenant.** The portal env toggle only sets
  the tenant default. Flipping a client to production requires the tenant's prod Logiwa
  GUID **plus** each active key's `environment` in **both** D1 `api_keys` and the KV
  `apikey:<hash>` JSON.
- **Logiwa quirks:** SKUs need ≥3 chars; `retailerIdentifier` must be a GUID (422
  otherwise); prod address verification rejects some addresses with an **empty-message
  400** (sandbox has no AVS — it won't repro there); the client id Logiwa stamps on an
  order can differ from the client-list id (don't filter unique-id lookups by
  ClientIdentifier); `packType` must match the product (omit it and the gateway fills
  the product default).
- **`*/2` inside a JSDoc comment terminates the comment block** (`*/`). Write
  "2-minute cron" in prose.
- **Windows dev:** `scripts/admin.ts` is broken on Windows (execSync quoting) — create
  keys via the portal or direct D1+KV; use `npm.cmd` if PowerShell policy blocks
  `npm.ps1`; wrangler r2 has no `object list` (use the S3 API against the bucket).
- **Debugging data lives in D1 / the portal / Workers logs** — gateway activity is not
  in Metabase. Start at the portal Activity page (cron heartbeats) and the connector's
  audit table.

## 7. Deploy & CI

Push to `master` → Cloudflare Git integration builds and deploys both projects
(Worker: root `/api`, `npx wrangler deploy`; Portal: root `/portal`, `npm install &&
npm run build` → `dist`). Manual deploys work from each directory. Remember: D1
migrations and KV writes are **manual**, not part of CI.

A cron can fire mid-deploy on the *old* worker — when verifying new connector behavior,
check the stored request payload/audit row before concluding your code didn't work.

## 8. Where things run

| Piece | Where | Admin access |
|---|---|---|
| API Worker | Cloudflare Workers, `connect.ksp3plhq.com` | wrangler / CF dashboard |
| Portal | Cloudflare Pages, `connect-portal.ksp3plhq.com` | behind Cloudflare Access |
| Database | D1 `client-api-gateway` | `npx wrangler d1 execute ... --remote` |
| Keys/creds | KV namespace `43692b54...` | `npx wrangler kv key ... --remote` |
| Payloads | R2 `client-api-gateway-payloads` (+ SFTP bucket) | wrangler / S3 API |
| SFTP server | SFTPGo on Linode `172.237.136.77`, port 2022 | `sftp-admin.ksp3plhq.com` (behind Access) + SSH |
