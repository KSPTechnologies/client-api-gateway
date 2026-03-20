# Client API Gateway

Multi-tenant API gateway that sits between external clients and our Logiwa IO WMS. Clients hit our API with their own keys — they never touch Logiwa credentials.

**API (client-facing):** `https://connect.ksp3plhq.com`
**Portal (internal):** `https://connect-portal.ksp3plhq.com`

## Architecture

```
Client → Cloudflare Worker (auth, validate, route) → Logiwa IO API
              ↕
         D1 (database)
         KV (API key lookups + rate limiting)
         R2 (payload storage)
         Queues (retries — pending enablement)

Portal (Cloudflare Pages) → D1 → create clients, manage keys, view orders/errors
```

Everything is multi-tenant. Each client (business unit) gets their own tenant config, API keys, and isolated data. Same codebase serves all of them.

## Project Structure

```
├── api/                          ← Cloudflare Worker (the client-facing API)
│   ├── src/
│   │   ├── index.ts              ← Entry point: fetch, scheduled, queue handlers
│   │   ├── auth.ts               ← API key validation (SHA-256 hash → KV lookup)
│   │   ├── routes/
│   │   │   ├── router.ts         ← Request routing, auth gate, rate limiting, CORS, logging
│   │   │   ├── orders.ts         ← POST /v1/orders, GET /v1/orders/:id
│   │   │   ├── tracking.ts       ← GET /v1/orders/:id/tracking
│   │   │   └── inventory.ts      ← POST /v1/inventory/query
│   │   └── lib/
│   │       ├── logiwa.ts         ← Logiwa IO API client (auth, orders, inventory, webhooks)
│   │       ├── validate.ts       ← Zod schemas for request body validation
│   │       ├── errors.ts         ← Standardized API error responses
│   │       ├── rate-limit.ts     ← Per-tenant sliding-window rate limiter via KV
│   │       ├── logger.ts         ← Request + error logging to D1
│   │       ├── scheduled.ts      ← Cron: tracking sync (15min), inventory refresh (hourly)
│   │       └── queue.ts          ← Retry queue consumer for failed Logiwa calls
│   ├── scripts/
│   │   └── admin.ts              ← CLI for tenant/key management (create, list, revoke)
│   ├── wrangler.toml             ← Cloudflare bindings (D1, KV, R2)
│   ├── package.json
│   └── tsconfig.json
├── portal/                       ← Cloudflare Pages control portal (not started)
├── db/
│   └── migrations/
│       └── 0001_init.sql         ← Schema: tenants, api_keys, orders, error_log, inventory_cache, request_log
├── docs/
│   ├── api-spec.md               ← Client-facing API documentation
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

## Current State

- **Phase 0 (Scaffolding):** DONE — repo, Worker, D1 schema, CI/CD
- **Phase 1 (Seed Tooling):** DONE — CLI to create tenants, generate/revoke/list API keys
- **Phase 2 (Auth & Routing):** DONE — rate limiting (KV), zod validation, standardized errors, CORS
- **Phase 3 (Logiwa Integration):** DONE — full API client (auth tokens, orders, inventory, webhooks), routes wired to Logiwa
- **Phase 4 (Async Work):** DONE — cron tracking sync, inventory cache refresh, retry queue consumer
- **Phase 5 (Control Portal):** NOT STARTED — Pages app for managing clients, keys, viewing orders/errors
- **Phase 6 (Harden & Ship):** NOT STARTED — encryption at rest, custom domains, alerting

## Getting Started

### Prerequisites
- Node.js 20+
- Wrangler CLI (`npm install -g wrangler`)
- GitHub CLI (`gh`)
- Access to the KSPTechnologies GitHub org
- Access to the Cloudflare account (mike.geiger@ksp3pl.com's account)

### Setup

```bash
gh repo clone KSPTechnologies/client-api-gateway
cd client-api-gateway/api
npm install
wrangler login
```

### Admin CLI

All tenant and key management is done via the admin CLI at `api/scripts/admin.ts`:

```bash
# Create a tenant
npm run admin -- create-tenant --name "Acme Corp" --logiwa-url "https://myapi.logiwa.com" --logiwa-user "user@acme.com" --logiwa-pass "secret"

# Generate an API key for a tenant
npm run admin -- generate-key --tenant-id <id> --label "production"

# List all tenants
npm run admin -- list-tenants

# List keys for a tenant
npm run admin -- list-keys --tenant-id <id>

# Revoke an API key
npm run admin -- revoke-key --key-id <id>
```

### D1 Migrations

```bash
npm run db:migrate:remote
```

### Deploy

Push to `master` and Cloudflare builds and deploys automatically. Or deploy manually:

```bash
npm run deploy
```

## API Endpoints

| Method | Path | Auth | Status |
|--------|------|------|--------|
| GET | `/v1/health` | No | Working |
| POST | `/v1/orders` | Yes | Working — validates with zod, stores in D1/R2, forwards to Logiwa |
| GET | `/v1/orders/:id` | Yes | Working — returns order from D1 |
| GET | `/v1/orders/:id/tracking` | Yes | Working — fetches live tracking from Logiwa |
| POST | `/v1/inventory/query` | Yes | Working — checks D1 cache, falls back to live Logiwa query |

### Error Response Format

All errors return a consistent structure:

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

## CI/CD

Deploys are handled by **Cloudflare's built-in Git integration** (not GitHub Actions).

- Connected via: Workers & Pages → client-api-gateway → Settings → Builds
- **Root directory:** `/api`
- **Deploy command:** `npx wrangler deploy`
- **Production branch:** `master`
- Non-production branch builds: enabled

Push to `master` and Cloudflare builds and deploys automatically.

## What To Work On Next

### Priority 1: Control Portal (Phase 5)

Build a Cloudflare Pages app in `portal/` that provides a web UI for managing the gateway. Gate it with Cloudflare Access (SSO).

#### Client Creation Flow

The portal's main workflow is creating and configuring clients:

1. **Create Client form** — Admin fills in:
   - **Client Name** (e.g. "Acme Corp")
   - **Base URL** for the client's endpoints (e.g. `acme.com`)
   - **Logiwa credentials** (API URL, username, password, client identifier)
   - **Callback URL** (optional — for tracking push notifications)

2. **Select endpoint functions** — Checkboxes for which capabilities the client needs:
   - [ ] Create Order (`POST /v1/orders`)
   - [ ] Get Order Status (`GET /v1/orders/:id`)
   - [ ] Get Tracking (`GET /v1/orders/:id/tracking`)
   - [ ] Query Inventory (`POST /v1/inventory/query`)
   - [ ] Create Purchase Order (future)
   - [ ] Webhook Subscriptions (future)

3. **System auto-generates endpoints** — Based on selections, the portal displays the client's specific endpoints:
   - Example: Client "Test" with base URL `test.com`, selected "Create Order" and "Create PO"
   - System shows: `test.com/create-order`, `test.com/create-po`
   - These map to the gateway's internal routes which proxy to Logiwa

4. **Generate API Key** — Separate section where you:
   - Select a client from dropdown
   - Add a label (e.g. "production", "staging")
   - Click generate — system creates the key, hashes it, stores in D1 + KV
   - Displays the raw key once (cannot be retrieved later)

The portal's backend calls the same functions already built and tested in the admin CLI (`create-tenant`, `generate-key`, etc.) — it's a UI wrapper around the existing tooling.

#### Additional Portal Views
- **Client list** — View all tenants, their status, active key count
- **API key management** — List/revoke keys per client
- **Order log** — View orders by client, status, date range
- **Error queue** — View unresolved errors, retry failed requests
- **Request log** — Recent API activity per client

### Priority 2: Schema Update for Endpoint Configuration

Add a `tenant_endpoints` table to D1 to store which endpoints each client has enabled:

```sql
CREATE TABLE IF NOT EXISTS tenant_endpoints (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  endpoint_type TEXT NOT NULL,  -- 'create_order', 'get_order', 'tracking', 'inventory', etc.
  enabled INTEGER NOT NULL DEFAULT 1,
  custom_path TEXT,             -- optional custom path override
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, endpoint_type)
);
```

Update the router to check `tenant_endpoints` before allowing a request through — if a client doesn't have "create_order" enabled, `POST /v1/orders` returns 403.

### Priority 3: Harden & Ship (Phase 6)
- Encrypt Logiwa credentials at rest in D1
- Custom domain setup (e.g. `api.ksp3pl.com`)
- Alerting on error rate spikes
- Enable Queues for retry (requires Workers Paid plan)

## D1 Schema

Tables: `tenants`, `api_keys`, `orders`, `error_log`, `inventory_cache`, `request_log`

See `db/migrations/0001_init.sql` for full schema.
