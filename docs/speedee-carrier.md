# SpeeDee (ShipIt) Custom Carrier Adapter

Logiwa Custom Carrier → gateway → Spee-Dee ShipIt API. Logiwa calls the gateway's
`/carriers/speedee/*` endpoints; the gateway translates to ShipIt calls (HTTP Basic
auth, per-environment credentials) and answers in Logiwa's custom-carrier format.
All additive: own route branch (before tenant auth, like the Zoho webhook), own
auth system, own tables (migration 0015).

## 1. Logiwa "Create Shipping Integration" → Connection values

Same values for the Production=Yes and Production=No setups — environment routing
is driven by the per-request `testLabel` flag (absent → **test**, so a label can
never hit production by accident).

| Logiwa field | Value |
|---|---|
| API Key | `spd_6b28597346a2c0ebbf0ba028b19eee34` |
| API Secret | issued once at creation — ask Mike/Claude (hash-only storage) |
| Token URL | `https://connect.ksp3plhq.com/carriers/speedee/token` |
| Get Rate URL | `https://connect.ksp3plhq.com/carriers/speedee/rate` |
| Create Label URL | `https://connect.ksp3plhq.com/carriers/speedee/create` |
| Void Label URL | `https://connect.ksp3plhq.com/carriers/speedee/void` |
| End of Day Report URL | `https://connect.ksp3plhq.com/carriers/speedee/eod` |

Generate a new key/secret pair (Git Bash, from `api/`):

```bash
node -e "const c=require('crypto');const k='spd_'+c.randomBytes(16).toString('hex');const s='spds_'+c.randomBytes(32).toString('hex');console.log(k,s,c.createHash('sha256').update(s).digest('hex'))"
# INSERT INTO carrier_api_clients (id, carrier, api_key, secret_hash, label, active)
#   VALUES (<uuid>, 'speedee', <key>, <hash>, '<label>', 1);   -- via wrangler d1 execute --remote
```

## 2. Secrets & config (KV — remember `--remote`)

| KV key | Content |
|---|---|
| `speedee:env:test` | `{"baseUrl":"<ShipIt test URL>","username":"...","password":"..."}` |
| `speedee:env:production` | `{"baseUrl":"<ShipIt prod URL>","username":"...","password":"..."}` |
| `speedee:config` | optional JSON overriding `DEFAULT_SPEEDEE_CONFIG` (lib/speedee-map.ts) |

SpeeDee credentials never pass through Logiwa and are never logged. **Until the
env entries are populated, every call fails cleanly with "credentials not
configured."** Write them with a node-written file + `--path` (special chars).

Config covers: service/vehicle map, parcel-type map, confirmation→fee map, cost
bucketing charge ids, DECLAREDVALUE units, tracking URL template, reference max
length, poll budget/backoff, `eodMode` (`portal` default | `summary`),
`mockMode`, `useReturnEndpoint`, and **all unconfirmed ShipIt paths** — fixable
live without a deploy.

## 3. Mappings as implemented

- **Service/vehicle** (config `serviceMap`): default + `GROUND` → `PACKAGE_PARCEL`/`STEPVAN`;
  `LTL` → `LTL_NEXTDAYPU`/`SEMITRAILER_53TANDEMAXELTRACTOR`.
- **Parcel type** (config `parcelTypeMap`): default `BOX`; any hazmat product →
  `ANY_SIZE_BOX_HZ` + `userFields HAZMAT=TRUE` + `HAZMAT` extra fee.
- **Confirmation** (config `confirmationMap`): ADULT→`AODSIGNATURE`, SIGNATURE/DIRECT→`AOD`,
  INDIRECT→`AODINDIRECT`, NONE/absent→none. Strongest wins across mixed packages (logged).
- **References:** `reference1`→`referenceNumber1` (fallback shipmentOrderCode);
  `reference2`→`referenceNumber3` (fallbacks reference3, retailerPoNumber).
  **`referenceNumber2` is never sent** (SpeeDee internal) — unit-tested.
  Truncation at 30 chars (confirm limit) with warning.
- **Units:** KG/OZ→LB (2dp, min 0.01), CM→IN. Order weight = sum of packages.
- **Dates:** `plannedPickUpDate` → `expectedShipmentDate` → now ⇒ `readyAt` (ISO).
- **Rate buckets:** shippingCost = DELIVERY+ITEMPRICE+SHIPMENTWEIGHT charges;
  otherCost = everything else; configurable.
- **DECLAREDVALUE:** `insuranceOptions.Value > 0` ⇒ fee with quantity = dollar value
  (config `declaredValueUnits: 'dollars' | 'per100'` — confirm with SpeeDee).
- **US only:** non-US ship-to/from rejected per item with a clear message.
- **Validation:** any non-empty `validationErrors` (HTTP 200 included) = item failure;
  on create, a part-created order is cancelled.
- **Create flow:** idempotent by `shipmentOrderIdentifier` (stored response replayed);
  ZPL-only check; poll items until no temporary tracking numbers (`01`, `02`, …;
  backoff 300/500/1000ms, 11s budget inside Logiwa's ~15s) — on budget exhaustion the
  SpeeDee order is cancelled and the item fails with "retry"; labels via Download
  Labels JSON (STANDARD), stored in R2 `speedee/<env>/<orderId>/label-<n>.zpl`;
  pricing from Get-an-order charges with quote fallback.
- **Void:** resolves orderId via externalReference → DB (identifier, tracking) →
  search; single-package void deletes that item when others remain; already-voided
  = idempotent success; carrier refusal (picked up) = failure with SpeeDee's message.
- **EOD:** `eodMode=portal` (default) returns success + "print manifest from ShipIt
  portal (Orders → Reports)". `eodMode=summary` returns a gateway-generated PDF
  summary sheet (base64; order/package counts, per-package rows, driver+shipper
  signature lines) — enable only after SpeeDee Integrations approves it.
- **Webhook:** `/carriers/speedee/webhook` accepts callbacks, marks voids in our DB,
  logs the rest. (Logiwa tracks its own custom-carrier shipments — nothing forwarded.)
- **Mock mode** (config `mockMode`): `FAIL` / `400` / `TIMEOUT15` in shipmentOrderCode
  mirror Logiwa's test triggers without touching SpeeDee.

## 4. Open questions / assumptions

**CONFIRMED (2026-10-16) against the published ShipIt Postman collection** (saved at
`docs/shipit-postman-collection.json`; docs site = https://api.speedeeshipit.com — a
Postman Documenter page, NOT the API host):
- Cancel = `DELETE /api/v1/orders/{orderId}`; delete items = `DELETE .../items`
  with a **bare JSON array of itemId GUIDs**; labels JSON =
  `GET .../items/label/{templateId}/{format}` (example values `Standard`/`0`).
- Items response = top-level array `[{itemId, itemNumber, barcode, ...}]` —
  **`barcode` is the tracking number**; create response = `{"orderId":"SD3041"}`;
  labels response = `{labels:[{itemId, itemBarcode, encodedLabel}]}` (base64 ZPL,
  matched to packages by barcode); charges = `{type:"Delivery", price, toZone}` +
  `{type:"Extra", price, quantity, extraFeeTypeId}`; quote includes
  `dropoffWindow{start,end}`; subscriptions/webhooks API exists
  (`/api/v1/subscriptions`) as an alternative to per-order `webhookUrl`.

**RESOLVED (2026-10-16, live integration tests all passed):**
- **Test base URL: `https://speedeetest.dsapp.io/integration`** (ShipIt is
  white-label **Dispatch Science**; the `/integration` prefix is required —
  bare `/api/v1/...` 404s). Stored in KV `speedee:env:test`.
- **Tom's login IS the API Basic auth** (account 90088P / id 18567, role
  SelfServeAdministrator) — TEST environment. ⚠️ When Tom changes his portal
  password at speedeetest.dsapp.io, the API credential changes with it →
  **update KV `speedee:env:test` immediately or the adapter breaks.**
- **Format `0` = ZPL confirmed** (downloaded real ZPL labels).
- **Live-verified through the gateway:** rate ($8.40 quote, bucketing correct),
  create → SD442194 w/ real tracking + 7.6KB ZPL label, idempotent replay,
  void + idempotent re-void, 3-package create (sequential trackings),
  hazmat ($32.87 accessorials priced), AOD ADULT ($15.71 fee), EOD portal
  mode. All test orders voided after.

**Still open:**
1. **Production base URL + credentials** — ask SpeeDee Integrations at prod
   onboarding (likely a separate dsapp.io tenant).
2. **Logiwa token request format** — endpoint accepts HTTP Basic, form-urlencoded,
   and JSON; logs `shape=` on each call. Watch the first real Logiwa call and prune.
3. **DECLAREDVALUE quantity semantics** (dollars vs $100 units) — config switch.
4. **Logiwa confirmation enum values** — config map; verify against real payloads.
5. **Return labels** — default: normal order with Logiwa's already-reversed
   addresses. `useReturnEndpoint: true` switches to `POST /orders/return` when the
   original SpeeDee order is known.
6. **EOD approval** — summary sheet built but off until SpeeDee approves.
7. **Reference max length** (assumed 30).

## 5. Not supported (by SpeeDee or by design)

- PDF labels (ZPL 4×6 STANDARD only — non-ZPL requests fail per item)
- Saturday delivery (ignored, logged)
- International / non-US addresses (rejected)
- A manifest API (hence EOD portal/summary modes)
- COD mapping (no Logiwa source field identified — add to config when needed)

## 6. Go-live checklist

1. SpeeDee test credentials + base URL → KV `speedee:env:test` ✅ gateway errors cleanly until then
2. Postman collection → confirm paths (§4.2), fix via `speedee:config` if needed
3. Integration tests vs ShipIt test env: quote, create (single + multi-package,
   hazmat, adult-signature), poll→label, void, EOD
4. Logiwa sandbox: create the Shipping Integration with §1 values, run their test flow
5. SpeeDee production credentials → KV `speedee:env:production`
6. Logiwa production integration (Production=Yes); confirm `testLabel:false` arrives
7. Decide EOD mode with SpeeDee Integrations
