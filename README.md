# Client API Gateway

Multi-tenant API gateway that sits between external clients and our Logiwa IO WMS. Clients hit our API with their own keys — they never touch Logiwa credentials.

**API (client-facing):** `https://connect.ksp3plhq.com`
**Portal (internal):** `https://connect-portal.ksp3plhq.com`
**SFTP (client file-drops):** `sftp.ksp3plhq.com:2022` (SFTPGo on Linode, R2-backed)

> **New to this repo? Read [`docs/developer-guide.md`](docs/developer-guide.md) first.**
> It explains how the Worker, the portal (a *separate* Cloudflare Pages project with its
> own Functions backend), and the SFTP server fit together — and the step-by-step recipe
> for adding a new connector. ⚠️ This gateway carries **live production traffic**; all
> changes are additive-only.

## Architecture

```
Client → Cloudflare Worker (auth, validate, route) → Logiwa IO API
              ↕                                         ↕
         D1 (database)                          Sandbox or Production
         KV (API key lookups + rate limiting)    (per-client toggle)
         R2 (payload storage)
         Queues (retries — pending enablement)

Portal (Cloudflare Pages) → D1 → create clients, manage keys, view orders/errors
```

Everything is multi-tenant. Each client gets their own API keys, Logiwa client mapping, and sandbox/production environment toggle. Same codebase serves all of them.

## How It Works

1. **Create a client** in the portal — select their Logiwa client from a live dropdown (pulled from Logiwa API), pick which endpoints they need
2. **Generate an API key** for that client
3. **Client sends requests** to `connect.ksp3plhq.com` with their API key in the `X-API-Key` header
4. **Gateway authenticates**, validates the request, and forwards to the correct Logiwa environment (sandbox or production) using the client's mapped Logiwa client identifier
5. **Results logged** in D1, raw payloads stored in R2, errors visible in the portal

## Project Structure

```
├── api/                          ← Cloudflare Worker (the client-facing API)
│   ├── src/
│   │   ├── index.ts              ← Entry point: fetch, scheduled, queue handlers
│   │   ├── auth.ts               ← API key validation (SHA-256 hash → KV lookup)
│   │   ├── routes/
│   │   │   ├── router.ts         ← Request routing, auth gate, rate limiting, CORS, logging
│   │   │   ├── orders.ts         ← GET/POST /v1/orders, POST /v1/orders/bulk, GET /v1/orders/:id
│   │   │   ├── tracking.ts       ← GET /v1/orders/:id/tracking (accepts gateway, Logiwa, or external order id)
│   │   │   ├── inventory.ts      ← GET /v1/inventory (list), POST /v1/inventory/query
│   │   │   ├── purchase-orders.ts ← GET/POST /v1/purchase-orders, GET /v1/purchase-orders/:id[/receipts]
│   │   │   ├── products.ts       ← GET /v1/products (list), POST /v1/products (create SKU)
│   │   │   ├── webhooks.ts       ← POST /v1/webhooks/* (inbound topics from Logiwa, e.g. bulk order)
│   │   │   └── zoho.ts           ← POST /v1/webhooks/zoho (Zoho CRM Sales Order → gateway order)
│   │   └── lib/
│   │       ├── logiwa.ts         ← Logiwa IO API client (auth, orders, inventory, POs, products, webhooks)
│   │       ├── validate.ts       ← Zod schemas for request body validation
│   │       ├── state-codes.ts    ← Normalizes full US state names → 2-letter codes before forwarding
│   │       ├── errors.ts         ← Standardized API error responses
│   │       ├── rate-limit.ts     ← Per-tenant sliding-window rate limiter via KV
│   │       ├── logger.ts         ← Request + error logging to D1
│   │       ├── scheduled.ts      ← Crons + heartbeats: tracking sync, recent-shipments sweep, inventory refresh
│   │       ├── sftp.ts           ← SFTP connector: ingest in/ files (orders + POs), write out/ confirmations
│   │       ├── aftership.ts      ← AfterShip tracking push for enabled tenants (2-min cron)
│   │       ├── packtype.ts       ← Fills missing line packType from the product's Logiwa default (cached)
│   │       ├── shipping-map.ts   ← Per-tenant carrier-setup-name rewrite (shipping_option_mappings)
│   │       ├── retailer-map.ts   ← Per-tenant customer-number → Logiwa retailer GUID (retailer_mappings)
│   │       └── queue.ts          ← Retry queue consumer for failed Logiwa calls
│   ├── scripts/
│   │   ├── admin.ts              ← CLI for tenant/key management (create, list, revoke)
│   │   └── logiwa-info.ts        ← Utility to list Logiwa clients/warehouses
│   ├── wrangler.toml             ← Cloudflare bindings (D1, KV, R2) + custom domain
│   ├── package.json
│   └── tsconfig.json
├── portal/                       ← Cloudflare Pages control portal
│   ├── src/
│   │   ├── App.tsx               ← Main app with sidebar navigation
│   │   ├── App.css               ← Dashboard styling
│   │   └── pages/
│   │       ├── Dashboard.tsx     ← Stats overview, recent API activity
│   │       ├── Activity.tsx      ← Live activity feed + cron health cards (all channels)
│   │       ├── Tenants.tsx       ← Client management, Logiwa mapping, env toggle
│   │       ├── ApiKeys.tsx       ← Generate/revoke keys per client
│   │       ├── Orders.tsx        ← Unified order log (api/sftp/zoho badges, payload drill-down)
│   │       ├── Sftp.tsx          ← SFTP clients + file activity
│   │       ├── Zoho.tsx          ← Zoho connector watch view
│   │       ├── Aftership.tsx     ← AfterShip clients + push history + live courier status
│   │       └── Errors.tsx        ← Error queue with bulk retry/resolve
│   ├── functions/api/            ← Cloudflare Pages Functions (portal backend — separate from the Worker!)
│   │   ├── tenants.ts            ← CRUD tenants with endpoint selection
│   │   ├── api-keys.ts           ← Generate/revoke keys (D1 + KV)
│   │   ├── orders.ts             ← Unified order query (source derived via joins)
│   │   ├── order-detail.ts       ← Per-order timeline + beautified R2 payloads
│   │   ├── activity.ts           ← Merged activity feed + cron_runs health
│   │   ├── sftp.ts / sftp-clients.ts ← SFTP file activity; SFTPGo account provisioning
│   │   ├── _sftpgo.ts            ← SFTPGo REST helper (via CF Access service token)
│   │   ├── aftership*.ts         ← AfterShip watch views (+ live status proxy)
│   │   ├── zoho.ts               ← Zoho sync records
│   │   ├── errors.ts             ← Error queue management
│   │   ├── dashboard.ts          ← Aggregated stats
│   │   ├── environment.ts        ← Per-client sandbox/production toggle
│   │   └── logiwa-clients.ts     ← Live Logiwa client list for dropdowns
│   └── wrangler.toml             ← Pages config with D1 + KV + R2 bindings
├── db/
│   └── migrations/               ← 0001–0011 (see D1 Schema section below)
├── docs/
│   ├── developer-guide.md        ← How it's all wired + how to build a new connector (START HERE)
│   ├── client-integration-guide.md ← Onboarding/integration guide for client devs (the customer doc)
│   ├── sftp-file-drop-guide.md   ← SFTP client contract: folders, file formats, confirmations
│   ├── api-spec.md               ← (stub — superseded by client-integration-guide.md)
│   └── logiwa-api-spec.txt       ← Logiwa IO v3.1 OpenAPI spec (full reference)
└── .gitignore
```

## Cloudflare Resources

| Resource | ID / Name | Binding |
|----------|-----------|---------|
| D1 Database | `625fe274-4768-40f1-8083-2bc201eeb3fd` (client-api-gateway) | `DB` |
| KV Namespace | `43692b54b0074c4692b279977e1a0aca` | `KV` |
| R2 Bucket | `client-api-gateway-payloads` | `R2` |
| Queue | Not yet created (needs Workers Paid plan) | `RETRY_QUEUE` |

## Worker Secrets

Both sandbox and production Logiwa credentials are stored as Worker secrets. Warehouse identifiers are global (one warehouse per environment). Client identifiers are per-tenant in D1.

| Secret | Description |
|--------|-------------|
| `LOGIWA_SANDBOX_API_URL` | `https://myapisandbox.logiwa.com` |
| `LOGIWA_SANDBOX_USERNAME` | Sandbox API user email |
| `LOGIWA_SANDBOX_PASSWORD` | Sandbox API user password |
| `LOGIWA_SANDBOX_WAREHOUSE_IDENTIFIER` | Sandbox warehouse GUID |
| `LOGIWA_PROD_API_URL` | `https://myapi.logiwa.com` |
| `LOGIWA_PROD_USERNAME` | Production API user email |
| `LOGIWA_PROD_PASSWORD` | Production API user password |
| `LOGIWA_PROD_WAREHOUSE_IDENTIFIER` | Production warehouse GUID |

Logiwa creds are also stored in KV (for portal access to fetch live client lists):
- `logiwa:sandbox:api_url`, `logiwa:sandbox:username`, `logiwa:sandbox:password`
- `logiwa:prod:api_url`, `logiwa:prod:username`, `logiwa:prod:password`

## Current State

- **Phase 0 (Scaffolding):** DONE
- **Phase 1 (Seed Tooling):** DONE — CLI + portal for tenant/key management
- **Phase 2 (Auth & Routing):** DONE — rate limiting, zod validation, CORS, standardized errors
- **Phase 3 (Logiwa Integration):** DONE — orders, tracking, inventory, purchase orders, PO receipts, webhooks
- **Phase 4 (Async Work):** DONE — cron tracking sync, inventory cache refresh, retry queue consumer
- **Phase 5 (Control Portal):** DONE — dashboard, client management, API keys, orders, errors, per-client env toggle, live Logiwa client dropdowns
- **Phase 6 (Harden & Ship):** IN PROGRESS

**Shipped since the original Phase 1–5 build (Mar 23 – Apr 28):**
- List endpoints for orders, inventory, POs, and products — all tenant-scoped
- Bulk order submission (`POST /v1/orders/bulk`, max 50)
- Product endpoints (list + create SKU)
- Inbound webhook receiver (subscribed to Logiwa bulk-order topic)
- Per-**key** environment selection (sandbox/prod) on top of the per-tenant toggle (migration 0003)
- US state-name → 2-letter-code normalization before forwarding to Logiwa
- Native-Logiwa-schema passthrough for orders and POs; orders tagged `channelName = 'KSP API Gateway'`
- PO receiving history upgraded to the Logiwa **v3.2** report (page size capped at 200)
- Fixes: rate-limiter TTL (counter never expired), 1-based→0-based pagination, PO `currencyId` default USD(1)

**Shipped July–August 2026 (connectors + hardening era):**
- **SFTP file-drop connector** (Gray Tools live in production): clients drop gateway-v1-JSON
  order/PO files into a chrooted `in/` folder on `sftp.ksp3plhq.com:2022` (SFTPGo on Linode,
  R2-backed); a 2-min cron ingests via the existing order/PO paths, archives each attempt
  timestamped to `processed|failed/`, and writes shipment-confirmation (ASN) files to `out/`
  after actual ship w/ package data (completeness-guarded). Content-based routing:
  `purchaseOrderLineList` → PO, `shipmentOrderLineList` → order. Re-drops of the same
  filename are safe retries. See `docs/sftp-file-drop-guide.md`. Tables: `sftp_clients`,
  `sftp_files` (0005). Portal provisions SFTPGo accounts via its REST API (through the
  CF Access tunnel with a service token).
- **Zoho connector** (Rescue ID): authenticated `POST /v1/webhooks/zoho` translates Zoho
  Sales Orders into gateway orders (0004: `zoho_accounts`, `zoho_sync`).
- **AfterShip connector** (Pivot Health live in production): on fulfillment, pushes trackings
  to the client's AfterShip account (2026-07 API) mirroring their old WMS payload
  (order_id, custom_fields webhook-secret/address/lot) + operational enrichment
  (order_number/date, structured destination, weight, customers[] w/o subscriptions).
  Creds in KV `aftership:<tenant>`; per-push audit in `aftership_pushes` (0008/0009).
- **`GET /v1/inventory/availability`** — true ATP/sellable (Logiwa AvailableToPromise report);
  nets backordered/unallocated demand, unlike `freeQuantity`.
- **packType default resolution**: order/PO lines that omit `packType` get the product's
  default from Logiwa (cached in `product_packtype_cache`, 0006) — makes the documented
  behavior real.
- **Per-tenant shipping-option mapping** (`shipping_option_mappings`, 0010): rewrites client
  carrier-setup names (e.g. `Cheapest` → the prod `Cheapest/ALL` rate-shop) before Logiwa.
- **Per-tenant retailer mapping** (`retailer_mappings`, 0011): client customer numbers →
  Logiwa retailer GUIDs in `retailerDetails.retailerIdentifier` (drives retailer packing
  slips); unmapped values move to `retailerCustomerAccountNumber` (Logiwa 422s non-GUIDs).
- **Tracking-sync overhaul**: orders are environment-stamped at creation (0007) and checked
  in the right Logiwa env (fixed 4,458 orders stuck since April: tenant-default env mismatch
  + a ClientIdentifier filter that hid tenants' own orders); flips only on ACTUAL ship
  (status/ship-scan — never tracking number alone); a per-15-min **recent-shipments sweep**
  (one Logiwa list call per env) front-runs fresh shipments so confirmations land in ~15 min;
  April's diagnostic probe code removed.
- **Cron heartbeats** (`cron_runs`, 0006) — every job records last run + status; surfaced
  as health cards in the portal.
- **Portal**: unified Orders view (per-channel source badges, search, expandable per-order
  timeline w/ raw R2 payloads), live **Activity** feed (15s refresh) + cron health strip,
  **Zoho / SFTP / AfterShip** tabs (SFTP link management + auto-provisioning; AfterShip
  drill-down w/ pushed payload + live courier status). Portal is gated behind Cloudflare
  Access.

**Production clients:** Master Tool Repair (API), Gray Tools (SFTP — orders, ASNs out, POs),
Pivot Health (API + AfterShip), Rescue ID (Zoho, sandbox).

**End-to-end proven in production:** order in (any channel) → Logiwa → warehouse ships →
tracking flips ≤15 min → confirmation file / AfterShip push delivered.

## Getting Started

### Prerequisites
- Node.js 20+
- GitHub CLI (`gh`)
- Access to the KSPTechnologies GitHub org
- Access to the Cloudflare account (mike.geiger@ksp3pl.com's account)

### Setup

```bash
gh repo clone KSPTechnologies/client-api-gateway
cd client-api-gateway/api
npm install
```

### Deploy

Push to `master` and Cloudflare builds and deploys automatically. Or deploy manually:

```bash
cd api
npx wrangler deploy
```

### Admin CLI

```bash
# List all tenants
npm run admin -- list-tenants

# Generate an API key for a tenant
npm run admin -- generate-key --tenant-id <id> --label "production"

# List keys for a tenant
npm run admin -- list-keys --tenant-id <id>

# Revoke an API key
npm run admin -- revoke-key --key-id <id>

# List Logiwa clients and warehouses
npx tsx scripts/logiwa-info.ts <email> <password> [sandbox|production]
```

## API Endpoints

All endpoints (except health) require `X-API-Key` header.

| Method | Path | Description | Logiwa Endpoint |
|--------|------|-------------|-----------------|
| GET | `/v1/health` | Health check (no auth) | — |
| GET | `/v1/orders` | List orders (tenant-scoped) | `GET /v3.1/ShipmentOrder/list` |
| POST | `/v1/orders` | Submit customer order | `POST /v3.1/ShipmentOrder/create` |
| POST | `/v1/orders/bulk` | Submit up to 50 orders at once | `POST /v3.1/ShipmentOrder/create/bulk` |
| GET | `/v1/orders/:id` | Get order status | `GET /v3.1/ShipmentOrder/{id}` |
| GET | `/v1/orders/:id/tracking` | Get tracking info (accepts gateway / Logiwa / external id) | `GET /v3.1/ShipmentOrder/{id}` |
| GET | `/v1/inventory` | List inventory (tenant-scoped) | `GET /v3.1/Inventory/list` |
| POST | `/v1/inventory/query` | Query inventory by SKUs | `GET /v3.1/Inventory/list` |
| GET | `/v1/purchase-orders` | List purchase orders (tenant-scoped) | `GET /v3.1/PurchaseOrder/list` |
| POST | `/v1/purchase-orders` | Submit purchase order | `POST /v3.1/PurchaseOrder/create` |
| GET | `/v1/purchase-orders/:id` | Get PO details | `GET /v3.1/PurchaseOrder/{id}` |
| GET | `/v1/purchase-orders/:id/receipts` | Get PO line-level receiving history | `GET /v3.2/Report/PurchaseOrderReceivingHistory` |
| GET | `/v1/products` | List products (tenant-scoped) | `GET /v3.1/Product/list` |
| POST | `/v1/products` | Create product / SKU | `POST /v3.1/Product/create` |
| POST | `/v1/webhooks/*` | Inbound webhook receiver (Logiwa → gateway) | — (subscribed via Logiwa topics) |

### Example: Submit an Order

```bash
curl -X POST https://connect.ksp3plhq.com/v1/orders \
  -H "Content-Type: application/json" \
  -H "X-API-Key: cag_your_key_here" \
  -d '{
    "externalOrderId": "ORDER-001",
    "shipTo": {
      "name": "John Doe",
      "address1": "123 Main St",
      "city": "Chicago",
      "state": "IL",
      "zip": "60601",
      "country": "US"
    },
    "items": [
      { "sku": "WIDGET-100", "packType": "Unit", "quantity": 2, "unitPrice": 19.99 }
    ]
  }'
```

### Order Item Fields

| Field | Required | Description |
|-------|----------|-------------|
| `sku` | Yes | Product SKU in Logiwa |
| `quantity` | Yes | Number of units |
| `packType` | No | Pack type (e.g. "Unit", "Case") — if omitted, Logiwa uses product default |
| `unitPrice` | No | Unit price |

### Error Response Format

```json
{
  "error": {
    "message": "Description of what went wrong",
    "code": "ERROR_CODE"
  }
}
```

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `UNAUTHORIZED` | 401 | Invalid or missing API key |
| `BAD_REQUEST` | 400 | Validation failed or malformed request |
| `NOT_FOUND` | 404 | Resource or route not found |
| `METHOD_NOT_ALLOWED` | 405 | Wrong HTTP method for this endpoint |
| `RATE_LIMITED` | 429 | Exceeded per-tenant rate limit |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `LOGIWA_AUTH_FAILED` | 502 | Could not authenticate with Logiwa |
| `LOGIWA_API_ERROR` | 502 | Logiwa API returned an error |

### Rate Limiting

Each API key has a configurable rate limit (default: 60 requests/minute). Rate limit info is returned in response headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
```

## Logiwa Environment Management

Each client has an independent **sandbox/production toggle** in the portal. This controls which Logiwa environment their API requests route to.

- **Sandbox:** `https://myapisandbox.logiwa.com` — for testing
- **Production:** `https://myapi.logiwa.com` — live orders

Each client also has separate Logiwa client identifier mappings for sandbox and production (since GUIDs differ between environments). When you flip a client to production, the gateway automatically uses their production client ID and the production Logiwa credentials.

Clients don't know or care which environment is active — their API key works the same either way.

**Per-key override:** as of migration `0003`, each individual API key also carries an
`environment` column (`sandbox` default). This lets a single tenant hold both a sandbox key and a
production key simultaneously. Key generation is blocked if the tenant has no Logiwa client ID
mapped for the chosen environment.

## Portal Features

- **Dashboard** — active client count, order stats by status, unresolved error count, recent API activity log
- **Clients** — create clients by selecting from live Logiwa client dropdown, per-client sandbox/production toggle, endpoint selection, callback URL config
- **API Keys** — generate keys per client with labels, revoke keys (removes from both D1 and KV)
- **Orders** — filterable by client and status, paginated
- **Errors** — error queue with select-all, bulk retry, bulk resolve

## CI/CD

Deploys are handled by **Cloudflare's built-in Git integration**.

- **API Worker:** Root directory `/api`, deploy command `npx wrangler deploy`
- **Portal:** Root directory `/portal`, build command `npm install && npm run build`, output `dist`
- **Production branch:** `master`

Push to `master` and both deploy automatically.

## What To Work On Next

### Priority 1: Endpoint Enforcement
The `tenant_endpoints` table stores which endpoints each client has enabled, but the Worker router
**still doesn't enforce it** — no 403/endpoint check. Design exists; ⚠️ turning it on changes
behavior for Master Tool Repair's live key, so it needs an explicit go-ahead and a check that
every live tenant's enabled-endpoints rows match what they actually call.

### Priority 2: Enable Queues
Retry queue is coded but commented out in wrangler.toml. Requires Workers Paid plan ($5/mo). Once enabled, failed Logiwa calls auto-retry with backoff.

### Priority 3: SFTP polish
Error-feedback files to the client's `out/` folder on failed order files (currently failures are
visible only in our portal); hide `processed/`/`failed/` archive folders from the client chroot;
R2 lifecycle/retention policy; SFTPGo account auto-provision from the portal's client-create form.

### Priority 4: Schema Cleanup
Remove unused `logiwa_api_url` and `logiwa_credentials` columns from tenants table (creds are now in env vars/KV).

### Done (formerly on this list)
- ~~Revert tracking-sync diagnostics~~ — DIAG probe removed Jul 15 as part of the tracking-sync
  overhaul (env-stamped orders, both-env fallback, real-ship flip gate).
- ~~Cloudflare Access on the portal~~ — live; SFTPGo admin UI is also tunneled behind Access
  at `sftp-admin.ksp3plhq.com`.

## D1 Schema

Tables: `tenants`, `api_keys`, `orders`, `error_log`, `inventory_cache`, `request_log`,
`tenant_endpoints`, `zoho_accounts`, `zoho_sync` (0004), `sftp_clients`, `sftp_files` (0005),
`cron_runs`, `product_packtype_cache` (0006), `aftership_accounts`, `aftership_pushes` (0008/0009),
`shipping_option_mappings` (0010), `retailer_mappings` (0011)

Key columns on `tenants`:
- `logiwa_environment` — `sandbox` or `production` (per-client toggle)
- `logiwa_sandbox_client_id` — Logiwa client GUID for sandbox
- `logiwa_prod_client_id` — Logiwa client GUID for production
- `sftp_username` — links the tenant to its SFTPGo account (SFTP tenants only)

Key columns on `api_keys`:
- `environment` — `sandbox` (default) or `production`, per-key override (migration `0003`).
  ⚠️ Cutting a tenant over to production requires flipping the tenant fields **and** each active
  key's environment in **both** D1 and the KV `apikey:<sha256>` record — the portal toggle alone
  only changes the tenant default.

Key columns on `orders`:
- `environment` — stamped at creation from the resolved key/tenant env (migration `0007`);
  tracking-sync uses this to query the right Logiwa environment.

See `db/migrations/` for full schema.

## Operational gotchas

- **`wrangler kv key ...` defaults to a LOCAL simulator — always pass `--remote`.** Two separate
  multi-day mysteries (util-key 401s, "missing" AfterShip creds) were writes that never reached
  production KV.
- Secrets with special characters: write a JSON/temp file with Node and use `--path` /
  `wrangler secret bulk`; never shell-interpolate (PowerShell also prepends a BOM when piping).
- Logiwa: SKUs must be ≥3 chars; `retailerIdentifier` must be a GUID (422 otherwise); prod
  address verification can reject orders with an *empty-message* 400 (sandbox has no AVS);
  a tracking number existing ≠ shipped — labels print minutes before the ship scan.
