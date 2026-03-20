/**
 * Zod schemas for request validation.
 */

import { z } from 'zod';

// ── Order Schemas ────────────────────────────────────

export const createOrderSchema = z.object({
  externalOrderId: z.string().min(1).max(100),
  shipTo: z.object({
    name: z.string().min(1).max(200),
    address1: z.string().min(1).max(200),
    address2: z.string().max(200).optional(),
    city: z.string().min(1).max(100),
    state: z.string().min(1).max(50),
    zip: z.string().min(1).max(20),
    country: z.string().length(2).default('US'),
    phone: z.string().max(30).optional(),
    email: z.string().email().max(200).optional(),
  }),
  items: z
    .array(
      z.object({
        sku: z.string().min(1).max(100),
        quantity: z.number().int().positive(),
        unitPrice: z.number().nonnegative().optional(),
      })
    )
    .min(1)
    .max(500),
  shippingMethod: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
  referenceNumber: z.string().max(100).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// ── Inventory Schemas ────────────────────────────────

export const inventoryQuerySchema = z.object({
  skus: z.array(z.string().min(1).max(100)).min(1).max(100),
});

export type InventoryQueryInput = z.infer<typeof inventoryQuerySchema>;

// ── Purchase Order Schemas ───────────────────────────

const addressSchema = z.object({
  addressLine1: z.string().min(1).max(200),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(50),
  postalCode: z.string().min(1).max(20),
  country: z.string().length(2).default('US'),
}).optional();

export const createPurchaseOrderSchema = z.object({
  code: z.string().min(1).max(100),
  vendor: z.string().max(200).optional(),
  purchaseOrderDate: z.string().max(30).optional(),
  plannedReceivingDate: z.string().max(30).optional(),
  plannedArrivalDate: z.string().max(30).optional(),
  referenceNumber: z.string().max(100).optional(),
  items: z
    .array(
      z.object({
        sku: z.string().min(1).max(100),
        packType: z.string().max(50).optional(),
        quantity: z.number().int().positive(),
        unitPrice: z.number().nonnegative().optional(),
        lotBatchNumber: z.string().max(100).optional(),
      })
    )
    .min(1)
    .max(500),
  vendorBillingAddress: addressSchema,
  vendorShipmentAddress: addressSchema,
});

export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
