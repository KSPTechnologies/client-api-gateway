# KSP Fulfillment — SFTP File-Drop Integration Guide

Integrate with KSP by dropping JSON files on an SFTP server instead of calling our API.
Same data contract as the API, different transport: you upload order files, we import them
into our warehouse system, and we write shipment-confirmation (ASN) files back once your
orders physically ship.

For the field-by-field JSON schema of orders and purchase orders, see the
**Client Integration Guide** (`client-integration-guide.md`) — the file bodies here are
identical to the API request bodies documented there.

---

## 1. Connection

| | |
|---|---|
| Host | `sftp.ksp3plhq.com` |
| Port | `2022` |
| Protocol | SFTP (SSH File Transfer Protocol) — not FTP/FTPS |
| Auth | Username + password issued by KSP |

Any standard SFTP client works (WinSCP, FileZilla, `sftp` CLI, or a scripted library).
Credentials are per-company; contact KSP to be provisioned or to rotate a password.

## 2. Folder layout

When you log in you land in your own isolated root:

```
/in/         ← you PUT order and purchase-order files here
/out/        ← we PUT shipment-confirmation files here (you GET + delete/archive)
/processed/  ← our archive of your successfully imported files (timestamped)
/failed/     ← our archive of files that failed to import (timestamped)
```

- Only files ending in `.json` in `in/` are picked up. Anything else is ignored.
- We poll `in/` every **2 minutes**. After processing, your file disappears from `in/`
  and reappears under `processed/` or `failed/` with a UTC timestamp prefix
  (e.g. `processed/20260814T153002_orders.json`), so every attempt is preserved.
- `processed/` and `failed/` are ours — treat them as read-only history.

## 3. Order files (`in/`)

One file contains either a **single JSON object** (one order) or a **JSON array** of
order objects. Each order uses the same schema as `POST /v1/orders` in the Client
Integration Guide — the required core is your unique `code` plus `shipmentOrderLineList`.

Minimal example:

```json
{
  "code": "0821476001",
  "channelOrderCode": "0821476001",
  "shipmentOrderLineList": [
    { "sku": "Test1", "quantity": 2, "packType": "Unit" }
  ],
  "shipmentOrderDetail": {
    "firstName": "Jane", "lastName": "Doe",
    "addressLine1": "123 Main St",
    "city": "Minneapolis", "state": "MN", "postalCode": "55401", "country": "US",
    "email": "jane@example.com", "phone": "5555551234"
  }
}
```

Notes:
- `packType` may be omitted — we fill in the product's default pack type automatically.
- Upload atomically: write to a temp name and rename to `*.json`, or upload the `.json`
  file in one operation. (We only read files ending in `.json`, so a `.tmp`-then-rename
  pattern is safe.)
- **Re-drops are safe.** If a file failed and you fix the data, drop it again — same
  filename is fine; it's treated as a retry.
- Field values are imported as-sent (strict). Truncated or malformed data in your export
  will be rejected rather than silently patched.

## 4. Purchase-order files (`in/`)

Drop PO files in the **same `in/` folder** — no separate directory. Routing is by
content: a document containing `purchaseOrderLineList` is imported as a purchase order;
one containing `shipmentOrderLineList` is imported as an outbound order. Schema per the
Client Integration Guide's purchase-orders section.

## 5. Shipment confirmations (`out/`)

When an order **actually ships** (physical ship scan at the warehouse — not merely when
a label is printed), we write one confirmation file to your `out/`:

```
out/<orderCode>-confirmation.json
```

Confirmations normally land within ~15 minutes of the ship scan. A confirmation is only
written once complete package data is available — you will never receive one with an
empty `shipments` list.

Example:

```json
{
  "confirmationType": "shipment",
  "orderCode": "0821476001",
  "gatewayOrderId": "9c1f6f2e-....",
  "generatedAt": "2026-08-14T15:32:10.123Z",
  "orderId": "9c1f6f2e-....",
  "status": "fulfilled",
  "tracking": {
    "logiwaStatus": "Shipped",
    "shipmentDate": "2026-08-14T15:17:00",
    "trackingNumbers": ["1Z999AA10123456784"],
    "carrier": "UPS",
    "shippingCost": 8.42
  },
  "carrier": "UPS",
  "trackingNumber": "1Z999AA10123456784",
  "estimatedDelivery": null,
  "shipments": [
    {
      "trackingNumber": "1Z999AA10123456784",
      "carrier": "UPS",
      "shippingService": "UPS Ground",
      "packageType": "Box",
      "packageWeight": 3.2,
      "packageWeightUnit": "lb",
      "shipmentDate": "2026-08-14T15:17:00",
      "items": [
        { "sku": "Test1", "quantity": 2, "lotBatchNumber": null, "expiryDate": null }
      ]
    }
  ]
}
```

Reading it:
- **`shipments[]` is one entry per physical package/carton.** A multi-parcel order has
  multiple entries, each with its own tracking number and its own `items[]` showing which
  SKUs/quantities are in that carton. Carton count = `shipments.length`.
- Top-level `trackingNumber`/`carrier` are convenience fields (first package); use
  `shipments[]` as the source of truth.
- Match on `orderCode` (your `code`) — don't parse the filename.
- Files stay in `out/` until you remove them; download-and-delete (or move to your own
  archive) after import.

## 6. Errors

If a file fails to import it moves to `failed/` with the timestamped name. KSP monitors
failures on our internal portal and will reach out with the error details; fix the data
and re-drop the file in `in/` under the same name. (Automated error-feedback files to
your `out/` folder are on the roadmap.)

## 7. Support

Questions, credentials, or new SKU/retailer setup: contact KSP Fulfillment —
mike.geiger@ksp3pl.com.
