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
| GET | `/v1/orders` | List orders (paginated, filterable) |
| GET | `/v1/orders/{orderId}` | Get full order details |
| GET | `/v1/orders/{orderId}/tracking` | Get tracking information |
| GET | `/v1/inventory` | List all inventory (paginated, filterable) |
| POST | `/v1/inventory/query` | Query inventory by specific SKU(s) |
| POST | `/v1/purchase-orders` | Submit a purchase order |
| GET | `/v1/purchase-orders` | List purchase orders (paginated, filterable) |
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
| `shipmentOrderLineList` | Array of line items (at minimum `sku` and `packQuantity`) |

### Complete Field Reference — Order

The full schema is available. Only `code` and `shipmentOrderLineList` are required — include any other fields you have data for, omit the rest.

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | **Required.** Your unique order number |
| `customer.firstName` | string | Customer first name |
| `customer.lastName` | string | Customer last name |
| `customer.email` | string | Customer email |
| `companyName` | string | Company name |
| `carrierReasonForExport` | string | Reason for export (international orders) |
| `shipmentAddress.type` | string | Address type (e.g. "Residential", "Commercial") |
| `shipmentAddress.country` | string | Country code (e.g. "US") |
| `shipmentAddress.state` | string | State name or abbreviation |
| `shipmentAddress.addressLine1` | string | Street address |
| `shipmentAddress.addressLine2` | string | Suite, unit, etc. |
| `shipmentAddress.city` | string | City |
| `shipmentAddress.postalCode` | string | ZIP/postal code |
| `shipmentAddress.phoneNumber` | string | Phone number |
| `billingAddress.type` | string | Address type |
| `billingAddress.country` | string | Country code |
| `billingAddress.state` | string | State |
| `billingAddress.addressLine1` | string | Street address |
| `billingAddress.addressLine2` | string | Suite, unit, etc. |
| `billingAddress.city` | string | City |
| `billingAddress.postalCode` | string | ZIP/postal code |
| `billingAddress.phoneNumber` | string | Phone number |
| `billingAddress.firstName` | string | Billing first name |
| `billingAddress.lastName` | string | Billing last name |
| `billingAddress.email` | string | Billing email |
| `billingAddress.companyName` | string | Billing company name |
| `useSameAddress` | boolean | Use shipping as billing (default: `true`) |
| `shipmentOrderDate` | string | Order date, ISO format (default: today) |
| `expectedShipmentDate` | string | Requested ship date |
| `expectedDeliveryDate` | string | Requested delivery date |
| `clientReferenceCode` | string | Your internal reference/PO number |
| `discount` | number | Order-level discount |
| `note` | string | Order notes |
| `extraNote1` | string | Additional note field 1 |
| `extraNote2` | string | Additional note field 2 |
| `extraNote3` | string | Additional note field 3 |
| `extraNote4` | string | Additional note field 4 |
| `extraNote5` | string | Additional note field 5 |
| `giftNote` | string | Gift message |
| `fraud` | string | Fraud check flag |
| `isSkipAddressVerification` | boolean | Skip address validation (default: `false`) |
| `gift` | boolean | Gift order flag |
| `currencyId` | integer | Currency ID |
| `isPrimeOrder` | boolean | Priority/Prime order flag |
| `tags` | array | Array of tag identifier GUIDs |
| `scheduledPickupDate` | string | Scheduled pickup date |
| `actualPickupDate` | string | Actual pickup date |
| `carrierId` | integer | Carrier ID |
| `carrierSetupIdentifier` | string | Carrier setup GUID |
| `shippingOptionIdentifier` | string | Shipping option GUID |
| `internationalChargedAccountNumber` | string | International billing account |
| `internationalChargedAccountCountryCode` | string | International billing country |
| `internationalChargedAccountPostalCode` | string | International billing postal code |
| `carrierBillingTypeId` | integer | Carrier billing type ID |
| `carrierBillingTypeName` | string | Carrier billing type (e.g. "Prepaid") |
| `carrierIntBillingTypeId` | integer | International carrier billing type ID |
| `carrierIntBillingTypeName` | string | International carrier billing type name |
| `chargedAccountNumber` | string | Domestic billing account number |
| `chargedAccountCountryCode` | string | Domestic billing country |
| `chargedAccountPostalCode` | string | Domestic billing postal code |
| `packingInstructions` | string | Special packing instructions |
| `currentTrackingNumber` | string | Pre-assigned tracking number |
| `trackingNumbers` | array | Array of tracking number strings |
| `totalShippingCost` | number | Total shipping cost |
| `carrierPackageIdentifier` | string | Carrier package type GUID |
| `carrierPackageName` | string | Carrier package type name |
| `isAllowSaturdayDelivery` | boolean | Allow Saturday delivery |
| `priority` | integer | Order priority |
| `customFieldDateTime1` | string | Custom date field 1 |
| `customFieldDateTime2` | string | Custom date field 2 |
| `customFieldDateTime3` | string | Custom date field 3 |
| `customFieldToggle1` | boolean | Custom toggle field 1 |
| `customFieldToggle2` | boolean | Custom toggle field 2 |
| `customFieldDropDown1` | string | Custom dropdown field 1 |
| `customFieldDropDown2` | string | Custom dropdown field 2 |
| `customFieldTextBox1` | string | Custom text field 1 |
| `customFieldTextBox2` | string | Custom text field 2 |
| `customFieldTextBox3` | string | Custom text field 3 |
| `channelOrderNumber` | string | Your channel/marketplace order number |
| `channelSetupIdentifier` | string | Channel setup GUID |
| `isManualChargedAccount` | boolean | Manual domestic billing account flag |
| `isManualIntChargedAccount` | boolean | Manual international billing account flag |
| `packingWarningTypeIdentifier` | string | Packing warning type GUID |
| `packingWarningTypeName` | string | Packing warning type name |

### Shipping Option Details (nested object)

| Field | Type | Description |
|-------|------|-------------|
| `shippingOptionDetails.shippingOptionName` | string | Shipping method name (e.g. "Ground") |
| `shippingOptionDetails.carrierName` | string | Carrier name (e.g. "UPS") |
| `shippingOptionDetails.carrierSetupName` | string | Carrier setup name (e.g. "UPS Standard") |
| `shippingOptionDetails.isSetUnmatchedShippingOptionAsRequested` | boolean | If `true`, unmatched methods are recorded as requested |

### Return Shipping Details (nested object)

| Field | Type | Description |
|-------|------|-------------|
| `returnShippingOptionDetails.returnCarrierId` | integer | Return carrier ID |
| `returnShippingOptionDetails.returnCarrierName` | string | Return carrier name |
| `returnShippingOptionDetails.returnShippingOptionIdentifier` | string | Return shipping option GUID |
| `returnShippingOptionDetails.returnShippingOptionName` | string | Return shipping option name |
| `returnShippingOptionDetails.returnCarrierSetupIdentifier` | string | Return carrier setup GUID |
| `returnShippingOptionDetails.returnCarrierSetupName` | string | Return carrier setup name |
| `returnShippingOptionDetails.returnCost` | number | Return shipping cost |
| `returnShippingOptionDetails.returnTrackingNumbers` | array | Array of return tracking numbers |
| `returnShippingOptionDetails.returnAddressName` | string | Return address name |

### Tax Details (array of objects)

| Field | Type | Description |
|-------|------|-------------|
| `taxDetails[].taxId` | string | Tax identifier |
| `taxDetails[].taxTypeName` | string | Tax type name |

### Retailer Details (nested object)

| Field | Type | Description |
|-------|------|-------------|
| `retailerDetails.retailerIdentifier` | string | Retailer GUID |
| `retailerDetails.pro` | string | PRO number |
| `retailerDetails.bol` | string | Bill of lading |
| `retailerDetails.po` | string | Retailer PO number |
| `retailerDetails.dept` | string | Department |
| `retailerDetails.markFor` | string | Mark for |
| `retailerDetails.retailerCustomerAccountNumber` | string | Retailer customer account |

### Complete Line Item Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sku` | string | **Yes** | Product SKU (must exist in the system) |
| `packQuantity` | integer | **Yes** | Quantity to ship |
| `packType` | string | No | Pack type (e.g. "Unit", "Case") — uses product default if omitted |
| `unitPrice` | number | No | Unit price |
| `unitTax` | number | No | Tax per unit |
| `unitDiscount` | number | No | Discount per unit |
| `taxIncluded` | boolean | No | Whether unitPrice includes tax |
| `lotBatchNumber` | string | No | Lot/batch number |
| `expiryDate` | string | No | Product expiry date |
| `productionDate` | string | No | Product production date |
| `warehouseLocationCode` | string | No | Specific warehouse location |
| `licensePlate` | string | No | License plate number |
| `damageReason` | string | No | Damage reason |
| `customFieldDateTime1` | string | No | Custom date field 1 |
| `customFieldDateTime2` | string | No | Custom date field 2 |
| `customFieldDateTime3` | string | No | Custom date field 3 |
| `customFieldToggle1` | boolean | No | Custom toggle 1 |
| `customFieldToggle2` | boolean | No | Custom toggle 2 |
| `customFieldDropDown1` | string | No | Custom dropdown 1 |
| `customFieldDropDown2` | string | No | Custom dropdown 2 |
| `customFieldTextBox1` | string | No | Custom text 1 |
| `customFieldTextBox2` | string | No | Custom text 2 |
| `customFieldTextBox3` | string | No | Custom text 3 |
| `lineNotes1` | string | No | Line notes 1 |
| `lineNotes2` | string | No | Line notes 2 |
| `lineNotes3` | string | No | Line notes 3 |

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

Bulk orders are processed asynchronously. The `requestId` confirms acceptance.

### How to Check Bulk Results

You do **not** need to set up webhooks — the gateway handles that. To check if your bulk orders were processed:

1. **List your orders** using `GET /v1/orders` and filter by date or code to find the orders you submitted
2. **Check individual order status** using `GET /v1/orders/{orderId}` for any specific order
3. Any orders that failed validation will appear with error details in the list response

### Limits

- Maximum **50 orders** per bulk request
- Rate limited: 1 bulk request every 2-6 seconds depending on tier

---

## 3. List Orders

```
GET /v1/orders?page=0&size=50
```

List your orders with pagination and filtering. Results are automatically scoped to your account — you will only see your own orders.

### Query Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | 0 | Page index (starts at 0) |
| `size` | 50 | Results per page |

### LQL Filtering

You can filter results using Logiwa Query Language (LQL) parameters:

```
GET /v1/orders?page=0&size=50&Code.eq=ORD-001
GET /v1/orders?page=0&size=50&Status.eq=5
GET /v1/orders?page=0&size=50&CreatedDateTime.bt=2026-01-01,2026-01-31
GET /v1/orders?page=0&size=50&ActualShipmentDate.bt=2026-03-01,2026-03-31
```

LQL operators: `eq` (equals), `gt` (greater than), `gte` (greater or equal), `lt` (less than), `lte` (less or equal), `bt` (between, inclusive).

### Example Response

Returns the full Logiwa order list response including order details, statuses, tracking numbers, etc.

---

## 4. Get Order Details

```
GET /v1/orders/{orderId}
```

Retrieve full order details. You can pass either the gateway `orderId` returned when the order was submitted, or the `logiwaOrderId`. Returns the complete Logiwa order record including status, tracking, shipping details, and all fields.

### Example Response

Returns the full Logiwa order record with all fields including:
- Order code, status, dates
- Customer and address details
- Line items with SKUs and quantities
- Tracking numbers, carrier info
- All custom fields

If the Logiwa system is temporarily unavailable, falls back to cached gateway status.

### Order Statuses (Gateway)

| Status | Meaning |
|--------|---------|
| `received` | Order received by gateway, pending submission |
| `sent` | Successfully submitted to the warehouse |
| `fulfilled` | Order has been shipped |
| `closed` | Order completed or cancelled |
| `error` | Submission failed (see error message for details) |

---

## 5. Get Tracking Information

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

## 6. List All Inventory

```
GET /v1/inventory?page=0&size=200
```

Page through all inventory for your account. Results are automatically scoped to your account — you will only see your own inventory.

This is useful for syncing your full inventory with your own system. You can page through all SKUs at the warehouse, not just specific ones.

### Query Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | 0 | Page index (starts at 0) |
| `size` | 200 | Results per page (max 200) |

### LQL Filtering

```
GET /v1/inventory?page=0&size=200&Sku.eq=WIDGET-100
GET /v1/inventory?page=0&size=200&WarehouseIdentifier.eq={uuid}
```

### Example Response

Returns the full Logiwa inventory list including:
- `productSku`, `productName`
- `availableQuantity`, `totalQuantity`, `allocatedQuantity`, `freeQuantity`
- `warehouseCode`, `warehouseLocationCode`
- `lotBatchNumber`, `expiryDate`
- `inventoryStatusName`

Page through by incrementing `page` until you get fewer results than `size`.

---

## 7. Query Inventory by SKU

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

## 8. Submit a Purchase Order

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
| `purchaseOrderLineList` | Array of line items (at minimum `sku` and `packQuantity`) |

### Complete Field Reference — Purchase Order

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | **Required.** Your unique PO number |
| `vendor` | string | Vendor/supplier name |
| `purchaseOrderDate` | string | PO date, ISO format (default: today) |
| `actualReceivingDate` | string | Actual receiving date |
| `plannedReceivingDate` | string | Expected receiving date |
| `plannedArrivalDate` | string | Expected arrival date |
| `actualArrivalDate` | string | Actual arrival date |
| `referenceNumber` | string | Vendor reference number |
| `currencyId` | string | Currency ID |
| `note` | string | PO notes |
| `customFieldDateTime1` | string | Custom date field 1 |
| `customFieldDateTime2` | string | Custom date field 2 |
| `customFieldDateTime3` | string | Custom date field 3 |
| `customFieldToggle1` | boolean | Custom toggle 1 |
| `customFieldToggle2` | boolean | Custom toggle 2 |
| `customFieldDropDown1` | string | Custom dropdown 1 |
| `customFieldDropDown2` | string | Custom dropdown 2 |
| `customFieldTextBox1` | string | Custom text 1 |
| `customFieldTextBox2` | string | Custom text 2 |
| `customFieldTextBox3` | string | Custom text 3 |

### Vendor Address Fields (vendorBillingAddress / vendorShipmentAddress)

Both vendor address objects share the same structure:

| Field | Type | Description |
|-------|------|-------------|
| `country` | string | Country code |
| `state` | string | State |
| `addressName` | string | Address name/label |
| `companyName` | string | Company name |
| `firstName` | string | First name |
| `lastName` | string | Last name |
| `email` | string | Email |
| `addressLine1` | string | Street address |
| `addressLine2` | string | Suite, unit, etc. |
| `city` | string | City |
| `postalCode` | string | ZIP/postal code |
| `phoneNumber` | string | Phone number |
| `fax` | string | Fax number |

### Complete PO Line Item Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sku` | string | **Yes** | Product SKU |
| `packQuantity` | integer | **Yes** | Quantity expected |
| `packType` | string | No | Pack type (e.g. "Unit", "Case") |
| `unitPrice` | number | No | Unit cost |
| `taxRate` | number | No | Tax rate |
| `note` | string | No | Line item note |
| `lotBatchNumber` | string | No | Lot/batch number |
| `expiryDate` | string | No | Product expiry date |
| `productionDate` | string | No | Product production date |
| `licensePlateType` | string | No | License plate type |
| `licensePlateNumber` | string | No | License plate number |
| `warehouseLocation` | string | No | Specific warehouse location |

### Fields You Do NOT Need to Send

| Field | Why |
|-------|-----|
| `clientIdentifier` | Assigned by the gateway based on your API key |
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

## 9. List Purchase Orders

```
GET /v1/purchase-orders?page=0&size=50
```

Page through your purchase orders. Results are automatically scoped to your account.

### Query Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | 0 | Page index (starts at 0) |
| `size` | 50 | Results per page |

### LQL Filtering

```
GET /v1/purchase-orders?page=0&size=50&Code.eq=PO-001
GET /v1/purchase-orders?page=0&size=50&CreatedDate.bt=2026-01-01,2026-01-31
```

### Example Response

Returns the full Logiwa purchase order list including PO code, vendor, status, line items, dates, and receiving progress.

---

## 10. Get Purchase Order Details

```
GET /v1/purchase-orders/{identifier}
```

Retrieve details for a purchase order using the `logiwaIdentifier` from the submission response.

---

## 11. Get Purchase Order Receipts

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
