# KSP 3PL — API Integration Guide

## Overview

KSP provides a secure API gateway for submitting and tracking orders, querying inventory, and managing purchase orders within our WMS (Warehouse Management System).

All API access goes through our gateway at `https://connect.ksp3plhq.com`. You will be provided with an API key for authentication. You do **not** need WMS credentials, client identifiers, or warehouse identifiers — the gateway handles all of that on your behalf.

## Authentication

Every request requires your API key in the `X-API-Key` header:

```
X-API-Key: your-api-key-here
Content-Type: application/json
```

Your API key will be provided during onboarding. Keep it secure — it grants full access to your account's endpoints.

## Base URL

```
https://connect.ksp3plhq.com
```

## Rate Limits

Each API key has a configurable rate limit (default: 60 requests/minute). Rate limit status is returned in response headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
```

If you exceed the limit, you'll receive a `429 Too Many Requests` response. Wait and retry.

---

## Available Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/orders` | Submit a single order |
| POST | `/v1/orders/bulk` | Submit up to 50 orders at once |
| GET | `/v1/orders/{orderId}` | Get order status |
| GET | `/v1/orders/{orderId}/tracking` | Get tracking information |
| POST | `/v1/inventory/query` | Query inventory by SKU(s) |
| POST | `/v1/purchase-orders` | Submit a purchase order |
| GET | `/v1/purchase-orders/{id}` | Get purchase order details |
| GET | `/v1/purchase-orders/{code}/receipts` | Get PO receiving history |
| GET | `/v1/health` | Health check (no auth required) |

---

## 1. Submit a Single Order

```
POST /v1/orders
```

Submit a shipment order. The gateway automatically assigns the correct client, warehouse, and order type — you just provide the order details.

### Example Payload

```json
{
  "code": "77671",
  "customer": {
    "firstName": "Jane",
    "lastName": "Doe",
    "email": "jane@example.com"
  },
  "companyName": "Acme Corp",
  "shipmentAddress": {
    "country": "US",
    "state": "New Mexico",
    "addressLine1": "4 Sherry Lane",
    "addressLine2": "",
    "city": "Peralta",
    "postalCode": "87042",
    "phoneNumber": "505-555-0100"
  },
  "useSameAddress": true,
  "clientReferenceCode": "PO-8834",
  "note": "Deliver to loading dock B",
  "shipmentOrderLineList": [
    {
      "sku": "9415995",
      "packType": "Unit",
      "packQuantity": 1,
      "unitPrice": 29.99
    },
    {
      "sku": "D802N",
      "packType": "Unit",
      "packQuantity": 1,
      "unitPrice": 45.00
    },
    {
      "sku": "9415994",
      "packType": "Unit",
      "packQuantity": 2,
      "unitPrice": 12.50
    }
  ]
}
```

### Required Fields

| Field | Description |
|-------|-------------|
| `code` | Your unique order number (must be unique per order) |
| `shipmentOrderLineList` | Array of line items with `sku` and `packQuantity` |

### Optional Fields

| Field | Description |
|-------|-------------|
| `customer` | Customer name and email |
| `companyName` | Company name for the order |
| `shipmentAddress` | Shipping address (country, state, addressLine1, city, postalCode) |
| `billingAddress` | Billing address (same structure as shipmentAddress plus firstName, lastName, email, companyName) |
| `useSameAddress` | Use shipping address as billing (default: `true`) |
| `shipmentOrderDate` | Order date in ISO format (default: today) |
| `expectedShipmentDate` | Requested ship date |
| `expectedDeliveryDate` | Requested delivery date |
| `clientReferenceCode` | Your internal reference/PO number |
| `note` | Order notes |
| `extraNote1` through `extraNote5` | Additional note fields |
| `giftNote` | Gift message |
| `gift` | Boolean — is this a gift order? |
| `isSkipAddressVerification` | Skip address validation (default: `false`) |
| `priority` | Order priority (integer) |
| `packingInstructions` | Special packing instructions |
| `channelOrderNumber` | Your channel/marketplace order number |
| `shippingOptionDetails` | Carrier and shipping method (see below) |
| `tags` | Array of tag identifiers |
| `isPrimeOrder` | Boolean for priority/Prime orders |

### Line Item Fields

| Field | Required | Description |
|-------|----------|-------------|
| `sku` | Yes | Product SKU (must exist in the system) |
| `packQuantity` | Yes | Quantity to ship |
| `packType` | No | Pack type (e.g. "Unit", "Case"). If omitted, uses the product's default |
| `unitPrice` | No | Unit price |
| `unitTax` | No | Tax per unit |
| `unitDiscount` | No | Discount per unit |
| `taxIncluded` | No | Whether unitPrice includes tax |
| `lotBatchNumber` | No | Lot/batch number |
| `lineNotes1` through `lineNotes3` | No | Line item notes |

### Specifying Carrier and Shipping Method

To request a specific carrier and shipping method, include `shippingOptionDetails`:

```json
{
  "shippingOptionDetails": {
    "shippingOptionName": "Ground",
    "carrierName": "UPS",
    "carrierSetupName": "UPS Standard",
    "isSetUnmatchedShippingOptionAsRequested": true
  }
}
```

Setting `isSetUnmatchedShippingOptionAsRequested` to `true` means if the exact carrier/method isn't configured in our system, it will be recorded as the requested method and our team will handle routing.

**Note:** Available carriers and shipping methods depend on your account configuration. Contact your KSP account representative for a list of carriers and methods available for your account.

### Example Response

```json
{
  "orderId": "e30faaa3-c510-4df7-9506-996a40be2bd9",
  "code": "77671",
  "logiwaOrderId": "d53e3316-3788-4f8b-93c8-97901f579da2",
  "status": "sent",
  "message": "Order created and sent to Logiwa"
}
```

### Fields You Do NOT Need to Send

The gateway automatically handles these — do not include them in your payload:

| Field | Why |
|-------|-----|
| `clientIdentifier` | Assigned by the gateway based on your API key |
| `warehouseIdentifier` | Assigned by the gateway |
| `shipmentOrderType` | Defaults to "Shipment Order" |
| `channelName` | Set automatically to identify orders from the API |

### Important Notes

- **Order codes must be unique.** Submitting a duplicate code will return an error.
- **SKUs must exist in the system.** Contact KSP to have products set up before sending orders.
- **Only include fields you have data for.** Do not send fields with empty strings or placeholder values — omit them entirely.

---

## 2. Submit Bulk Orders

```
POST /v1/orders/bulk
```

Submit up to 50 orders in a single request. Same payload structure as single orders, wrapped in an array. Bulk orders are processed asynchronously.

### Example Payload

```json
[
  {
    "code": "ORD-001",
    "customer": { "firstName": "John", "lastName": "Doe" },
    "shipmentAddress": {
      "country": "US",
      "state": "IL",
      "addressLine1": "123 Main St",
      "city": "Chicago",
      "postalCode": "60601"
    },
    "shipmentOrderLineList": [
      { "sku": "9415995", "packType": "Unit", "packQuantity": 2 }
    ]
  },
  {
    "code": "ORD-002",
    "customer": { "firstName": "Jane", "lastName": "Smith" },
    "shipmentAddress": {
      "country": "US",
      "state": "TX",
      "addressLine1": "456 Oak Ave",
      "city": "Dallas",
      "postalCode": "75201"
    },
    "shipmentOrderLineList": [
      { "sku": "D802N", "packType": "Unit", "packQuantity": 1 }
    ]
  }
]
```

### Example Response

```json
{
  "bulkId": "b53e6d25-5eae-4304-b754-bfe81419904f",
  "count": 2,
  "results": {
    "requestId": "dc3882a9-28c9-475a-a51d-c372696e2709"
  },
  "message": "Bulk order submission complete"
}
```

Bulk orders are processed asynchronously. The `requestId` confirms acceptance. Individual order results will be available via the order status endpoint.

### Limits

- Maximum **50 orders** per bulk request
- Rate limited: 1 bulk request every 2-6 seconds depending on tier

---

## 3. Get Order Status

```
GET /v1/orders/{orderId}
```

Retrieve the current status of an order using the `orderId` returned when the order was submitted.

### Example Response

```json
{
  "orderId": "e30faaa3-c510-4df7-9506-996a40be2bd9",
  "code": "77671",
  "logiwaOrderId": "d53e3316-3788-4f8b-93c8-97901f579da2",
  "status": "sent",
  "createdAt": "2026-03-20 18:06:05",
  "updatedAt": "2026-03-20 18:06:05"
}
```

### Order Statuses

| Status | Meaning |
|--------|---------|
| `received` | Order received by gateway, pending submission |
| `sent` | Successfully submitted to the warehouse |
| `fulfilled` | Order has been shipped |
| `closed` | Order completed or cancelled |
| `error` | Submission failed (see error message for details) |

---

## 4. Get Tracking Information

```
GET /v1/orders/{orderId}/tracking
```

Retrieve tracking details for a shipped order.

### Example Response

```json
{
  "orderId": "e30faaa3-c510-4df7-9506-996a40be2bd9",
  "status": "fulfilled",
  "tracking": {
    "logiwaStatus": "Shipped",
    "shipmentDate": "2026-03-22T14:30:00Z",
    "trackingNumbers": ["1Z999AA10123456784"],
    "carrier": "UPS",
    "shippingCost": 12.50
  },
  "carrier": "UPS",
  "trackingNumber": "1Z999AA10123456784",
  "estimatedDelivery": "2026-03-25T00:00:00Z"
}
```

Tracking information is updated periodically. If the order hasn't shipped yet, `tracking` will be `null`.

---

## 5. Query Inventory

```
POST /v1/inventory/query
```

Check available inventory for one or more SKUs.

### Example Payload

```json
{
  "skus": ["9415995", "D802N", "9415994"]
}
```

### Example Response

```json
{
  "items": [
    { "sku": "9415995", "quantity": 150, "lastSyncedAt": "2026-03-20T18:00:00Z" },
    { "sku": "D802N", "quantity": 42, "lastSyncedAt": "2026-03-20T18:00:00Z" },
    { "sku": "9415994", "quantity": null, "lastSyncedAt": null }
  ]
}
```

A `null` quantity means the SKU was not found in inventory. Query up to 100 SKUs per request.

---

## 6. Submit a Purchase Order

```
POST /v1/purchase-orders
```

Submit an inbound purchase order (ASN) to notify the warehouse of incoming inventory.

### Example Payload

```json
{
  "code": "93024-HI",
  "vendor": "Hitachi",
  "purchaseOrderDate": "2026-03-20",
  "plannedReceivingDate": "2026-03-25",
  "referenceNumber": "VENDOR-REF-123",
  "purchaseOrderLineList": [
    { "sku": "881469", "packQuantity": 1 },
    { "sku": "890354", "packQuantity": 1 },
    { "sku": "888940", "packQuantity": 1 },
    { "sku": "888932", "packQuantity": 1 },
    { "sku": "889297", "packQuantity": 1 },
    { "sku": "890349", "packQuantity": 1 },
    { "sku": "890348", "packQuantity": 1 }
  ]
}
```

### Required Fields

| Field | Description |
|-------|-------------|
| `code` | Your unique PO number |
| `purchaseOrderLineList` | Array of line items with `sku` and `packQuantity` |

### Optional Fields

| Field | Description |
|-------|-------------|
| `vendor` | Vendor/supplier name |
| `purchaseOrderDate` | PO date (default: today) |
| `plannedReceivingDate` | Expected receiving date |
| `plannedArrivalDate` | Expected arrival date |
| `referenceNumber` | Vendor reference number |
| `vendorBillingAddress` | Vendor billing address |
| `vendorShipmentAddress` | Vendor ship-from address |

### Line Item Fields

| Field | Required | Description |
|-------|----------|-------------|
| `sku` | Yes | Product SKU |
| `packQuantity` | Yes | Quantity expected |
| `packType` | No | Pack type |
| `unitPrice` | No | Unit cost |
| `lotBatchNumber` | No | Lot/batch number |

### Fields You Do NOT Need to Send

| Field | Why |
|-------|-----|
| `clientIdentifier` | Assigned by the gateway |
| `warehouseIdentifier` | Assigned by the gateway |
| `purchaseOrderTypeName` | Handled by the gateway |

### Example Response

```json
{
  "purchaseOrderId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "logiwaIdentifier": "f18d8f61-fb5d-45ec-b2ef-21e57b9ed0c1",
  "code": "93024-HI",
  "status": "sent",
  "message": "Purchase order created in Logiwa"
}
```

---

## 7. Get Purchase Order Details

```
GET /v1/purchase-orders/{identifier}
```

Retrieve details for a purchase order using the `logiwaIdentifier` from the submission response.

---

## 8. Get Purchase Order Receipts

```
GET /v1/purchase-orders/{code}/receipts?page=0&size=50
```

Retrieve receiving history for a purchase order using the PO `code`.

### Example Response

```json
{
  "purchaseOrderCode": "93024-HI",
  "receipts": [
    {
      "productSku": "881469",
      "packQuantity": 1,
      "receiptDate": "2026-03-25T10:30:00Z",
      "warehouseLocationCode": "A-01-01",
      "lotBatchNumber": null
    }
  ],
  "page": 0,
  "size": 50
}
```

---

## Error Responses

All errors return a consistent format:

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
| `RATE_LIMITED` | 429 | Exceeded your rate limit — wait and retry |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `LOGIWA_API_ERROR` | 502 | Warehouse system returned an error (details in message) |

### Common Error Scenarios

| Scenario | Error |
|----------|-------|
| Duplicate order code | `"This shipment order code already exists (CODE)"` |
| SKU not in system | `"Entered product is not correct."` |
| Invalid pack type | `"Packtype doesn't belong to selected product."` |
| Empty/placeholder fields | Various validation errors — omit fields you don't have data for |

---

## What Is NOT Available Through the API

The following operations are managed by KSP and are not available through the API:

- **Product creation** — Contact your KSP account representative to set up new SKUs
- **Product updates** — Managed by KSP
- **Order cancellation** — Contact KSP to cancel orders
- **Order deletion** — Contact KSP
- **Webhook management** — Managed by KSP
- **Warehouse/client configuration** — Managed by KSP

---

## Onboarding Checklist

1. KSP provides your API key
2. Confirm your products/SKUs are set up in the system
3. Test with a single order submission
4. Verify order appears and status is `sent`
5. Test inventory query for your SKUs
6. Test purchase order submission if applicable
7. Move to bulk orders if needed for high volume

---

## Support

For questions, product setup requests, or issues with the API, contact your KSP account representative.
