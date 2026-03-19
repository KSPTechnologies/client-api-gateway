# Client API Specification

Base URL: `https://api.yourcompany.com/v1`

## Authentication

All requests require an `X-API-Key` header.

```
X-API-Key: your-api-key-here
```

## Endpoints

### Health Check

```
GET /v1/health
```

No authentication required.

### Orders

#### Create Order

```
POST /v1/orders
```

Request body: TBD (pending Logiwa spec)

#### Get Order

```
GET /v1/orders/{orderId}
```

#### Get Tracking

```
GET /v1/orders/{orderId}/tracking
```

### Inventory

#### Query Inventory

```
POST /v1/inventory/query
```

Request body: TBD (pending Logiwa spec)

## Error Responses

All errors return JSON:

```json
{
  "error": "Description of the error"
}
```

| Status | Meaning |
|--------|---------|
| 401    | Invalid or missing API key |
| 404    | Resource not found |
| 405    | Method not allowed |
| 429    | Rate limit exceeded |
| 500    | Internal server error |
