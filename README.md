# Client API Gateway

Multi-tenant API gateway that sits between external clients and our Logiwa IO WMS. Clients hit our API with their own keys — they never touch Logiwa credentials.

**Live Worker:** `https://client-api-gateway.mike-geiger.workers.dev`

## Architecture

```
Client → Cloudflare Worker (auth, validate, route) → Logiwa IO API
              ↕
         D1 (database)
         KV (API key lookups)
         R2 (payload storage)
         Queues (retries — pending enablement)

Portal (Cloudflare Pages) → D1 → view/manage everything
```

Everything is multi-tenant. Each client (business unit) gets their own tenant config, API keys, and isolated data. Same codebase serves all of them.

## Project Structure

```
├── api/                          ← Cloudflare Worker (the client-facing API)
│   ├── src/
│   │   ├── index.ts              ← Entry point: fetch, scheduled, queue handlers
│   │   ├── auth.ts               ← API key validation (SHA-256 hash → KV lookup)
│   │   ├── routes/
│   │   │   ├── router.ts         ← Request routing + auth gate + logging
│   │   │   ├── orders.ts         ← POST /v1/orders, GET /v1/orders/:id (stubs)
│   │   │   ├── tracking.ts       ← GET /v1/orders/:id/tracking (stub)
│   │   │   └── inventory.ts      ← POST /v1/inventory/query (stub)
│   │   └── lib/
│   │       ├── logiwa.ts         ← Logiwa IO API client (placeholder)
│   │       ├── logger.ts         ← Request + error logging to D1
│   │       ├── scheduled.ts      ← Cron trigger handlers (placeholder)
│   │       └── queue.ts          ← Retry queue consumer (placeholder)
│   ├── wrangler.toml             ← Cloudflare bindings (D1, KV, R2)
│   ├── package.json
│   └── tsconfig.json
├── portal/                       ← Cloudflare Pages control portal (not started)
├── db/
│   └── migrations/
│       └── 0001_init.sql         ← Schema: tenants, api_keys, orders, error_log, inventory_cache, request_log
├── docs/
│   ├── api-spec.md               ← Client-facing API documentation (skeleton)
│   └── logiwa-api-spec.txt       ← Logiwa IO v3.1 OpenAPI spec (full reference for Phase 3)
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
- **Phase 1 (Seed Tooling):** NOT STARTED — need admin scripts to create tenants + API keys
- **Phase 2 (Auth & Routing):** NOT STARTED — rate limiting, input validation (zod), error standardization
- **Phase 3 (Logiwa Integration):** NOT STARTED — waiting on Logiwa IO API spec
- **Phase 4 (Async Work):** NOT STARTED — queues, retries, cron jobs for tracking/inventory sync
- **Phase 5 (Control Portal):** NOT STARTED — Pages app for viewing orders, errors, managing tenants
- **Phase 6 (Harden & Ship):** NOT STARTED — encryption at rest, custom domains, alerting

## Getting Started (New Developer)

### Prerequisites
- Node.js 20+
- Wrangler CLI (`npm install -g wrangler`)
- GitHub CLI (`gh`)
- Access to the KSPTechnologies GitHub org
- Access to the Cloudflare account (mike.geiger@ksp3pl.com's account)

### Setup

```bash
# Clone the repo
gh repo clone KSPTechnologies/client-api-gateway
cd client-api-gateway/api

# Install dependencies
npm install

# Auth with Cloudflare
wrangler login

# Run locally
wrangler dev

# Deploy (or just push to master — CI/CD handles it)
wrangler deploy
```

### Running D1 Migrations

```bash
# Remote (production)
wrangler d1 execute client-api-gateway --remote --file=../db/migrations/0001_init.sql

# Local dev
wrangler d1 execute client-api-gateway --local --file=../db/migrations/0001_init.sql
```

### Testing the API

```bash
# Health check (no auth)
curl https://client-api-gateway.mike-geiger.workers.dev/v1/health

# Authenticated request (once you have a tenant + key seeded)
curl -H "X-API-Key: your-key" https://client-api-gateway.mike-geiger.workers.dev/v1/orders
```

## CI/CD

Deploys are handled by **Cloudflare's built-in Git integration** (not GitHub Actions).

- Connected via: Workers & Pages → client-api-gateway → Settings → Builds
- **Root directory:** `/api`
- **Deploy command:** `npx wrangler deploy`
- **Production branch:** `master`
- Non-production branch builds: enabled

Push to `master` and Cloudflare builds and deploys automatically. You can see build logs in the Cloudflare dashboard.

## What To Work On Next

### Priority 1: Admin / Seed Tooling
There's currently no way to create tenants or API keys without raw SQL. Build:
- A script or CLI that creates a tenant in D1 (name, Logiwa creds, callback URL)
- A script that generates an API key for a tenant, hashes it, stores in both D1 and KV
- A script to revoke/list keys

This unblocks all testing of the auth and route logic.

### Priority 2: Input Validation
Add `zod` for request body validation on POST endpoints. Reject bad data before it gets anywhere near Logiwa.

### Priority 3: Logiwa Client
The Logiwa IO API spec is at `docs/logiwa-api-spec.txt` (v3.1 OpenAPI, covers auth, webhooks, shipment orders, products, inventory, purchase orders). Build out `api/src/lib/logiwa.ts` with real API calls and wire the route stubs to use it. Key endpoints: auth token flow, shipment order create/status, inventory queries, webhook subscriptions for tracking push-back.

### Priority 4: Portal
Scaffold a Cloudflare Pages app in `portal/`. Gate it with Cloudflare Access (SSO). Start with the error queue view — that's the highest operational value.

## API Endpoints

| Method | Path | Auth | Status |
|--------|------|------|--------|
| GET | `/v1/health` | No | Working |
| POST | `/v1/orders` | Yes | Stub |
| GET | `/v1/orders/:id` | Yes | Stub |
| GET | `/v1/orders/:id/tracking` | Yes | Stub |
| POST | `/v1/inventory/query` | Yes | Stub |

## D1 Schema

Tables: `tenants`, `api_keys`, `orders`, `error_log`, `inventory_cache`, `request_log`

See `db/migrations/0001_init.sql` for full schema.
